"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removePhotoAction, uploadPhotoAction } from "./actions";

const MAX_SIDE = 900;

/** Shrinks a chosen picture in the browser (longest side 900 px, JPEG) so the upload is small and fast on any phone. */
export async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the photo.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 500_000) return blob;
  }
  throw new Error("That photo is too detailed to shrink enough. Try another one.");
}

export function DishPhoto({ itemId, name, version }: { itemId: string; name: string; version: number | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const blob = await shrink(file);
        const form = new FormData();
        form.set("photo", new File([blob], "dish.jpg", { type: "image/jpeg" }));
        const res = await uploadPhotoAction(itemId, form);
        if (res.error) setError(res.error);
        else router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not use that photo.");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const res = await removePhotoAction(itemId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      {version ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/dish/${itemId}?v=${version}`} alt={`Photo of ${name}`} className="h-16 w-16 rounded-lg object-cover" />
      ) : (
        <div className="grid h-16 w-16 place-items-center rounded-lg bg-stone-200 text-xs text-stone-500">No photo</div>
      )}
      <div className="space-y-1 text-sm">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id={`photo-${itemId}`} onChange={(e) => choose(e.target.files?.[0])} />
        <div className="flex gap-2">
          <label
            htmlFor={`photo-${itemId}`}
            className={`inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-stone-300 px-3 ${pending ? "opacity-60" : ""}`}
          >
            {pending ? "Working…" : version ? "Change photo" : "Add photo"}
          </label>
          {version ? (
            <button type="button" onClick={remove} disabled={pending} className="min-h-9 rounded-lg border border-stone-300 px-3 text-red-700 disabled:opacity-60">
              Remove
            </button>
          ) : null}
        </div>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
