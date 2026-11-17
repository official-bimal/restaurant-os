"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "./actions";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Current password
        <input name="current" type="password" autoComplete="current-password" required className={input} />
      </label>
      <label className="block text-sm font-medium">
        New password (at least 10 characters)
        <input name="next" type="password" autoComplete="new-password" required minLength={10} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Repeat new password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={10} className={input} />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="min-h-11 w-full rounded-lg bg-brand-600 hover:bg-brand-700 px-4 py-2 font-medium text-white disabled:opacity-60">
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
