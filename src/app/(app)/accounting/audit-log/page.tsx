import { requireTenant } from "@/server/auth";
import { currentPeriod } from "@/features/accounting/server/service";
import { getAuditTrail } from "@/features/accounting/server/registers";
import { AccountingTabs, field, pickRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "print.", label: "Bill printing" },
  { value: "refund", label: "Refunds" },
  { value: "voucher.", label: "Vouchers" },
  { value: "bill.", label: "Supplier bills" },
];

export default async function AuditLogPage({ searchParams }: PageProps<"/accounting/audit-log">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.today, to: p.today });
  const action = typeof sp.action === "string" && FILTERS.some((f) => f.value === sp.action) ? sp.action : "";
  const events = await getAuditTrail(ctx, { from, to, action: action || undefined });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <AccountingTabs current="/accounting/audit-log" />
      <RangeForm
        from={from}
        to={to}
        extra={
          <label className="text-sm">
            Show
            <select name="action" defaultValue={action} className={field}>
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <section className="card overflow-x-auto p-4">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="py-1">When</th>
              <th className="py-1">Who</th>
              <th className="py-1">What</th>
              <th className="py-1">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-stone-600">
                  Nothing in this period.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-t border-stone-100 align-top">
                <td className="py-1 whitespace-nowrap">{e.at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" })}</td>
                <td className="py-1">{e.who}</td>
                <td className="py-1">{e.action}</td>
                <td className="py-1 break-all text-xs text-stone-600">{e.detail ? JSON.stringify(e.detail).slice(0, 200) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 500 && <p className="mt-2 text-xs text-stone-500">Showing the latest 500. Choose a shorter period to see the rest.</p>}
      </section>
    </div>
  );
}
