"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { randomKey } from "@/lib/random-key";
import { dismissBill, loadBills, loadSnapshot, numbersAvailable, parseSnapshot, prepareOffline, retryBill, syncBills, type SavedBill, type StoredSnapshot } from "@/features/offline/client";
import { formatNpr } from "@/features/billing/calc";
import { BillPanel, openReceipt } from "./bill-panel";

type Item = { id: string; name: string; price: number };
type Category = { id: string; name: string; items: Item[] };
type Table = { id: string; label: string; busy: boolean };
type Line = { menuItemId: string; name: string; quantity: number; note: string };
type Saved = {
  key: string;
  branchId: string;
  type: "DINE_IN" | "TAKEAWAY";
  tableId: string | null;
  tableLabel: string;
  takenAt: string;
  items: { menuItemId: string; name: string; quantity: number; note?: string }[];
  /** "queued" waits to be sent; "problem" was refused by the server and needs a person. */
  state: "queued" | "problem";
  message?: string;
  number?: number;
};

const QUEUE = "ros-quick-queue";
const SNAPSHOT = "ros-quick-menu";
const rs = (paisa: number) => `Rs ${(paisa / 100).toLocaleString("en-US", { minimumFractionDigits: paisa % 100 ? 2 : 0 })}`;

function readQueue(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(QUEUE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeQueue(q: Saved[]) {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q));
  } catch {
    /* storage full or blocked: the on-screen list still works for this visit */
  }
}

export function QuickOrder({ branchId, menu, tables }: { branchId: string; menu: Category[]; tables: Table[] }) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<Saved[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [type, setType] = useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [tableId, setTableId] = useState("");
  const [cat, setCat] = useState(menu[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const syncing = useRef(false);
  // Offline billing: the signed menu this phone carries, the bills it has made and how many invoice numbers it has left.
  const [stored, setStored] = useState<StoredSnapshot | null>(null);
  const [bills, setBills] = useState<SavedBill[]>([]);
  const [numbersLeft, setNumbersLeft] = useState(0);
  const [billing, setBilling] = useState(false);
  const [prepNote, setPrepNote] = useState<string | null>(null);
  // The order being built is kept on the phone as it changes, so a reload (or the page coming back from the cache) loses nothing.
  const draftLoaded = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const d = JSON.parse(localStorage.getItem("ros-pos-draft") ?? "null") as { type?: "DINE_IN" | "TAKEAWAY"; tableId?: string; lines?: Line[] } | null;
        if (d) {
          if (d.type === "DINE_IN" || d.type === "TAKEAWAY") setType(d.type);
          if (typeof d.tableId === "string") setTableId(d.tableId);
          if (Array.isArray(d.lines)) setLines(d.lines.filter((l) => l && typeof l.menuItemId === "string" && Number.isInteger(l.quantity)));
        }
      } catch {
        /* a broken draft is simply ignored */
      }
      draftLoaded.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!draftLoaded.current) return;
    try {
      localStorage.setItem("ros-pos-draft", JSON.stringify({ type, tableId, lines }));
    } catch {
      /* ignore */
    }
  }, [type, tableId, lines]);

  const refreshPos = useCallback(() => {
    setStored(loadSnapshot());
    setBills(loadBills());
    setNumbersLeft(numbersAvailable());
  }, []);

  // Keep a copy of the menu on this phone, so the page still has something to show if it is opened with no signal.
  useEffect(() => {
    try {
      localStorage.setItem(SNAPSHOT, JSON.stringify({ branchId, menu, tables, at: Date.now() }));
    } catch {
      /* ignore */
    }
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    // Read the phone's saved orders after the first paint (they do not exist on the server render).
    const t = setTimeout(() => {
      setQueue(readQueue());
      setOnline(navigator.onLine);
      refreshPos();
    }, 0);
    return () => clearTimeout(t);
  }, [branchId, menu, tables, refreshPos]);

  const update = useCallback((fn: (q: Saved[]) => Saved[]) => {
    const next = fn(readQueue());
    writeQueue(next);
    setQueue(next);
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      for (const o of readQueue().filter((x) => x.state === "queued")) {
        let res: Response;
        try {
          res = await fetch("/api/orders/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: o.key,
              branchId: o.branchId,
              type: o.type,
              tableId: o.tableId,
              takenAt: o.takenAt,
              items: o.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, note: i.note })),
            }),
          });
        } catch {
          break; // still no connection: keep everything and try later
        }
        const data = (await res.json().catch(() => null)) as { ok?: boolean; number?: number; error?: string; retry?: boolean } | null;
        if (data?.ok) {
          update((q) => q.filter((x) => x.key !== o.key));
          setStatus(`Order #${data.number} sent.`);
        } else if (data && data.retry === false) {
          update((q) => q.map((x) => (x.key === o.key ? { ...x, state: "problem", message: data.error } : x)));
        } else {
          break; // server trouble: leave it queued
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [update]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void sync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const timer = setInterval(() => void sync(), 15_000);
    void sync();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(timer);
    };
  }, [sync]);

  // While online: refresh the signed menu and top up invoice numbers, then send any saved bills. Quietly does nothing with no connection.
  useEffect(() => {
    const run = async () => {
      if (!navigator.onLine) return;
      setPrepNote(await prepareOffline());
      const r = await syncBills();
      refreshPos();
      if (r.sent > 0) setStatus(`${r.sent} bill${r.sent === 1 ? "" : "s"} recorded on the server.`);
    };
    const quick = async () => {
      if (!navigator.onLine) return;
      const r = await syncBills();
      refreshPos();
      if (r.sent > 0) setStatus(`${r.sent} bill${r.sent === 1 ? "" : "s"} recorded on the server.`);
    };
    void run();
    const fast = setInterval(() => void quick(), 15_000);
    const slow = setInterval(() => void run(), 30 * 60_000);
    const on = () => void run();
    window.addEventListener("online", on);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
      window.removeEventListener("online", on);
    };
  }, [refreshPos]);

  // The menu: what the server signed for this phone when there is one (its prices are the ones a bill will use), else the page's own.
  const posMenu: Category[] = useMemo(() => {
    if (!stored) return menu;
    const snap = parseSnapshot(stored);
    const byCat = new Map<string, Item[]>();
    for (const i of snap.items) byCat.set(i.category, [...(byCat.get(i.category) ?? []), { id: i.id, name: i.name, price: i.price }]);
    return [...byCat].map(([name, its]) => ({ id: `cat:${name}`, name, items: its }));
  }, [stored, menu]);

  const add = (i: Item) =>
    setLines((l) => {
      const at = l.findIndex((x) => x.menuItemId === i.id && !x.note);
      if (at >= 0) return l.map((x, n) => (n === at ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x));
      return [...l, { menuItemId: i.id, name: i.name, quantity: 1, note: "" }];
    });
  const priceOf = (id: string) => posMenu.flatMap((c) => c.items).find((i) => i.id === id)?.price ?? 0;
  const total = lines.reduce((n, l) => n + priceOf(l.menuItemId) * l.quantity, 0);

  function save() {
    if (lines.length === 0) return setStatus("Add at least one item.");
    if (type === "DINE_IN" && !tableId) return setStatus("Choose a table.");
    const table = tables.find((t) => t.id === tableId);
    const order: Saved = {
      key: randomKey(),
      branchId,
      type,
      tableId: type === "DINE_IN" ? tableId : null,
      tableLabel: type === "DINE_IN" ? (table?.label ?? "") : "Takeaway",
      takenAt: new Date().toISOString(),
      items: lines.map((l) => ({ menuItemId: l.menuItemId, name: l.name, quantity: l.quantity, note: l.note.trim() || undefined })),
      state: "queued",
    };
    // Saved on the phone FIRST. Only then is it sent, so a dropped connection mid-send loses nothing.
    update((q) => [...q, order]);
    setLines([]);
    setTableId("");
    setStatus(navigator.onLine ? "Saved. Sending…" : "Saved on this phone. It will be sent when the connection is back.");
    void sync();
  }

  const waiting = queue.filter((o) => o.state === "queued").length;
  const activeCat = posMenu.find((c) => c.id === cat)?.id ?? posMenu[0]?.id ?? "";
  const items = posMenu.find((c) => c.id === activeCat)?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Quick order</h1>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${online ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}
          role="status"
        >
          {online ? "Online" : "Offline: orders are saved here"}
        </span>
        {waiting > 0 && <span className="text-sm text-stone-600">{waiting} waiting to be sent</span>}
      </div>
      <p className="text-sm text-stone-600">
        Works without Wi-Fi once this page has been opened online. Dine-in and takeaway orders of plain dishes can be taken, billed and paid with no
        connection; they are sent when it returns. Delivery, dishes with required choices and spending loyalty points need the connection.
      </p>
      {status && (
        <p role="status" className="rounded-lg bg-stone-100 p-2 text-sm">
          {status}
        </p>
      )}

      <div role="radiogroup" aria-label="Order type" className="flex gap-2">
        {(["DINE_IN", "TAKEAWAY"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={`min-h-11 rounded-xl border px-4 text-sm font-medium ${type === t ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300"}`}
          >
            {t === "DINE_IN" ? "Dine in" : "Takeaway"}
          </button>
        ))}
      </div>
      {type === "DINE_IN" && (
        <label className="block text-sm font-medium">
          Table
          <select value={tableId} onChange={(e) => setTableId(e.target.value)} className="mt-1 block w-full max-w-xs px-3 py-2">
            <option value="">Choose a table</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.busy ? " (was in use)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {posMenu.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            className={`min-h-10 rounded-full border px-3 text-sm ${activeCat === c.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300"}`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => add(i)} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 text-left shadow-sm">
              <span>{i.name}</span>
              <span className="text-sm text-stone-500">{rs(i.price)}</span>
            </button>
          </li>
        ))}
      </ul>

      {billing && stored ? (
        <BillPanel
          stored={stored}
          cart={lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, note: l.note.trim() || undefined }))}
          type={type}
          tableId={type === "DINE_IN" ? tableId : null}
          onBilled={() => {
            setLines([]);
            setTableId("");
            refreshPos();
            void syncBills().then(refreshPos);
          }}
          onClose={() => {
            setBilling(false);
            refreshPos();
          }}
        />
      ) : (
      <section className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
        <h2 className="font-semibold">This order</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-stone-500">Tap dishes to add them.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {lines.map((l, n) => (
              <li key={n} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="mr-auto">
                  {l.quantity} × {l.name}
                </span>
                <input
                  aria-label={`Note for ${l.name}`}
                  placeholder="Note"
                  maxLength={200}
                  value={l.note}
                  onChange={(e) => setLines((all) => all.map((x, i) => (i === n ? { ...x, note: e.target.value } : x)))}
                  className="w-32 px-2 py-1"
                />
                <button type="button" className="min-h-9 px-2 text-red-700" onClick={() => setLines((all) => all.flatMap((x, i) => (i !== n ? [x] : x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : [])))}>
                  −
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm text-stone-600">About {rs(total)} before tax and charges</span>
          <span className="flex gap-2">
            {stored?.canBill && (
              <button
                type="button"
                disabled={numbersLeft === 0}
                onClick={() => {
                  if (lines.length === 0) return setStatus("Add at least one item.");
                  if (type === "DINE_IN" && !tableId) return setStatus("Choose a table.");
                  setStatus("");
                  setBilling(true);
                }}
                className="min-h-11 rounded-lg bg-emerald-600 px-4 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Bill and pay
              </button>
            )}
            <button type="button" onClick={save} className="min-h-11 rounded-lg border border-stone-300 px-4 font-medium hover:bg-stone-50">
              {online ? "Send order" : "Save order"}
            </button>
          </span>
        </div>
        {stored?.canBill && (
          <p className={`mt-2 text-xs ${numbersLeft < 10 ? "text-amber-800" : "text-stone-500"}`}>
            {numbersLeft === 0
              ? "This phone has no invoice numbers left. Connect to the internet once to get more; you can still take orders."
              : `${numbersLeft} invoice numbers ready for working offline.${numbersLeft < 10 ? " Connect to the internet soon to get more." : ""}`}
            {stored ? ` Menu and prices as of ${new Date(stored.fetchedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}
          </p>
        )}
        {prepNote && <p className="mt-1 text-xs text-red-700">{prepNote}</p>}
      </section>
      )}

      {bills.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <h2 className="font-semibold">Bills made on this phone</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {[...bills].reverse().map((b) => (
              <li key={b.bill.key} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>Invoice #{b.invoiceNumber}</strong>
                  <span>{formatNpr(b.receipt.grandTotal)}</span>
                  <span className="text-stone-500">{b.tableLabel} · {new Date(b.createdAt).toLocaleTimeString()}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${b.state === "synced" ? "bg-green-100 text-green-800" : b.state === "queued" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>
                    {b.state === "synced" ? `recorded${b.orderNumber ? ` · order #${b.orderNumber}` : ""}` : b.state === "queued" ? "waiting to send" : "needs a person"}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs" onClick={() => openReceipt(b, stored?.print)}>
                      Receipt
                    </button>
                    {b.state === "problem" && (
                      <button type="button" className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs" onClick={() => { retryBill(b.bill.key); refreshPos(); void syncBills().then(refreshPos); }}>
                        Try again
                      </button>
                    )}
                    {b.state !== "queued" && (
                      <button type="button" className="min-h-9 px-2 text-xs underline" onClick={() => { dismissBill(b.bill.key); refreshPos(); }}>
                        Dismiss
                      </button>
                    )}
                  </span>
                </div>
                {b.state === "problem" && (
                  <p role="alert" className="mt-1 text-red-800">
                    {b.message} The customer has paid and has a receipt: do not lose this bill. Ask the owner.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <h2 className="font-semibold">Saved on this phone</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {queue.map((o) => (
              <li key={o.key} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{o.tableLabel}</strong>
                  <span className="text-stone-500">{new Date(o.takenAt).toLocaleTimeString()}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${o.state === "queued" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>
                    {o.state === "queued" ? "waiting to send" : "needs a person"}
                  </span>
                </div>
                <p className="text-stone-600">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
                {o.state === "problem" && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-red-800">
                      {o.message}
                    </p>
                    <button type="button" className="min-h-9 text-xs underline" onClick={() => update((q) => q.filter((x) => x.key !== o.key))}>
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
