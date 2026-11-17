"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--color-brand-50),var(--background)_60%)] p-4">
      <form action={action} className="card w-full max-w-sm space-y-4 p-7 shadow-lg">
        <div className="space-y-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">R</span>
          <div>
            <h1 className="text-2xl font-semibold">Welcome back</h1>
            <p className="text-sm text-stone-500">Sign in to take orders and run the kitchen.</p>
          </div>
        </div>
        <label className="block text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
          />
        </label>
        {state.error && (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        )}
        <button
          disabled={pending}
          className="btn-primary min-h-11 w-full"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
