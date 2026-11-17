import { requireTenant } from "@/server/auth";
import { getFeedbackSettings, listDishRatings, listFeedback } from "@/features/feedback/server/service";
import { needsAttention } from "@/features/feedback/rating";
import { formatNpr } from "@/features/billing/calc";
import { resolveFeedbackAction, setFeedbackSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className={needsAttention(rating) ? "text-red-600" : "text-amber-500"}>
      {"★".repeat(rating)}
      <span className="text-stone-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  const ctx = await requireTenant("feedback.view");
  const { error } = await searchParams;
  const [{ summary, items, unresolved, days }, settings, dishes] = await Promise.all([listFeedback(ctx), getFeedbackSettings(ctx), listDishRatings(ctx)]);
  const max = Math.max(1, ...summary.distribution);
  const needing = items.filter((i) => needsAttention(i.rating) && !i.handledAt);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Guest feedback</h1>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {unresolved > 0 && (
        <p role="status" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {unresolved} low rating{unresolved === 1 ? "" : "s"} (3 stars or less) still need a look. Feedback is anonymous, so
          fix the cause where you can and write down what you did.
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <p className="text-xs text-stone-500">Last {days} days</p>
          <p className="text-3xl font-semibold">{summary.average === null ? "No ratings" : `${summary.average.toFixed(1)} ★`}</p>
          <p className="text-sm text-stone-600">
            {summary.count} rating{summary.count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <ul className="space-y-1 text-sm">
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = summary.distribution[stars - 1];
              return (
                <li key={stars} className="flex items-center gap-2">
                  <span className="w-12 text-stone-600">{stars} ★</span>
                  <span className="h-3 flex-1 rounded bg-stone-100">
                    <span
                      className={`block h-3 rounded ${stars <= 3 ? "bg-red-400" : "bg-amber-400"}`}
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right">{count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="font-semibold">Dish ratings</h2>
        <p className="mb-2 text-sm text-stone-500">
          What guests gave each dish in the last {dishes.days} days, lowest first. Anonymous. Guests see a dish&apos;s stars on their menu only from 3 ratings.
        </p>
        {dishes.lines.length === 0 ? (
          <p className="text-sm text-stone-500">No dish has been rated yet. Guests can rate what they had after they pay.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Dish</th>
                  <th className="py-1 pr-3 font-medium">Average</th>
                  <th className="py-1 pr-3 text-right font-medium">Ratings</th>
                  <th className="py-1 font-medium">1 to 5 stars</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {dishes.lines.map((d) => (
                  <tr key={d.menuItemId}>
                    <td className="py-2 pr-3">
                      {d.name}
                      {d.weak && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">look into it</span>}
                      {d.few && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">few ratings</span>}
                    </td>
                    <td className={`py-2 pr-3 font-medium ${d.weak ? "text-red-700" : ""}`}>{d.average.toFixed(1)} ★</td>
                    <td className="py-2 pr-3 text-right">{d.count}</td>
                    <td className="py-2 text-stone-500">{d.distribution.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {needing.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Needs attention</h2>
          <ul className="space-y-3">
            {needing.map((f) => (
              <li key={f.id} className="rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars rating={f.rating} />
                  <span className="text-stone-600">
                    {f.invoice.order.table?.label ?? "Takeaway"} · invoice #{f.invoice.number} · {formatNpr(f.invoice.grandTotal)} ·{" "}
                    {f.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="mt-2">{f.comment ?? <span className="text-stone-500">No comment left.</span>}</p>
                <form action={resolveFeedbackAction.bind(null, f.id)} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
                  <label className="flex-1 font-medium">
                    What did you do about it?
                    <input name="note" required minLength={3} maxLength={300} className={input} />
                  </label>
                  <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Mark as handled</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">All feedback</h2>
        {items.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing yet. Guests are asked for a rating after they pay.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {items.map((f) => (
              <li key={f.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={f.rating} />
                  <span className="text-stone-500">
                    {f.invoice.order.table?.label ?? "Takeaway"} · invoice #{f.invoice.number} ·{" "}
                    {f.createdAt.toLocaleDateString("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short" })}
                  </span>
                  {f.handledAt && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">handled</span>}
                </div>
                {f.comment && <p className="mt-1">{f.comment}</p>}
                {f.handledNote && <p className="mt-1 text-stone-500">Done: {f.handledNote}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={setFeedbackSettingsAction} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="font-semibold">Settings</h2>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.feedbackEnabled} className="h-4 w-4" />
          <span>
            <strong>Ask guests to rate their visit</strong> on their phone after they pay
          </span>
        </label>
        <label className="mt-3 block text-sm font-medium">
          Your Google review link (optional)
          <input name="googleReviewUrl" type="url" defaultValue={settings.googleReviewUrl ?? ""} placeholder="https://g.page/r/..." className={input} />
        </label>
        <p className="mt-1 text-xs text-stone-500">
          Every guest who rates is shown this link, whatever their rating. Showing it only to happy guests is against Google&apos;s
          rules for reviews.
        </p>
        <button className="mt-3 min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Save</button>
      </form>
    </div>
  );
}
