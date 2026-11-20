import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { TEMPLATES, type Template } from "@/features/dashboard/layout";
import { TEMPLATE_INFO } from "@/features/dashboard/registry";
import { getPreferences } from "@/features/dashboard/server/preferences";
import { applyTemplateAction } from "../actions";

export const dynamic = "force-dynamic";

/** A small drawing of each template: the same kinds of card, spaced and sized the way that template does it. */
function Sketch({ t }: { t: Template }) {
  const gap = t === "COMPACT" ? "gap-1" : t === "MODERN" ? "gap-2.5" : "gap-1.5";
  const pad = t === "COMPACT" ? "p-1.5" : t === "MODERN" ? "p-3" : "p-2";
  const round = t === "COMPACT" ? "rounded" : t === "MODERN" ? "rounded-xl" : "rounded-md";
  const card = `${round} ${pad} border border-stone-200 bg-white ${t === "MODERN" ? "shadow-md" : ""}`;
  const kpi = (w: string) => (
    <div className={card}>
      <div className="h-1 w-1/3 rounded bg-stone-300" />
      <div className={`mt-1 rounded bg-stone-800 ${t === "MODERN" ? "h-3 w-3/5" : t === "COMPACT" ? "h-1.5 w-2/5" : "h-2 w-1/2"} ${w}`} />
    </div>
  );
  return (
    <div aria-hidden="true" className={`grid grid-cols-4 ${gap} rounded-xl bg-stone-100 p-2`}>
      {t === "COMPACT" ? (
        <>
          <div className={`col-span-4 ${card} !border-amber-300 !bg-amber-50`}>
            <div className="h-1.5 w-24 rounded bg-amber-400" />
          </div>
          {kpi("")}
          {kpi("")}
          {kpi("")}
          {kpi("")}
          <div className={`col-span-2 ${card} h-10`} />
          <div className={`col-span-2 ${card} h-10`} />
        </>
      ) : (
        <>
          {kpi("")}
          {kpi("")}
          {kpi("")}
          {kpi("")}
          <div className={`col-span-4 ${card} ${t === "MODERN" ? "h-16" : "h-11"}`}>
            <div className="flex h-full items-end gap-1">
              {[3, 5, 4, 7, 6, 8, 5, 9].map((h, i) => (
                <span key={i} className="flex-1 rounded-sm bg-brand-500" style={{ height: `${h * 10}%` }} />
              ))}
            </div>
          </div>
          <div className={`col-span-2 ${card} h-8`} />
          <div className={`col-span-2 ${card} h-8`} />
        </>
      )}
    </div>
  );
}

export default async function TemplatesPage() {
  const ctx = await requireTenant();
  const prefs = await getPreferences(ctx);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/settings/dashboard" className="text-sm text-stone-500 hover:underline">
          ← Dashboard settings
        </Link>
        <h1 className="text-2xl font-semibold">Dashboard layout templates</h1>
      </div>
      <p className="text-sm text-stone-600">
        All three show the same numbers from the same system. A template changes spacing, size and style only; your arranged cards and hidden cards are kept when you switch. &ldquo;Preview&rdquo; opens your real dashboard in that template without saving.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {TEMPLATES.map((t) => {
          const info = TEMPLATE_INFO[t];
          const current = prefs.template === t;
          return (
            <section key={t} className={`card flex flex-col gap-3 p-4 ${current ? "border-brand-500 ring-2 ring-brand-500/30" : ""}`} aria-label={info.name}>
              <Sketch t={t} />
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  {info.name}
                  {current && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">In use</span>}
                </h2>
                <p className="text-sm text-stone-500">{info.tagline}</p>
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-stone-600">
                {info.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <div className="mt-auto flex gap-2 pt-1">
                <Link href={`/dashboard?preview=${t}`} className="btn-secondary flex-1">
                  Preview
                </Link>
                <form action={applyTemplateAction.bind(null, t)} className="flex-1">
                  <button className="btn-primary w-full" disabled={current}>
                    {current ? "In use" : "Use this"}
                  </button>
                </form>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
