"use client";

import { useActionState, useState } from "react";
import { createStaffAction, resetPasswordAction, type SecretState } from "./actions";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

function TempPassword({ state }: { state: SecretState }) {
  const [copied, setCopied] = useState(false);
  if (!state.tempPassword) return null;
  return (
    <div role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
      <p>
        Temporary password for <strong>{state.email}</strong>. It is shown <strong>only now</strong>. Give it to them
        privately; they must choose their own at first sign-in.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-base tracking-wide">{state.tempPassword}</code>
        <button
          type="button"
          className="min-h-9 rounded-lg border border-stone-300 bg-white px-3"
          onClick={async () => {
            // The clipboard is only available on secure pages (https or localhost); on a plain-http network address the
            // password is shown on screen to copy by hand.
            try {
              await navigator.clipboard.writeText(state.tempPassword!);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function CreateStaffForm({ roles }: { roles: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<SecretState, FormData>(createStaffAction, {});
  return (
    <div className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
      <h2 className="font-semibold">Add a staff member</h2>
      <form action={action} className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Name
          <input name="name" required maxLength={80} className={input} />
        </label>
        <label className="text-sm font-medium">
          Email (used to sign in)
          <input name="email" type="email" required autoComplete="off" className={input} />
        </label>
        <label className="text-sm font-medium">
          Role
          <select name="role" defaultValue="WAITER" className={input}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button disabled={pending} className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white disabled:opacity-60">
            {pending ? "Adding…" : "Add and create password"}
          </button>
        </div>
      </form>
      {state.error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <TempPassword state={state} />
    </div>
  );
}

export function ResetPasswordButton({ membershipId, name }: { membershipId: string; name: string }) {
  const [state, action, pending] = useActionState<SecretState>(() => resetPasswordAction(membershipId), {});
  return (
    <div>
      <form action={action}>
        <button
          disabled={pending}
          aria-label={`Reset password for ${name}`}
          className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50 disabled:opacity-60"
        >
          {pending ? "Resetting…" : "Reset password"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {state.error}
        </p>
      )}
      <TempPassword state={state} />
    </div>
  );
}
