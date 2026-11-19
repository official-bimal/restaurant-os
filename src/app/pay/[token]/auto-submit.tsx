"use client";

import { useEffect, useRef } from "react";

/** Sends the customer on to eSewa with the signed form, as soon as the page opens. A button is there in case that is blocked. */
export function EsewaForm({ action, fields }: { action: string; fields: Record<string, string> }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.submit();
  }, []);
  return (
    <form ref={form} method="POST" action={action} className="mt-4">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className="min-h-12 w-full rounded-xl bg-[#60bb46] px-4 text-base font-semibold text-white">Continue to eSewa</button>
    </form>
  );
}
