"use client";

import { useState } from "react";
import Link from "next/link";
import { formatNpr } from "@/features/billing/calc";
import { tableShape } from "@/lib/table-shape";
import { createOrderAction } from "./actions";

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
}

export interface MapArea {
  id: string;
  name: string;
  tables: MapTable[];
}

/** One table, drawn with its chairs. Free tables are grey; a table with an open order is teal and shows what is on it. */
function Drawing({ capacity, busy, label }: { capacity: number; busy: boolean; label: string }) {
  const shape = tableShape(capacity);
  const body = busy ? "#0f857a" : "#e7e5e4";
  const chair = busy ? "#6cc4ba" : "#d0cdca";
  return (
    <svg viewBox={`0 0 ${shape.width} ${shape.height}`} className="mx-auto h-24 w-full" aria-hidden="true">
      {shape.seats.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={4} fill={chair} transform={`rotate(${s.rotate} ${s.x + s.w / 2} ${s.y + s.h / 2})`} />
      ))}
      {shape.body.kind === "circle" ? (
        <circle cx={shape.body.cx} cy={shape.body.cy} r={shape.body.r} fill={body} />
      ) : (
        <rect x={shape.body.x} y={shape.body.y} width={shape.body.w} height={shape.body.h} rx={10} fill={body} />
      )}
      <text
        x={shape.body.kind === "circle" ? shape.body.cx : shape.body.x + shape.body.w / 2}
        y={shape.body.kind === "circle" ? shape.body.cy : shape.body.y + shape.body.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={label.length > 3 ? 14 : 18}
        fontWeight={700}
        fill={busy ? "#ffffff" : "#44403c"}
      >
        {label}
      </text>
    </svg>
  );
}

/**
 * The floor map staff use to start or open a table's order: tabs for the areas, and the tables drawn as they are (round for small
 * parties, long for big ones). Tap a free table to start its order; tap a table that has one to open it. A table that needs someone
 * (a guest's order waiting, a call for the waiter or the bill) wears an amber ring and a bell.
 */
export function TableMap({ areas, keyBase, canCreate }: { areas: MapArea[]; keyBase: string; canCreate: boolean }) {
  const [active, setActive] = useState(areas[0]?.id ?? "");
  const area = areas.find((a) => a.id === active) ?? areas[0];
  if (!area) return <p className="text-sm text-stone-500">No tables yet. Add them under Tables.</p>;

  const busyCount = area.tables.filter((t) => t.orderId).length;

  const tile = (t: MapTable) => {
    const busy = !!t.orderId;
    const ring = t.alert ? "ring-2 ring-amber-400" : "ring-1 ring-stone-200";
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
        <Drawing capacity={t.capacity} busy={busy} label={t.label} />
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
            </>
          ) : (
            <span className="block text-stone-500">{t.capacity} seats</span>
          )}
        </span>
      </>
    );
    const cls = `relative block w-full rounded-2xl bg-white p-2 pt-3 text-left shadow-sm ${ring} active:bg-stone-50`;
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
      <p className="mb-2 text-xs text-stone-500">
        {area.tables.length - busyCount} free · {busyCount} with an order. Tap a free table to start an order, or a busy one to open it.
      </p>
      {area.tables.length === 0 ? (
        <p className="text-sm text-stone-500">No tables in {area.name}.</p>
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
