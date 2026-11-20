"use client";

import { useState } from "react";
import Link from "next/link";
import { formatNpr } from "@/features/billing/calc";
import { tableShape } from "@/lib/table-shape";
import { TableDrawing } from "@/components/table-drawing";
import { hasPlan, planWidthPercent, resolvePlan } from "@/lib/floor-plan";
import { createOrderAction } from "./actions";
import { moveFromFloorAction } from "./restructure-actions";

export interface MapTable {
  id: string;
  label: string;
  capacity: number;
  /** The open order at this table (the first one when the bill was split), or null when the table is free. */
  orderId: string | null;
  bills: number;
  items: number;
  total: number;
  served: boolean;
  /** Something needs the waiter: a guest order to accept, or a call for the waiter or the bill. */
  alert: string | null;
  /** Where it sits on the floor plan (thousandths of the plan's width and height), or null when not placed. */
  posX: number | null;
  posY: number | null;
  /** A confirmed booking today that holds this table (the next one that still counts). */
  reserved?: { id: string; line: string; state: "later" | "soon" | "due" | "late" } | null;
}

export interface MapArea {
  id: string;
  name: string;
  tables: MapTable[];
}

/**
 * The floor map staff use to start or open a table's order: tabs for the areas, and the tables drawn as they are (round for small
 * parties, long for big ones). Tap a free table to start its order; tap a table that has one to open it. A table that needs someone
 * (a guest's order waiting, a call for the waiter or the bill) wears an amber ring and a bell.
 *
 * "Move a table" is for a party that changes seats: pick the table that is moving, then the free table they are moving to (or drag one
 * onto the other), and confirm. Everything on the old table, every bill, goes with them.
 */
export function TableMap({ areas, keyBase, canCreate, canMove = false }: { areas: MapArea[]; keyBase: string; canCreate: boolean; canMove?: boolean }) {
  const [active, setActive] = useState(areas[0]?.id ?? "");
  const [moving, setMoving] = useState(false);
  const [from, setFrom] = useState<MapTable | null>(null);
  const [to, setTo] = useState<MapTable | null>(null);
  const stopMoving = () => {
    setMoving(false);
    setFrom(null);
    setTo(null);
  };
  const area = areas.find((a) => a.id === active) ?? areas[0];
  if (!area) return <p className="text-sm text-stone-500">No tables yet. Add them under Tables.</p>;

  const busyCount = area.tables.filter((t) => t.orderId).length;

  const tile = (t: MapTable, compact = false) => {
    const busy = !!t.orderId;
    // A table held for a booking that is about to arrive (or is late) is outlined in violet, so nobody seats a walk-in there.
    const holding = t.reserved && (t.reserved.state === "soon" || t.reserved.state === "due" || t.reserved.state === "late");
    const ring = t.alert ? "ring-2 ring-amber-400" : holding ? "ring-2 ring-violet-400" : "ring-1 ring-stone-200";
    const inner = (
      <>
        {t.alert && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950" title={t.alert}>
            🔔
          </span>
        )}
        {busy && !t.alert && (
          <span aria-hidden="true" className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-emerald-600 text-[11px] text-white">
            ✓
          </span>
        )}
        <TableDrawing capacity={t.capacity} busy={busy} label={t.label} className={compact ? "mx-auto h-12 w-full" : "mx-auto h-24 w-full"} />
        <span className="mt-1 block text-center text-xs leading-tight">
          {busy ? (
            <>
              <span className="block font-semibold text-stone-900">{formatNpr(t.total)}</span>
              <span className="block text-stone-500">
                {t.items} item{t.items === 1 ? "" : "s"}
                {t.bills > 1 ? ` · ${t.bills} bills` : ""}
                {t.served ? " · served" : ""}
              </span>
              {t.alert && <span className="block font-medium text-amber-800">{t.alert}</span>}
              {holding && <span className="block font-medium text-violet-800">Booked: {t.reserved!.line.replace(/^(Reserved|Late:) /, "")}</span>}
            </>
          ) : (
            <>
              <span className="block text-stone-500">{compact ? "free" : `${t.capacity} seats`}</span>
              {t.reserved && <span className={`block font-medium ${holding ? "text-violet-800" : "text-stone-500"}`}>{t.reserved.line}</span>}
            </>
          )}
        </span>
      </>
    );
    const picked = from?.id === t.id || to?.id === t.id;
    const cls = `relative block w-full ${compact ? "rounded-xl p-1 pt-2" : "rounded-2xl p-2 pt-3"} bg-white text-left shadow-sm ${picked ? "ring-2 ring-brand-600" : ring} active:bg-stone-50`;
    if (moving && canMove) {
      // Move mode: a busy table is picked up, a free table receives it. Tapping or dragging both work.
      if (busy) {
        return (
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.id);
              setFrom(t);
              setTo(null);
            }}
            onClick={() => {
              setFrom(from?.id === t.id ? null : t);
              setTo(null);
            }}
            className={`${cls} cursor-grab`}
            aria-pressed={from?.id === t.id}
            aria-label={`${t.label}, with an order. ${from?.id === t.id ? "Picked: now choose a free table." : "Pick it to move it."}`}
          >
            {inner}
          </button>
        );
      }
      return (
        <button
          type="button"
          disabled={!from}
          onClick={() => from && setTo(t)}
          onDragOver={(e) => from && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (from) setTo(t);
          }}
          className={`${cls} ${from ? "outline-2 outline-dashed outline-offset-2 outline-emerald-500" : "opacity-60"}`}
          aria-label={`${t.label}, free. ${from ? `Move ${from.label} here.` : "Pick a table with an order first."}`}
        >
          {inner}
        </button>
      );
    }
    if (busy) {
      return (
        <Link href={`/orders/${t.orderId}`} className={cls} aria-label={`${t.label}, open order, ${formatNpr(t.total)}. Open it.`}>
          {inner}
        </Link>
      );
    }
    if (!canCreate) {
      return (
        <div className={`${cls} opacity-70`} aria-label={`${t.label}, free`}>
          {inner}
        </div>
      );
    }
    return (
      <form action={createOrderAction}>
        <input type="hidden" name="type" value="DINE_IN" />
        <input type="hidden" name="tableId" value={t.id} />
        {/* One key per table per page: a double tap on a table makes one order, and tapping another table is a different order. */}
        <input type="hidden" name="idempotencyKey" value={`${keyBase}-${t.id}`} />
        <button className={cls} aria-label={`${t.label}, free, ${t.capacity} seats. Start an order.`}>
          {inner}
        </button>
      </form>
    );
  };

  return (
    <div>
      {areas.length > 1 && (
        <div role="tablist" aria-label="Areas" className="no-scrollbar -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {areas.map((a) => {
            const open = a.tables.filter((t) => t.orderId).length;
            return (
              <button
                key={a.id}
                role="tab"
                aria-selected={a.id === area.id}
                onClick={() => setActive(a.id)}
                className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-medium ${a.id === area.id ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
              >
                {a.name}
                {open > 0 && <span className={`ml-2 rounded-full px-1.5 text-xs ${a.id === area.id ? "bg-white/20" : "bg-stone-100"}`}>{open}</span>}
              </button>
            );
          })}
        </div>
      )}
      {canMove && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs text-stone-500">
            {moving ? "Moving a party: pick the table they are leaving, then a free table." : `${area.tables.length - busyCount} free · ${busyCount} with an order. Tap a free table to start an order, or a busy one to open it.`}
          </p>
          <button type="button" aria-pressed={moving} onClick={() => (moving ? stopMoving() : setMoving(true))} className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${moving ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300 bg-white hover:bg-stone-50"}`}>
            {moving ? "Done moving" : "Move a table"}
          </button>
        </div>
      )}
      {moving && from && (
        <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand-600 bg-brand-50 p-3 text-sm">
          {to ? (
            <>
              <span className="min-w-0 flex-1">
                Move <strong>{from.label}</strong> ({formatNpr(from.total)}, {from.items} item{from.items === 1 ? "" : "s"}) to <strong>{to.label}</strong>? Every bill at the table moves. Guests who ordered by phone must scan the new table&apos;s QR code.
              </span>
              <form action={moveFromFloorAction} className="flex gap-2">
                <input type="hidden" name="orderId" value={from.orderId ?? ""} />
                <input type="hidden" name="tableId" value={to.id} />
                <input type="hidden" name="fromLabel" value={from.label} />
                <input type="hidden" name="toLabel" value={to.label} />
                <button className="btn-primary">Move</button>
              </form>
              <button type="button" className="btn-secondary" onClick={() => setTo(null)}>
                Choose another
              </button>
            </>
          ) : (
            <span className="min-w-0 flex-1">
              Moving <strong>{from.label}</strong>. Now tap the free table they are moving to{areas.length > 1 ? " (you can switch areas above)" : ""}.
            </span>
          )}
          <button type="button" className="btn-secondary" onClick={stopMoving}>
            Cancel
          </button>
        </div>
      )}
      {!canMove && (
        <p className="mb-2 text-xs text-stone-500">
          {area.tables.length - busyCount} free · {busyCount} with an order. Tap a free table to start an order, or a busy one to open it.
        </p>
      )}
      {area.tables.length === 0 ? (
        <p className="text-sm text-stone-500">No tables in {area.name}.</p>
      ) : hasPlan(area.tables) ? (
        <div className="relative aspect-[4/3] min-h-[320px] w-full overflow-hidden rounded-2xl bg-stone-100 ring-1 ring-stone-200" aria-label={`Floor plan of ${area.name}`}>
          {(() => {
            const where = resolvePlan(area.tables);
            return area.tables.map((t) => {
              const at = where.get(t.id)!;
              return (
                <div key={t.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${at.x / 10}%`, top: `${at.y / 10}%`, width: `${planWidthPercent(t.capacity)}%`, minWidth: "4.5rem" }}>
                  {tile(t, true)}
                </div>
              );
            });
          })()}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {area.tables.map((t) => (
            <li key={t.id} className={tableShape(t.capacity).width > 120 ? "col-span-2" : ""}>
              {tile(t)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
