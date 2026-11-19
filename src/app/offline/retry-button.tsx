"use client";

/** Reloads the page the person was trying to reach (the offline page stands in for it, at the same address). */
export function RetryButton() {
  return (
    <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center rounded-full bg-stone-900 px-5 font-medium text-white">
      Try again
    </button>
  );
}
