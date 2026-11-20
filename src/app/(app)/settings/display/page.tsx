import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireTenant } from "@/server/auth";
import { baseUrlFrom } from "@/features/payments/server/base-url";
import { getSetting, listDisplays } from "@/features/display/server/service";
import { MAX_QR_BYTES } from "@/features/display/display";
import { AutoRefresh } from "@/components/auto-refresh";
import { addDisplayAction, deleteDisplayAction, newLinkAction, removeQrAction, renameDisplayAction, saveSettingAction, uploadQrAction } from "./actions";
import { OpenButtons } from "./open-buttons";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function DisplaySettingsPage({ searchParams }: PageProps<"/settings/display">) {
  const ctx = await requireTenant("display.manage");
  const q = await searchParams;
  const [setting, displays] = await Promise.all([getSetting(ctx.businessId), listDisplays(ctx)]);
  const base = baseUrlFrom(await headers());
  const local = /^https?:\/\/(localhost|127\.)/.test(base);
  const screens = await Promise.all(
    displays.map(async (d) => {
      const url = `${base}/display/${d.token}`;
      return { ...d, url, path: `/display/${d.token}`, qr: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    }),
  );
  const now = new Date().getTime();

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={20000} />
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Customer display</h1>
      </div>
      <p className="text-sm text-stone-600">
        A screen the customer can see while you ring them up: their bill as it is built, then the QR to pay, then a thank-you. It is optional, and it works whichever way your counter is set up: a second monitor, a tablet, or just the till laptop turned around.
      </p>
      {typeof q.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {q.error}
        </p>
      )}
      {typeof q.note === "string" && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {q.note}
        </p>
      )}

      <form action={saveSettingAction} className="card space-y-4 p-5">
        <h2 className="font-semibold">Turn it on</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={setting.enabled} className="mt-1 size-4" />
          <span>
            <strong>Use the customer display</strong>
            <span className="block text-stone-500">Off: every screen shows only a &ldquo;switched off&rdquo; note and the till shows no display controls.</span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Welcome heading
            <input name="welcomeTitle" maxLength={60} defaultValue={setting.welcomeTitle ?? ""} placeholder="Welcome" className={input} />
          </label>
          <label className="text-sm font-medium">
            Welcome line
            <input name="welcomeText" maxLength={160} defaultValue={setting.welcomeText ?? ""} placeholder="Your bill will appear here as it is made." className={input} />
          </label>
          <label className="text-sm font-medium">
            Thank-you message
            <input name="thanksText" maxLength={160} defaultValue={setting.thanksText ?? ""} placeholder="Thank you! Please come again." className={input} />
          </label>
          <label className="text-sm font-medium">
            Thank-you stays (seconds)
            <input name="thanksSeconds" type="number" min={3} max={120} defaultValue={setting.thanksSeconds} className={input} />
          </label>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="showLogo" defaultChecked={setting.showLogo} className="size-4" /> Show the business logo (uploaded under Appearance &amp; branding)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="showNotes" defaultChecked={setting.showNotes} className="size-4" /> Show item notes such as &ldquo;no sugar&rdquo;
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="autoQr" defaultChecked={setting.autoQr} disabled={!setting.hasQr} className="mt-1 size-4" />
            <span>
              Always show the payment QR beside the total
              <span className="block text-xs text-stone-500">{setting.hasQr ? "Otherwise the cashier shows it with a button on the order page." : "Upload a payment QR below first."}</span>
            </span>
          </label>
          <label className="block font-medium">
            Words above the payment QR
            <input name="qrLabel" maxLength={40} defaultValue={setting.qrLabel ?? ""} placeholder="Scan to pay with Fonepay" className={`${input} sm:max-w-sm`} />
          </label>
        </div>
        <button className="btn-primary">Save</button>
      </form>

      <section className="card space-y-3 p-5" aria-labelledby="qr">
        <div>
          <h2 id="qr" className="font-semibold">
            Payment QR
          </h2>
          <p className="text-sm text-stone-600">
            Your fixed Fonepay, bank or wallet QR (the sticker you may already have), shown beside the total so a customer can scan and pay. It has no amount in it, so the screen shows the amount to enter. When you start an eSewa or Khalti payment from the order page, the screen shows that
            payment&apos;s own QR instead, with the amount filled in.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {setting.hasQr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/display-qr?v=${setting.qrVersion}`} alt="Your payment QR" className="size-32 rounded-xl border border-stone-200 bg-white object-contain p-1" />
          ) : (
            <span className="grid size-32 place-items-center rounded-xl bg-stone-100 text-xs text-stone-500">No QR yet</span>
          )}
          <form action={uploadQrAction} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="sr-only" htmlFor="qr-file">
              Choose the QR picture
            </label>
            <input id="qr-file" type="file" name="qr" accept="image/png,image/jpeg,image/webp" required className="max-w-[16rem] text-sm" />
            <button className="btn-secondary">{setting.hasQr ? "Replace" : "Upload"}</button>
          </form>
          {setting.hasQr && (
            <form action={removeQrAction}>
              <button className="text-sm text-red-700 hover:underline">Remove</button>
            </form>
          )}
        </div>
        <p className="text-xs text-stone-500">PNG, JPEG or WebP, up to {Math.round(MAX_QR_BYTES / 1000)} KB. Use a clear, square picture of the QR on its own.</p>
      </section>

      <section className="space-y-4" aria-labelledby="screens">
        <h2 id="screens" className="font-semibold">
          Screens at this branch
        </h2>
        {screens.length === 0 && <p className="card p-5 text-sm text-stone-600">No screens yet. Add one for each place a customer will look: &ldquo;Counter&rdquo;, &ldquo;Tablet&rdquo;. Even a laptop-only counter needs one, so the till knows what to show.</p>}
        {screens.map((d) => {
          const seen = d.followedAt ? Math.round((now - d.followedAt.getTime()) / 1000) : null;
          return (
            <article key={d.id} className="card space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{d.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${seen !== null && seen <= 60 ? "bg-green-100 text-green-900" : "bg-stone-200 text-stone-700"}`}>{seen !== null && seen <= 60 ? "Showing an order now" : "Idle"}</span>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-2 rounded-xl border border-stone-200 p-4">
                  <h4 className="text-sm font-semibold">Second monitor</h4>
                  <p className="text-xs text-stone-500">A dual-screen till: a window on the customer&apos;s monitor, full screen.</p>
                  <OpenButtons url={d.path} label={d.id} />
                </div>
                <div className="space-y-2 rounded-xl border border-stone-200 p-4">
                  <h4 className="text-sm font-semibold">Just this laptop</h4>
                  <p className="text-xs text-stone-500">
                    No second screen? On the order page press <strong>Show to customer</strong>: the bill fills this screen, and one button brings the till back. Nothing to set up here beyond having a screen added.
                  </p>
                </div>
                <div className="space-y-2 rounded-xl border border-stone-200 p-4">
                  <h4 className="text-sm font-semibold">Another device</h4>
                  <p className="text-xs text-stone-500">A tablet or phone facing the customer: open this link on it, or scan.</p>
                  <div className="flex items-center gap-3">
                    <div className="size-24 shrink-0 rounded-lg bg-white p-1 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: d.qr }} role="img" aria-label={`QR code to open ${d.name} on another device`} />
                    <code className="min-w-0 select-all break-all text-xs text-stone-700">{d.url}</code>
                  </div>
                  {local && <p className="text-xs text-amber-800">This address only works on this computer. Open Settings from the shop PC&apos;s network address (for example http://192.168.1.10:3000), or set APP_URL, to get a link a tablet can open.</p>}
                </div>
              </div>

              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand-700">Rename, new link or remove</summary>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <form action={renameDisplayAction.bind(null, d.id)} className="flex flex-wrap items-end gap-3">
                    <label className="text-sm">
                      Name
                      <input name="name" defaultValue={d.name} required maxLength={40} className={input} />
                    </label>
                    <button className="btn-primary">Save</button>
                  </form>
                  <form action={newLinkAction.bind(null, d.id)}>
                    <button className="btn-secondary" title="Stops the current link working">
                      Make a new link
                    </button>
                  </form>
                  <form action={deleteDisplayAction.bind(null, d.id)}>
                    <button className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50">Remove screen</button>
                  </form>
                </div>
              </details>
            </article>
          );
        })}
        <form action={addDisplayAction} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            New screen
            <input name="name" required maxLength={40} placeholder="Counter, Tablet" className={`${input} w-56`} />
          </label>
          <button className="btn-primary">Add screen</button>
        </form>
      </section>
    </div>
  );
}
