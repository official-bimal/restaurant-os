import { requireTenant } from "@/server/auth";
import { charsPerLine } from "@/lib/pdf";
import { getPrintConfig, hasAgentKey, paperFor } from "@/features/printing/server/settings";
import { listJobs } from "@/features/printing/server/queue";
import { layoutKitchen, layoutReceipt, type KitchenData, type ReceiptData } from "@/features/printing/layout";
import { AutoRefresh } from "@/components/auto-refresh";
import { AgentKeyBox } from "./agent-key";
import { cancelJobAction, retryJobAction, savePrintSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

const SAMPLE_RECEIPT: ReceiptData = {
  business: "Your Cafe",
  pan: "123456789",
  branch: "Main branch",
  address: "Lakeside, Pokhara",
  invoiceNumber: 1042,
  orderNumber: 217,
  when: "16 Nov 2026, 12:29",
  where: "Table 4",
  customer: "Sita Rai",
  lines: [
    { name: "Buff Momo", quantity: 2, total: 50_000, complimentary: false, note: "extra spicy", addOns: ["Cheese"] },
    { name: "Masala Tea", quantity: 2, total: 16_000, complimentary: false, note: null, addOns: [] },
    { name: "Water", quantity: 1, total: 0, complimentary: true, note: null, addOns: [] },
  ],
  subtotal: 66_000,
  discount: 6_600,
  loyaltyDiscount: 0,
  serviceCharge: 5_940,
  vat: 7_722,
  deliveryFee: 0,
  roundOff: 38,
  grandTotal: 73_100,
  payments: [{ method: "CASH", amount: 50_000 }, { method: "QR", amount: 23_100 }],
  creditNotes: [],
};
const SAMPLE_KITCHEN: KitchenData = {
  branch: "Main branch",
  title: "Table 4",
  number: 217,
  time: "12:29",
  note: "Allergy: no nuts",
  groups: [
    { station: "Grill", items: [{ quantity: 2, name: "Buff Momo", note: "extra spicy", addOns: ["Cheese"] }] },
    { station: "Bar", items: [{ quantity: 2, name: "Masala Tea", note: null, addOns: [] }] },
  ],
};

const STATUS_TONE: Record<string, string> = { QUEUED: "bg-amber-100 text-amber-900", PRINTED: "bg-green-100 text-green-900", FAILED: "bg-red-100 text-red-800", CANCELLED: "bg-stone-200 text-stone-700" };

export default async function PrintingPage({ searchParams }: PageProps<"/printing">) {
  const ctx = await requireTenant("print.manage");
  const q = await searchParams;
  const [cfg, jobs, hasKey] = await Promise.all([getPrintConfig(ctx.businessId), listJobs(ctx), hasAgentKey(ctx.businessId)]);
  const page = paperFor(cfg);
  const cols = charsPerLine(page);
  const receipt = layoutReceipt(SAMPLE_RECEIPT, cfg, cols);
  const kitchen = layoutKitchen(SAMPLE_KITCHEN, cfg, cols);
  const paperCss = { width: `calc(${cols}ch + 2rem)`, fontSize: "12px", maxWidth: "100%" };
  const preview = (lines: { text: string; bold?: boolean; size?: number }[]) => (
    <pre className="overflow-x-auto rounded-md border border-stone-300 bg-white p-4 font-mono leading-tight shadow-inner" style={paperCss}>
      {lines.map((l, i) => (
        <span key={i} className="block whitespace-pre" style={{ fontWeight: l.bold ? 700 : 400, fontSize: l.size && l.size > 1 ? `${l.size}em` : undefined, lineHeight: 1.3 }}>
          {l.text || " "}
        </span>
      ))}
    </pre>
  );

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={15000} />
      <div>
        <h1 className="text-2xl font-semibold">Printing</h1>
        <p className="text-sm text-stone-500">Paper size, what goes on a slip, and the queue for a connected printer.</p>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
        <form action={savePrintSettingsAction} className="card space-y-4 p-4">
          <h2 className="font-semibold">Paper and layout</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Paper width (mm)
              <input name="paperWidthMm" type="number" min={40} max={300} defaultValue={cfg.paperWidthMm} className={input} />
              <span className="text-xs font-normal text-stone-500">58 and 80 are the common rolls</span>
            </label>
            <label className="text-sm font-medium">
              Paper height (mm)
              <input name="paperHeightMm" type="number" min={50} max={2000} defaultValue={cfg.paperHeightMm ?? ""} placeholder="automatic" className={input} />
              <span className="text-xs font-normal text-stone-500">Empty = as long as the slip</span>
            </label>
            <label className="text-sm font-medium">
              Margin (mm)
              <input name="marginMm" type="number" min={0} max={20} defaultValue={cfg.marginMm} className={input} />
            </label>
            <label className="text-sm font-medium">
              Text size (pt)
              <input name="fontPt" type="number" min={6} max={16} step={0.5} defaultValue={cfg.fontSizeTenthPt / 10} className={input} />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Line under the business name
            <input name="headerLine" maxLength={80} defaultValue={cfg.headerLine ?? ""} placeholder="e.g. Open 7am to 9pm · 061-000000" className={input} />
          </label>
          <label className="block text-sm font-medium">
            Footer line
            <input name="footerLine" maxLength={120} defaultValue={cfg.footerLine} className={input} />
          </label>
          <div className="space-y-2 text-sm">
            {(
              [
                ["showPan", "Show the PAN number", cfg.showPan],
                ["showAddress", "Show the branch address", cfg.showAddress],
                ["showCustomer", "Show the customer's name", cfg.showCustomer],
                ["kitchenLargeText", "Large text on kitchen slips", cfg.kitchenLargeText],
              ] as const
            ).map(([name, label, on]) => (
              <label key={name} className="flex items-center gap-2">
                <input type="checkbox" name={name} defaultChecked={on} className="h-4 w-4" /> {label}
              </label>
            ))}
          </div>
          <label className="block text-sm font-medium">
            Receipt copies
            <input name="receiptCopies" type="number" min={1} max={5} defaultValue={cfg.receiptCopies} className={input + " w-24"} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="autoKitchenPrint" defaultChecked={cfg.autoKitchenPrint} className="mt-1 h-4 w-4" />
            <span>
              <strong>Queue a kitchen slip automatically</strong> whenever items are added to an order. A connected printer prints only the items not printed before.
            </span>
          </label>
          <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Save</button>
        </form>

        <div className="space-y-4">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Preview</h2>
            <p className="text-sm text-stone-500">
              {page.widthMm} mm wide · {page.heightMm ? `${page.heightMm} mm tall` : "automatic height"} · {cols} characters per line. Shows the saved settings with sample data.
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Receipt</p>
            {preview(receipt)}
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Kitchen slip</p>
            {preview(kitchen)}
          </section>
        </div>
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Connect a printer</h2>
        <p className="text-sm text-stone-600">
          The app does not talk to a printer directly (it may be on a server far from your shop). Instead a small program next to the printer asks the app
          &ldquo;anything to print?&rdquo;, prints it, and reports back. Make a key for it here, then see <strong>Printers</strong> in the README for how the program calls the app.
          Until a printer is connected, use <strong>PDF</strong> or <strong>Printer file</strong> from any Print button.
        </p>
        <AgentKeyBox hasKey={hasKey} />
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Print queue · this branch</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing queued. Use &ldquo;Send to printer queue&rdquo; on an order, or switch on automatic kitchen slips.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-24 font-medium">{j.kind === "KITCHEN" ? "Kitchen slip" : j.kind === "RECEIPT" ? "Receipt" : "Credit note"}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[j.status] ?? ""}`}>{j.status.toLowerCase()}</span>
                <span className="text-stone-500">{j.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                {j.attempts > 0 && j.status !== "PRINTED" && <span className="text-xs text-stone-500">tried {j.attempts}×</span>}
                {j.error && <span className="text-xs text-red-700">{j.error}</span>}
                <span className="ml-auto flex gap-2">
                  {j.status === "FAILED" && (
                    <form action={retryJobAction.bind(null, j.id)}>
                      <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs">Try again</button>
                    </form>
                  )}
                  {(j.status === "QUEUED" || j.status === "FAILED") && (
                    <form action={cancelJobAction.bind(null, j.id)}>
                      <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs text-red-700">Cancel</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
