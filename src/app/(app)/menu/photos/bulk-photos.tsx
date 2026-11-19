"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { matchDish, type DishRef } from "@/features/menu/photo-match";
import { shrink } from "../dish-photo";
import { uploadPhotoAction } from "../actions";

interface Row {
  key: string;
  file: File;
  dishId: string;
  state: "ready" | "working" | "done" | "failed";
  message?: string;
}

/** Choose many photos at once. Each is matched to a dish by its file name; fix any that are wrong or unmatched, then upload. */
export function BulkPhotos({ dishes, withPhoto }: { dishes: DishRef[]; withPhoto: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const has = new Set(withPhoto);

  const choose = (files: FileList | null) => {
    if (!files) return;
    const picked = [...files].slice(0, 120).map<Row>((file, i) => ({ key: `${i}-${file.name}-${file.size}`, file, dishId: matchDish(file.name, dishes)?.id ?? "", state: "ready" }));
    setRows(picked);
  };

  const setDish = (key: string, dishId: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, dishId } : x)));
  const patch = (key: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const upload = async () => {
    setBusy(true);
    // Two files for one dish: the last one wins, as if the person had replaced the photo.
    for (const row of rows) {
      if (!row.dishId || row.state === "done") continue;
      patch(row.key, { state: "working", message: undefined });
      try {
        const blob = await shrink(row.file);
        const form = new FormData();
        form.set("photo", new File([blob], "dish.jpg", { type: "image/jpeg" }));
        const res = await uploadPhotoAction(row.dishId, form);
        patch(row.key, res.error ? { state: "failed", message: res.error } : { state: "done" });
      } catch (e) {
        patch(row.key, { state: "failed", message: e instanceof Error ? e.message : "Could not use that photo." });
      }
    }
    setBusy(false);
    router.refresh();
  };

  const ready = rows.filter((r) => r.dishId && r.state !== "done").length;
  const unmatched = rows.filter((r) => !r.dishId).length;

  return (
    <div className="space-y-3">
      <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-stone-300 p-4 text-sm text-stone-700">
        Choose photos (name each file after its dish, like &quot;Cafe Latte.jpg&quot;)
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => choose(e.target.files)} />
      </label>
      {rows.length > 0 && (
        <>
          <p className="text-sm text-stone-600">
            {rows.length} photo{rows.length === 1 ? "" : "s"} chosen: {ready} ready to upload{unmatched ? `, ${unmatched} need a dish` : ""}.
          </p>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={r.file.name}>
                  {r.file.name}
                </span>
                <select
                  value={r.dishId}
                  onChange={(e) => setDish(r.key, e.target.value)}
                  disabled={busy || r.state === "done"}
                  aria-label={`Dish for ${r.file.name}`}
                  className={`min-h-9 max-w-[14rem] rounded-lg border px-2 ${r.dishId ? "border-stone-300" : "border-amber-400 bg-amber-50"}`}
                >
                  <option value="">Choose a dish…</option>
                  {dishes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {has.has(d.id) ? " (has a photo)" : ""}
                    </option>
                  ))}
                </select>
                <span className="w-24 text-right text-xs">
                  {r.state === "done" && <span className="text-emerald-700">Uploaded</span>}
                  {r.state === "working" && "Working…"}
                  {r.state === "failed" && <span className="text-red-700">{r.message}</span>}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={upload} disabled={busy || ready === 0} className="min-h-11 rounded-lg bg-brand-600 px-5 font-medium text-white disabled:opacity-50">
            {busy ? "Uploading…" : `Upload ${ready} photo${ready === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </div>
  );
}
