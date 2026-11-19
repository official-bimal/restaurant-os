import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getProfile } from "@/features/business/server/profile";
import { BUSINESS_TYPES } from "@/features/business/profile";
import { logoAction, removeLogoAction, saveProfileAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function ProfilePage({ searchParams }: PageProps<"/settings/profile">) {
  const ctx = await requireTenant("owner.control");
  const sp = await searchParams;
  const p = await getProfile(ctx);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Business profile</h1>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.saved === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}

      <section className="card flex flex-wrap items-center gap-4 p-5">
        {p.hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/logo?v=${p.logoVersion}`} alt="Logo" className="size-20 rounded-xl border border-stone-200 object-contain" />
        ) : (
          <span className="grid size-20 place-items-center rounded-xl bg-stone-100 text-xs text-stone-500">No logo</span>
        )}
        <form action={logoAction} className="flex flex-wrap items-center gap-2 text-sm">
          <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required className="max-w-[16rem] text-sm" />
          <button className="min-h-10 rounded-lg border border-stone-300 px-4 font-medium hover:bg-stone-50">{p.hasLogo ? "Replace logo" : "Upload logo"}</button>
        </form>
        {p.hasLogo && (
          <form action={removeLogoAction}>
            <button className="text-sm text-red-700 hover:underline">Remove</button>
          </form>
        )}
        <p className="w-full text-xs text-stone-500">PNG, JPEG or WebP, under 300 KB.</p>
      </section>

      <form action={saveProfileAction} className="card grid gap-4 p-5 sm:grid-cols-2">
        <label className="text-sm">
          Name shown to everyone
          <input name="name" required defaultValue={p.name} maxLength={80} className={field} />
        </label>
        <label className="text-sm">
          Legal name (printed on bills)
          <input name="legalName" defaultValue={p.legalName ?? ""} maxLength={120} className={field} placeholder="Nerro Cafe Pvt. Ltd." />
        </label>
        <label className="text-sm">
          PAN / VAT number
          <input name="panNumber" defaultValue={p.panNumber ?? ""} maxLength={20} className={field} />
        </label>
        <label className="text-sm">
          Type
          <select name="businessType" defaultValue={p.businessType ?? ""} className={field}>
            <option value="">Not set</option>
            {BUSINESS_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Phone
          <input name="phone" defaultValue={p.phone ?? ""} inputMode="tel" maxLength={30} className={field} />
        </label>
        <label className="text-sm">
          Email
          <input name="email" type="email" defaultValue={p.email ?? ""} maxLength={120} className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          Address (printed on bills when a branch has none of its own)
          <input name="address" defaultValue={p.address ?? ""} maxLength={200} className={field} />
        </label>
        <label className="text-sm">
          Opening date
          <input name="openedOn" type="date" defaultValue={p.openedOn ?? ""} className={field} />
        </label>
        <label className="text-sm">
          Website
          <input name="website" defaultValue={p.website ?? ""} maxLength={200} className={field} placeholder="https://" />
        </label>
        <label className="text-sm">
          Facebook
          <input name="facebook" defaultValue={p.facebook ?? ""} maxLength={200} className={field} placeholder="nerrocafe" />
        </label>
        <label className="text-sm">
          Instagram
          <input name="instagram" defaultValue={p.instagram ?? ""} maxLength={200} className={field} placeholder="nerrocafe" />
        </label>
        <p className="text-xs text-stone-500 sm:col-span-2">
          Time zone: {p.timezone}. The legal name, PAN and address are what the bill prints; the receipt options on the Printing page still decide whether the PAN and address show.
        </p>
        <div className="sm:col-span-2">
          <button className="min-h-11 rounded-lg bg-brand-600 px-6 font-medium text-white">Save profile</button>
        </div>
      </form>

      <section className="card p-5">
        <h2 className="font-semibold">Bill preview</h2>
        <div className="mx-auto mt-3 max-w-xs rounded-lg border border-dashed border-stone-300 bg-white p-4 text-center font-mono text-xs leading-5">
          <p className="text-base font-bold">{p.legalName ?? p.name}</p>
          {p.address && <p>{p.address}</p>}
          {p.phone && <p>{p.phone}</p>}
          {p.panNumber && <p>PAN: {p.panNumber}</p>}
          <p className="mt-2 border-t border-dashed border-stone-400 pt-2 font-bold">TAX INVOICE</p>
        </div>
      </section>
    </div>
  );
}
