"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TableDrawing } from "@/components/table-drawing";
import { clampPos, defaultPosition, planWidthPercent, resolvePlan } from "@/lib/floor-plan";
import { savePlanAction } from "./actions";

export interface EditTable {
  id: string;
  label: string;
  capacity: number;
  posX: number | null;
  posY: number | null;
}
export interface EditArea {
  id: string;
  name: string;
  tables: EditTable[];
}

type Pos = Record<string, { x: number; y: number }>;

/** One area's floor plan: drag each table to where it really stands, then save. Arrow keys move the focused table too. */
function AreaPlan({ area }: { area: EditArea }) {
  const router = useRouter();
  const [pos, setPos] = useState<Pos>(() => Object.fromEntries(resolvePlan(area.tables)));
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string } | null>(null);

  const move = (id: string, x: number, y: number) => {
    setPos((p) => ({ ...p, [id]: { x: clampPos(x), y: clampPos(y) } }));
    setDirty(true);
    setNote(null);
  };

  const onDown = (e: React.PointerEvent, id: string) => {
    drag.current = { id };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    move(drag.current.id, ((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000);
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (e: React.KeyboardEvent, id: string) => {
    const step = e.shiftKey ? 80 : 20;
    const at = pos[id]!;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    move(id, at.x + m[0], at.y + m[1]);
  };

  const tidy = () => {
    setPos(Object.fromEntries(area.tables.map((t, i) => [t.id, defaultPosition(i, area.tables.length)])));
    setDirty(true);
    setNote(null);
  };

  const save = () =>
    start(async () => {
      const r = await savePlanAction(area.id, area.tables.map((t) => ({ tableId: t.id, x: pos[t.id]!.x, y: pos[t.id]!.y })));
      if (r.error) setNote({ ok: false, text: r.error });
      else {
        setDirty(false);
        setNote({ ok: true, text: "Saved. The Orders page now shows this plan." });
        router.refresh();
      }
    });

  const clear = () =>
    start(async () => {
      const r = await savePlanAction(area.id, null);
      if (r.error) setNote({ ok: false, text: r.error });
      else {
        setPos(Object.fromEntries(area.tables.map((t, i) => [t.id, defaultPosition(i, area.tables.length)])));
        setDirty(false);
        setNote({ ok: true, text: "Plan cleared. This area is shown in rows again." });
        router.refresh();
      }
    });

  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold">{area.name}</h2>
      {area.tables.length === 0 ? (
        <p className="text-sm text-stone-600">No tables in this area yet.</p>
      ) : (
        <>
          <div
            ref={canvas}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className="relative aspect-[4/3] min-h-[320px] w-full touch-none select-none overflow-hidden rounded-2xl bg-stone-100 ring-1 ring-stone-200"
            style={{ backgroundImage: "linear-gradient(#e7e5e4 1px, transparent 1px), linear-gradient(90deg, #e7e5e4 1px, transparent 1px)", backgroundSize: "10% 10%" }}
          >
            {area.tables.map((t) => {
              const at = pos[t.id]!;
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${t.label}: drag, or use the arrow keys, to move it`}
                  onPointerDown={(e) => onDown(e, t.id)}
                  onKeyDown={(e) => onKey(e, t.id)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-xl bg-white p-1 shadow-md ring-1 ring-stone-300 active:cursor-grabbing active:ring-2 active:ring-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
                  style={{ left: `${at.x / 10}%`, top: `${at.y / 10}%`, width: `${planWidthPercent(t.capacity)}%`, minWidth: "4.5rem" }}
                >
                  <TableDrawing capacity={t.capacity} busy={false} label={t.label} className="mx-auto h-12 w-full" />
                </div>
              );
            })}
          </div>
          {note && (
            <p role={note.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {note.text}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending || !dirty} className="min-h-11 rounded-lg bg-brand-600 px-5 font-medium text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save plan"}
            </button>
            <button type="button" onClick={tidy} disabled={pending} className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm">
              Tidy into a grid
            </button>
            <button type="button" onClick={clear} disabled={pending} className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm text-red-700">
              Clear plan (back to rows)
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function PlanEditor({ areas }: { areas: EditArea[] }) {
  return (
    <div className="space-y-4">
      {areas.map((a) => (
        <AreaPlan key={a.id} area={a} />
      ))}
    </div>
  );
}
