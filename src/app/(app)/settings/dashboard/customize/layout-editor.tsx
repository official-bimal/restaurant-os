"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/icons";
import { moveItem, SPAN, toDeviceLayout, verticalTarget, type Device, type Placed, type Size } from "@/features/dashboard/layout";

/**
 * The only place on the dashboard where things can be dragged. Each device (desktop and mobile) has its own order, sizes and hidden
 * widgets. The canvas below uses the same grid and spacing as the real dashboard, so what you see is what you get. Nothing is saved until
 * "Save changes"; "Cancel" leaves the saved dashboard as it was.
 */

export interface WidgetMeta {
  id: string;
  title: string;
  description: string;
  group: string;
  sizes: Size[];
}
interface DeviceState {
  visible: Placed[];
  hidden: Placed[];
}
type State = Record<Device, DeviceState>;

const SIZE_LABEL: Record<Size, string> = { S: "Small", T: "Third", M: "Half", W: "Two thirds", L: "Full width" };
const COLS: Record<Device, string> = { desktop: "grid-cols-12", mobile: "grid-cols-2" };
const SPAN_CLASS: Record<Device, Record<Size, string>> = {
  desktop: { S: "col-span-3", T: "col-span-4", M: "col-span-6", W: "col-span-8", L: "col-span-12" },
  mobile: { S: "col-span-1", T: "col-span-2", M: "col-span-2", W: "col-span-2", L: "col-span-2" },
};

function Tile({ item, meta, device, index, total, onMove, onVertical, onSize, onHide }: { item: Placed; meta: WidgetMeta; device: Device; index: number; total: number; onMove: (d: -1 | 1) => void; onVertical: (d: "up" | "down") => void; onSize: (s: Size) => void; onHide: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const sizes = meta.sizes.filter((s) => SPAN[device][s] !== undefined);
  const btn = "grid size-8 place-items-center rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-40";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${SPAN_CLASS[device][item.size]} min-w-0 ${isDragging ? "z-10 opacity-40" : ""}`}
    >
      <div className="flex h-full min-h-28 flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="flex items-start gap-2">
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${meta.title}. Use the arrow keys after pressing space.`}
            className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 active:cursor-grabbing"
          >
            <Icon name="grip" className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-tight">{meta.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-stone-500">{meta.description}</p>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <button type="button" className={btn} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${meta.title} left`} title="Move left">
            <Icon name="chevron" className="size-4 rotate-180" />
          </button>
          <button type="button" className={btn} onClick={() => onVertical("up")} aria-label={`Move ${meta.title} up`} title="Move up">
            <Icon name="chevron" className="size-4 -rotate-90" />
          </button>
          <button type="button" className={btn} onClick={() => onVertical("down")} aria-label={`Move ${meta.title} down`} title="Move down">
            <Icon name="chevron" className="size-4 rotate-90" />
          </button>
          <button type="button" className={btn} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Move ${meta.title} right`} title="Move right">
            <Icon name="chevron" className="size-4" />
          </button>
          {sizes.length > 1 && (
            <select value={item.size} onChange={(e) => onSize(e.target.value as Size)} aria-label={`Size of ${meta.title}`} className="h-8 rounded-lg px-1.5 text-xs">
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABEL[s]}
                </option>
              ))}
            </select>
          )}
          <button type="button" className={`${btn} ml-auto`} onClick={onHide} aria-label={`Hide ${meta.title}`} title="Hide">
            <Icon name="eyeOff" className="size-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function LayoutEditor({
  widgets,
  initial,
  defaults,
  template,
  templateName,
  save,
}: {
  widgets: WidgetMeta[];
  initial: State;
  defaults: State;
  template: string;
  templateName: string;
  save: (json: string) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [device, setDevice] = useState<Device>("desktop");
  // On a phone the phone layout is the one to edit; the desktop grid scrolls sideways inside its frame.
  useEffect(() => {
    // Reading the screen width is only possible in the browser, after the first paint, so this has to be set here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.innerWidth < 640) setDevice("mobile");
  }, []);
  const [state, setState] = useState<State>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const meta = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const cur = state[device];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const set = (fn: (s: DeviceState) => DeviceState) => setState((s) => ({ ...s, [device]: fn(s[device]) }));
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    set((s) => {
      const from = s.visible.findIndex((p) => p.id === active.id);
      const to = s.visible.findIndex((p) => p.id === over.id);
      return from < 0 || to < 0 ? s : { ...s, visible: arrayMove(s.visible, from, to) };
    });
  };
  const move = (i: number, to: number) => set((s) => ({ ...s, visible: moveItem(s.visible, i, to) }));
  const resize = (id: string, size: Size) => set((s) => ({ ...s, visible: s.visible.map((p) => (p.id === id ? { ...p, size } : p)) }));
  const hide = (id: string) => set((s) => ({ visible: s.visible.filter((p) => p.id !== id), hidden: [...s.hidden, ...s.visible.filter((p) => p.id === id)] }));
  const show = (id: string) => set((s) => ({ visible: [...s.visible, ...s.hidden.filter((p) => p.id === id)], hidden: s.hidden.filter((p) => p.id !== id) }));

  const onSave = () => {
    setError(null);
    const payload = { v: 1, desktop: toDeviceLayout(state.desktop.visible, state.desktop.hidden), mobile: toDeviceLayout(state.mobile.visible, state.mobile.hidden) };
    start(async () => {
      const r = await save(JSON.stringify(payload));
      if (r.error) setError(r.error);
      else {
        router.push("/dashboard");
        router.refresh();
      }
    });
  };

  const active = activeId ? cur.visible.find((p) => p.id === activeId) : null;
  const btnPrimary = "btn-primary";
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div role="tablist" aria-label="Which layout to edit" className="flex rounded-xl bg-stone-100 p-1">
          {(["desktop", "mobile"] as Device[]).map((d) => (
            <button key={d} role="tab" type="button" aria-selected={device === d} onClick={() => setDevice(d)} className={`min-h-9 rounded-lg px-4 text-sm font-medium ${device === d ? "bg-white text-brand-700 shadow-sm" : "text-stone-600"}`}>
              {d === "desktop" ? "Desktop and tablet" : "Phone"}
            </button>
          ))}
        </div>
        <p className="min-w-[12rem] flex-1 text-sm text-stone-500">{device === "desktop" ? "Twelve columns. Drag a card, or use the arrows." : "Two columns, the way it looks on a phone."}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setState(defaults)} disabled={pending || JSON.stringify(state) === JSON.stringify(defaults)}>
            Reset to default
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push("/settings/dashboard")} disabled={pending}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={onSave} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {dirty && !pending && (
        <p role="status" className="text-sm text-amber-800">
          You have changes that are not saved yet.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
        <section aria-label="Live preview of the layout" className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-3 sm:p-4">
          <div className={device === "mobile" ? "mx-auto max-w-[24rem]" : "overflow-x-auto"} data-template={template}>
          <div className={device === "desktop" ? "min-w-[40rem]" : ""}>
            {cur.visible.length === 0 ? (
              <p className="rounded-xl bg-white p-8 text-center text-sm text-stone-500">Every widget is hidden. Show some from the list on the right.</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
                <SortableContext items={cur.visible.map((p) => p.id)} strategy={rectSortingStrategy}>
                  <ul className={`grid gap-2.5 ${COLS[device]}`}>
                    {cur.visible.map((p, i) => {
                      const m = meta.get(p.id);
                      if (!m) return null;
                      return (
                        <Tile
                          key={p.id}
                          item={p}
                          meta={m}
                          device={device}
                          index={i}
                          total={cur.visible.length}
                          onMove={(dir) => move(i, i + dir)}
                          onVertical={(dir) => move(i, verticalTarget(cur.visible, device, i, dir))}
                          onSize={(s) => resize(p.id, s)}
                          onHide={() => hide(p.id)}
                        />
                      );
                    })}
                  </ul>
                </SortableContext>
                <DragOverlay>{active && meta.get(active.id) ? <div className="rounded-xl border border-brand-500 bg-white p-3 text-sm font-semibold shadow-xl">{meta.get(active.id)!.title}</div> : null}</DragOverlay>
              </DndContext>
            )}
          </div>
          </div>
          <p className="mt-3 text-center text-xs text-stone-500">Template: {templateName}. Sizes and spacing follow the template you chose.</p>
        </section>

        <aside aria-label="Hidden widgets" className="card h-fit p-4">
          <h2 className="font-semibold">Hidden widgets</h2>
          <p className="mt-0.5 text-xs text-stone-500">Hidden here only on {device === "desktop" ? "desktop and tablet" : "phones"}.</p>
          {cur.hidden.length === 0 ? (
            <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-500">Nothing is hidden.</p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {cur.hidden.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{meta.get(p.id)?.title ?? p.id}</span>
                  <button type="button" className="btn-secondary !min-h-8 !px-3" onClick={() => show(p.id)} aria-label={`Show ${meta.get(p.id)?.title ?? p.id}`}>
                    <Icon name="eye" className="size-4" /> Show
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
