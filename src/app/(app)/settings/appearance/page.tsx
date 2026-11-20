import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { PALETTES } from "@/features/appearance/theme";
import { getPreferences } from "@/features/dashboard/server/preferences";
import { MAX_LOGO_BYTES } from "@/features/business/profile";
import { AppearanceForm } from "./appearance-form";
import { removeLogoAction, resetAppearanceAction, saveAppearanceAction, saveBusinessAccentAction, uploadLogoAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppearancePage({ searchParams }: PageProps<"/settings/appearance">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const [prefs, biz, logo] = await Promise.all([
    getPreferences(ctx),
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true, brandAccent: true } }),
    db.businessLogo.findUnique({ where: { businessId: ctx.businessId }, select: { updatedAt: true } }),
  ]);
  const owner = can(ctx, "owner.control");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Appearance &amp; branding</h1>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.saved === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}

      <AppearanceForm mode={prefs.themeMode} accent={prefs.accent} businessAccent={biz.brandAccent} save={saveAppearanceAction} reset={resetAppearanceAction} />

      <section className="card space-y-4 p-5" aria-labelledby="logo">
        <div>
          <h2 id="logo" className="text-lg font-semibold">
            Business logo
          </h2>
          <p className="text-sm text-stone-600">Shown at the top of the menu for everyone in {biz.name}. {owner ? "" : "Only the owner can change it."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/logo?v=${logo.updatedAt.getTime()}`} alt={`${biz.name} logo`} className="brand-logo h-16 w-auto max-w-[14rem] object-contain" />
          ) : (
            <span className="grid h-16 w-16 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">{biz.name.slice(0, 1).toUpperCase()}</span>
          )}
          {owner && (
            <>
              <form action={uploadLogoAction} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="sr-only" htmlFor="logo-file">
                  Choose a logo file
                </label>
                <input id="logo-file" type="file" name="logo" accept="image/png,image/jpeg,image/webp" required className="max-w-[16rem] text-sm" />
                <button className="btn-primary">{logo ? "Replace logo" : "Upload logo"}</button>
              </form>
              {logo && (
                <form action={removeLogoAction}>
                  <button className="text-sm text-red-700 hover:underline">Remove logo</button>
                </form>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-stone-500">PNG, JPEG or WebP, up to {Math.round(MAX_LOGO_BYTES / 1000)} KB. A wide logo about 400 px across works best. Without one, the menu shows the first letters of the business name.</p>
      </section>

      {owner && (
        <section className="card space-y-3 p-5" aria-labelledby="bizcolour">
          <div>
            <h2 id="bizcolour" className="text-lg font-semibold">
              Business colour
            </h2>
            <p className="text-sm text-stone-600">The default colour for everyone. Anyone can still choose their own above.</p>
          </div>
          <form action={saveBusinessAccentAction} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Colour
              <select name="accent" defaultValue={biz.brandAccent ?? ""} className="mt-1 block px-3 py-2">
                <option value="">Standard indigo</option>
                {PALETTES.map((p) => (
                  <option key={p.id} value={p.hex}>
                    {p.name}
                  </option>
                ))}
                {biz.brandAccent && !PALETTES.some((p) => p.hex === biz.brandAccent) && <option value={biz.brandAccent}>{biz.brandAccent}</option>}
              </select>
            </label>
            <button className="btn-primary">Save business colour</button>
          </form>
        </section>
      )}
    </div>
  );
}
