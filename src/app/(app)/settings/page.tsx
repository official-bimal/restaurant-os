import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { Icon } from "@/components/icons";
import { buildNav, type NavEntry } from "@/features/nav/nav";
import { multiBranchAction } from "./actions";

export const dynamic = "force-dynamic";

const PERSONAL = new Set(["/settings", "/settings/dashboard", "/settings/appearance"]);

function Tile({ e }: { e: { href: string; label: string; icon: string; description: string } }) {
  return (
    <Link href={e.href} className="card flex items-start gap-3 p-4 transition-colors hover:border-brand-500">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
        <Icon name={e.icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{e.label}</span>
        <span className="block text-sm text-stone-500">{e.description}</span>
      </span>
    </Link>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const [business, activeBranches] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true, multiBranch: true } }),
    db.branch.count({ where: { businessId: ctx.businessId, active: true } }),
  ]);
  const { sections } = buildNav({ role: ctx.role, permissions: ctx.permissions, multiBranch: business.multiBranch, hukka: false, counts: {} });
  const all: NavEntry[] = sections.find((s) => s.id === "settings")?.items ?? [];
  // Business setup: everything in Settings this person may open except their own dashboard and appearance pages, which have their own groups.
  const general = all.filter((i) => !PERSONAL.has(i.href));
  const canSwitch = can(ctx, "branch.manage");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-stone-500">{business.name}</p>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}

      {(general.length > 0 || canSwitch) && (
        <section aria-labelledby="general">
          <h2 id="general" className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
            General
          </h2>
          {canSwitch && (
            <div className="card mb-3 p-5">
              <h3 className="font-semibold">Several branches</h3>
              <p className="mt-1 text-sm text-stone-600">
                Turn this on only if you run more than one location. It adds the branch switcher, branch reports and the Branches page. Leave it off for a single café or restaurant and those stay out of your way.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${business.multiBranch ? "bg-brand-50 text-brand-700" : "bg-stone-100 text-stone-600"}`}>{business.multiBranch ? "On" : "Off"}</span>
                <form action={multiBranchAction.bind(null, !business.multiBranch)}>
                  <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50">{business.multiBranch ? "Turn off" : "Turn on"}</button>
                </form>
                {business.multiBranch && (
                  <Link href="/branches" className="text-sm font-medium text-brand-700 hover:underline">
                    Manage branches ({activeBranches})
                  </Link>
                )}
              </div>
              {business.multiBranch && activeBranches > 1 && <p className="mt-2 text-xs text-stone-500">You have {activeBranches} active branches, so this stays on. Switch the others off on the Branches page to turn it off.</p>}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {general.map((t) => (
              <Tile key={t.href} e={t} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="dashboard">
        <h2 id="dashboard" className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
          Dashboard settings
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile e={{ href: "/settings/dashboard/customize", label: "Customize dashboard", icon: "layout", description: "Drag cards into your own order" }} />
          <Tile e={{ href: "/settings/dashboard/templates", label: "Dashboard layout templates", icon: "dashboard", description: "Classic, Modern or Compact, with a preview" }} />
          <Tile e={{ href: "/settings/dashboard", label: "Widget visibility and reset", icon: "eye", description: "Show or hide cards, or go back to standard" }} />
        </div>
      </section>

      <section aria-labelledby="appearance">
        <h2 id="appearance" className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
          Appearance &amp; branding
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile e={{ href: "/settings/appearance", label: "Light, dark or system", icon: "moon", description: "How the app looks to you" }} />
          <Tile e={{ href: "/settings/appearance", label: "Theme colours", icon: "palette", description: "Pick a palette or your own colour" }} />
          <Tile e={{ href: "/settings/appearance", label: "Business logo", icon: "extras", description: can(ctx, "owner.control") ? "Upload the logo shown in the menu" : "Shown in the menu (owner can change)" }} />
        </div>
      </section>
    </div>
  );
}
