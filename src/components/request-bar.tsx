"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatNpr } from "@/features/billing/calc";
import { isLate, requestTitle, waitedMinutes, waitedText, type RequestKind } from "@/features/guest/alerts";

export interface BarRequest {
  id: string;
  kind: RequestKind;
  tableLabel: string;
  createdAt: string;
  orderId: string | null;
  total: number;
}

/**
 * A strip at the top of every staff page while a guest is waiting for the bill or the waiter, so it is seen wherever the person is
 * working (not only on the Orders page, which lists them itself). It turns red once someone has waited too long. The sound and the
 * pop-up come from the alert settings of this device; this is the part that is seen. Water is listed on the Orders page only.
 */
export function RequestBar({ items, done }: { items: BarRequest[]; done: (id: string) => Promise<void> }) {
  const path = usePathname();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const urgent = items.filter((r) => r.kind !== "WATER");
  // The Orders page shows the same requests in full.
  if (urgent.length === 0 || path === "/orders") return null;
  const anyLate = urgent.some((r) => isLate(r.kind, new Date(r.createdAt), now));

  return (
    <section aria-label="Guests waiting" role="alert" className={`mb-4 rounded-xl p-3 ring-1 ${anyLate ? "bg-red-50 ring-red-300" : "bg-amber-50 ring-amber-300"}`}>
      <ul className="flex flex-wrap gap-2">
        {urgent.map((r) => {
          const since = new Date(r.createdAt);
          const late = isLate(r.kind, since, now);
          return (
            <li key={r.id} className={`flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm ${late ? "border-red-300" : "border-stone-200"}`}>
              <span aria-hidden="true">🔔</span>
              <span>
                <strong>{requestTitle(r.kind, r.tableLabel)}</strong>
                {r.kind === "REQUEST_BILL" && r.total > 0 && <span className="text-stone-600"> · {formatNpr(r.total)} so far</span>}
                <span className={late ? "font-medium text-red-700" : "text-stone-500"}> · {waitedText(waitedMinutes(since, now))}</span>
              </span>
              <Link href={r.orderId ? `/orders/${r.orderId}` : "/orders"} className="min-h-9 rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">
                {r.kind === "REQUEST_BILL" && r.orderId ? "Open bill" : "Open"}
              </Link>
              <form action={done.bind(null, r.id)}>
                <button className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50">Done</button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
