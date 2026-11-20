import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { Icon } from "@/components/icons";
import { getEditorState } from "@/features/dashboard/server/preferences";
import { TEMPLATE_INFO } from "@/features/dashboard/registry";
import { resetDashboardAction, saveVisibilityAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardSettingsPage({ searchParams }: PageProps<"/settings/dashboard">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const st = await getEditorState(ctx);
  // A widget counts as shown when it is visible on at least one device.
  const shown = new Set([...st.current.desktop.visible, ...st.current.mobile.visible].map((p) => p.id));
  const groups = [...new Set(st.widgets.map((w) => w.group))];
  const card = "card flex items-start gap-3 p-4 transition-colors hover:border-brand-500";
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Dashboard settings</h1>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.saved === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}
      {sp.reset === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Your dashboard is back to the standard layout.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/settings/dashboard/customize" className={card}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icon name="layout" className="size-5" />
          </span>
          <span>
            <span className="block font-medium">Customize dashboard</span>
            <span className="block text-sm text-stone-500">Drag cards into the order you want, for desktop and for your phone.</span>
          </span>
        </Link>
        <Link href="/settings/dashboard/templates" className={card}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icon name="dashboard" className="size-5" />
          </span>
          <span>
            <span className="block font-medium">Dashboard layout templates</span>
            <span className="block text-sm text-stone-500">Now: {TEMPLATE_INFO[st.template].name}. Preview Classic, Modern or Compact.</span>
          </span>
        </Link>
      </div>

      <section className="card p-5" aria-labelledby="visibility">
        <h2 id="visibility" className="font-semibold">
          Widget visibility
        </h2>
        <p className="mt-1 text-sm text-stone-600">Choose which cards appear. A card you show again joins the end of the layout; drag it where you want it in Customize. Only cards you are allowed to see are listed.</p>
        <form action={saveVisibilityAction} className="mt-4 space-y-4">
          {groups.map((g) => (
            <fieldset key={g}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">{g}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {st.widgets
                  .filter((w) => w.group === g)
                  .map((w) => (
                    <label key={w.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
                      <input type="checkbox" name="widget" value={w.id} defaultChecked={shown.has(w.id)} className="mt-1" />
                      <span>
                        <span className="font-medium">{w.title}</span>
                        <span className="block text-xs text-stone-500">{w.description}</span>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
          <button className="btn-primary">Save visibility</button>
        </form>
      </section>

      <section className="card p-5" aria-labelledby="reset">
        <h2 id="reset" className="font-semibold">
          Reset dashboard
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          {st.customised ? "Go back to the standard layout of your chosen template. Your template, colours and everyone else's dashboards are not touched." : "You are using the standard layout already."}
        </p>
        <form action={resetDashboardAction} className="mt-3">
          <button className="btn-secondary" disabled={!st.customised}>
            Reset to the standard layout
          </button>
        </form>
      </section>
    </div>
  );
}
