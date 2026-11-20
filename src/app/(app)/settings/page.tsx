import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { Icon } from "@/components/icons";
import { buildNav } from "@/features/nav/nav";
import { multiBranchAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const ctx = await requireTenant();
  if (!can(ctx, "branch.manage") && !can(ctx, "owner.control") && !can(ctx, "print.manage")) {
    return <p className="card p-6 text-stone-600">You do not have settings to change.</p>;
  }
  const sp = await searchParams;
  const [business, activeBranches] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true, multiBranch: true } }),
    db.branch.count({ where: { businessId: ctx.businessId, active: true } }),
  ]);
  const { sections } = buildNav({ role: ctx.role, permissions: ctx.permissions, multiBranch: business.multiBranch, hukka: false, counts: {} });
  const tools = sections.find((s) => s.id === "settings")?.items.filter((i) => i.href !== "/settings") ?? [];
  const canSwitch = can(ctx, "branch.manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-stone-500">{business.name}</p>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">Several branches</h2>
        <p className="mt-1 text-sm text-stone-600">
          Turn this on only if you run more than one location. It adds the branch switcher, branch reports and the Branches page. Leave it off for a single café or restaurant and
          those stay out of your way.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${business.multiBranch ? "bg-brand-50 text-brand-700" : "bg-stone-100 text-stone-600"}`}>{business.multiBranch ? "On" : "Off"}</span>
          {canSwitch && (
            <form action={multiBranchAction.bind(null, !business.multiBranch)}>
              <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50">{business.multiBranch ? "Turn off" : "Turn on"}</button>
            </form>
          )}
          {business.multiBranch && canSwitch && (
            <Link href="/branches" className="text-sm font-medium text-brand-700 hover:underline">
              Manage branches ({activeBranches})
            </Link>
          )}
        </div>
        {business.multiBranch && activeBranches > 1 && <p className="mt-2 text-xs text-stone-500">You have {activeBranches} active branches, so this stays on. Switch the others off on the Branches page to turn it off.</p>}
      </section>

      {tools.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Set up and connect</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((t) => (
              <Link key={t.href} href={t.href} className="card flex items-start gap-3 p-4 transition-colors hover:border-brand-500">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600">
                  <Icon name={t.icon} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{t.label}</span>
                  <span className="block text-sm text-stone-500">{t.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
