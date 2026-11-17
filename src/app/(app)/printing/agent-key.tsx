"use client";

import { useActionState } from "react";
import { createAgentKeyAction } from "./actions";

/** Makes the key a printer program uses to collect print jobs. The key is shown once and cannot be looked up later. */
export function AgentKeyBox({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState<{ key?: string; error?: string }, FormData>(async () => createAgentKeyAction(), {});
  return (
    <form action={action} className="space-y-2">
      <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50" disabled={pending}>
        {hasKey ? "Make a new printer key (the old one stops working)" : "Make a printer key"}
      </button>
      {state.key && (
        <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Copy this key now. It is shown only once.</p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-xs text-stone-900">{state.key}</code>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
