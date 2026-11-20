import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { AutoRefresh } from "@/components/auto-refresh";
import { Icon } from "@/components/icons";
import { cleanTemplate, resolveLayout, type DashboardConfig } from "@/features/dashboard/layout";
import { availableWidgets, defaultHidden, TEMPLATE_INFO, TEMPLATE_ORDER } from "@/features/dashboard/registry";
import { getPreferences } from "@/features/dashboard/server/preferences";
import { loadDashboard } from "@/features/dashboard/server/data";
import { DashboardGrid } from "@/features/dashboard/dashboard-grid";
import { applyTemplateAction } from "../settings/dashboard/actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const prefs = await getPreferences(ctx);
  // ?preview=MODERN shows the real dashboard in another template without saving anything.
  const previewing = typeof sp.preview === "string" && ["CLASSIC", "MODERN", "COMPACT"].includes(sp.preview) ? cleanTemplate(sp.preview) : null;
  const template = previewing ?? prefs.template;

  const available = availableWidgets(ctx);
  const order = TEMPLATE_ORDER[template];
  const cfg: DashboardConfig | null = prefs.layout;
  const off = defaultHidden(template, ctx);
  const desktop = resolveLayout(cfg?.desktop ?? null, available, order, off);
  const mobile = resolveLayout(cfg?.mobile ?? null, available, order, off);
  const needed = new Set([...desktop.visible, ...mobile.visible].map((p) => p.id));

  const d = await loadDashboard(ctx, needed);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      {!previewing && <AutoRefresh everyMs={10000} />}

      {previewing && (
        <div role="status" className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-500 bg-brand-50 px-4 py-3 shadow-lg">
          <p className="min-w-0 flex-1 text-sm font-medium text-brand-700">
            Previewing <strong>{TEMPLATE_INFO[previewing].name}</strong>. Nothing is saved yet. Your widget choices stay as they are.
          </p>
          <form action={applyTemplateAction.bind(null, previewing)}>
            <button className="btn-primary">Use this layout</button>
          </form>
          <Link href="/settings/dashboard/templates" className="btn-secondary">
            Cancel
          </Link>
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            {greeting}, {d.firstName}
          </h1>
          <p className="mt-0.5 text-sm text-stone-500">
            {d.business.multiBranch ? `${d.branchName} · ` : ""}
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(ctx, "order.create") && (
            <Link href="/orders" className="btn-primary">
              <Icon name="plus" className="size-4" /> New order
            </Link>
          )}
          {can(ctx, "order.create") && can(ctx, "order.edit") && (
            <Link href="/quick" className="btn-secondary">
              Quick order
            </Link>
          )}
          {(can(ctx, "kitchen.update") || can(ctx, "order.edit")) && (
            <Link href="/kitchen" className="btn-secondary">
              Kitchen
            </Link>
          )}
          <Link href="/settings/dashboard/customize" className="btn-secondary" aria-label="Customize dashboard">
            <Icon name="layout" className="size-4" /> Customize
          </Link>
        </div>
      </header>

      <DashboardGrid d={d} who={ctx} t={template} desktop={desktop} mobile={mobile} />
    </div>
  );
}
