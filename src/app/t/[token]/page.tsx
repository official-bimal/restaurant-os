import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatNpr } from "@/features/billing/calc";
import { getGuestView, getSettledSummary, lookupTable, resolveGuest } from "@/features/guest/server/service";
import { GUEST_COOKIE, verifyGuestToken } from "@/server/session";
import { startOrderingAction } from "./actions";
import { GuestLoyalty, GuestMenu, ServiceButtons } from "./guest-menu";
import { GuestFeedback } from "./guest-feedback";
import { LangSwitch, T } from "./lang";
import type { StringKey } from "@/features/guest/i18n";
import { getDishRatingState, getFeedbackState } from "@/features/feedback/server/service";

export const dynamic = "force-dynamic";

// The token in the URL is a credential: keep it out of search results and Referer headers.
export const metadata: Metadata = {
  title: "Order from your table",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const ITEM_STATUS: Record<string, StringKey> = {
  PENDING: "statusPending",
  PREPARING: "statusPreparing",
  READY: "statusReady",
  SERVED: "statusServed",
  CANCELLED: "statusCancelled",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="guest-dark min-h-screen">
      <div className="mx-auto max-w-lg p-4">
        <LangSwitch />
        {children}
      </div>
    </main>
  );
}

export default async function GuestPage({ params, searchParams }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;

  const table = await lookupTable(token);
  if (!table) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">
          <T k="qrInvalidTitle" />
        </h1>
        <p className="mt-2 text-stone-600">
          <T k="askStaff" />
        </p>
      </Shell>
    );
  }
  if (!table.enabled) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{table.businessName}</h1>
        <p className="mt-2 text-stone-600">
          <T k="orderingOff" />
        </p>
      </Shell>
    );
  }

  const store = await cookies();
  const claims = verifyGuestToken(store.get(GUEST_COOKIE)?.value);
  // A cookie from another table, or from a sitting that has ended, gives no access here.
  const sameTable = claims && claims.tableId === table.tableId ? claims : null;
  const guest = await resolveGuest(sameTable);

  if (!guest) {
    const settled = sameTable ? await getSettledSummary(sameTable) : null;
    const feedback = sameTable && settled?.reason === "PAID" ? await getFeedbackState(sameTable) : null;
    const dishState = sameTable && settled?.reason === "PAID" ? await getDishRatingState(sameTable) : null;
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">{table.businessName}</h1>
        <p className="mt-1 text-stone-600">
          <T k="table" v={{ label: table.tableLabel }} />
        </p>
        {sameTable && settled?.reason === "PAID" && (
          <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-green-900">
            <T k="billSettled" />
          </p>
        )}
        {sameTable && (settled?.reason === "MOVED" || settled?.reason === "MERGED") && (
          <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-900">
            <T k="tableChanged" />
          </p>
        )}
        {sameTable && settled?.reason === "CANCELLED" && (
          <p role="status" className="mt-4 rounded-lg bg-stone-100 p-3 text-stone-800">
            <T k="orderCancelled" />
          </p>
        )}
        {sameTable && !settled && (
          <p role="status" className="mt-4 rounded-lg bg-stone-100 p-3 text-stone-800">
            <T k="sessionEnded" />
          </p>
        )}
        {feedback && (
          <GuestFeedback
            token={token}
            initialRating={feedback.rating}
            initialComment={feedback.comment}
            canSubmit={feedback.canSubmit}
            googleReviewUrl={feedback.googleReviewUrl}
            dishes={dishState?.dishes ?? []}
          />
        )}
        {settled?.reason === "PAID" && settled.hadCustomer && settled.pointsEarned > 0 && (
          <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-green-900">
            <T k="earnedPoints" v={{ points: settled.pointsEarned }} />
          </p>
        )}
        {typeof error === "string" && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">
            {error}
          </p>
        )}
        <form action={startOrderingAction.bind(null, token)} className="mt-6">
          <button className="min-h-12 w-full rounded-xl bg-brand-600 hover:bg-brand-700 px-4 text-lg font-semibold text-white">
            <T k="startOrdering" />
          </button>
        </form>
      </Shell>
    );
  }

  const view = await getGuestView(guest.ctx);
  const bestIds = new Set(view.bestSellerIds);
  const flat = view.menu.flatMap((c) => c.items);
  const best = view.bestSellerIds
    .map((id) => flat.find((i) => i.id === id))
    .filter((i): i is (typeof flat)[number] => !!i)
    .map((i) => ({ id: i.id, name: i.name, price: i.price, groups: i.groups, nameNe: i.nameNe, bestSeller: true, rating: view.dishRatings[i.id] ?? null, photo: i.image ? i.image.updatedAt.getTime() : null }));
  const openKinds = view.requests.map((r) => r.kind);
  const waiting = view.submissions.filter((s) => s.status === "PENDING");
  const rejected = view.submissions.filter((s) => s.status === "REJECTED");

  return (
    <Shell>
      <AutoRefresh everyMs={5000} live={false} />
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{guest.business.name}</h1>
        <p className="text-stone-600">
          <T k="table" v={{ label: guest.tableLabel }} />
        </p>
      </header>

      <div className="mb-5">
        <ServiceButtons token={token} open={openKinds} />
      </div>

      {view.loyalty.enabled && (
        <GuestLoyalty token={token} maskedPhone={view.loyalty.maskedPhone} pointsToEarn={view.loyalty.pointsToEarn} />
      )}

      {waiting.length > 0 && (
        <section aria-label="Waiting for the staff" className="mb-5 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <h2 className="font-semibold">
            <T k="waitingTitle" />
          </h2>
          {waiting.map((s) => (
            <p key={s.id} className="mt-1 text-sm">
              {s.items.map((i) => `${i.quantity} × ${i.name}${i.addOnNames.length ? ` (${i.addOnNames.join(", ")})` : ""}`).join(", ")}
            </p>
          ))}
        </section>
      )}

      {rejected.slice(0, 2).map((s) => (
        <p key={s.id} role="status" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">
          <T k="couldNotTake" /> ({s.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}): {s.rejectReason}
        </p>
      ))}

      {view.orderItems.length > 0 && (
        <section aria-label="Your table's order" className="mb-5 rounded-2xl bg-white p-3 border border-stone-200 shadow-sm">
          <h2 className="mb-1 font-semibold">
            <T k="onYourTable" />
          </h2>
          <ul className="divide-y divide-stone-100">
            {view.orderItems.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                <span className={`flex-1 ${i.status === "CANCELLED" ? "text-stone-400 line-through" : ""}`}>
                  {i.quantity} × {i.name}
                </span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{ITEM_STATUS[i.status] ? <T k={ITEM_STATUS[i.status]!} /> : i.status}</span>
              </li>
            ))}
          </ul>
          {view.bills.length > 1 && (
            <ul className="mt-2 border-t border-stone-100 pt-2 text-sm text-stone-600">
              {view.bills.map((b) => (
                <li key={b.number} className="flex justify-between">
                  <span>
                    <T k="billN" v={{ n: b.number }} />
                  </span>
                  <span>{formatNpr(b.total)}</span>
                </li>
              ))}
            </ul>
          )}
          {view.estimate && (
            <p className="mt-2 flex justify-between border-t border-stone-100 pt-2 font-semibold">
              <span>
                <T k={view.bills.length > 1 ? "estTotalAll" : "estTotal"} />
              </span>
              <span>{formatNpr(view.estimate.grandTotal)}</span>
            </p>
          )}
          <p className="mt-1 text-xs text-stone-500">
            <T k="includesCharges" />
          </p>
        </section>
      )}

      <GuestMenu
        token={token}
        categories={[
          // "Best selling" sits above the normal menu; the same dishes also stay in their own categories.
          ...(best.length > 0 ? [{ id: "best-selling", name: "⭐ Best selling", items: best }] : []),
          ...view.menu.map((c) => ({
            id: c.id,
            name: c.name,
            nameNe: c.nameNe,
            items: c.items.map((i) => ({ id: i.id, name: i.name, price: i.price, groups: i.groups, nameNe: i.nameNe, bestSeller: bestIds.has(i.id), rating: view.dishRatings[i.id] ?? null, photo: i.image ? i.image.updatedAt.getTime() : null })),
          })),
        ]}
      />
    </Shell>
  );
}
