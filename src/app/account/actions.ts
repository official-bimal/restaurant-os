"use server";

import { cookiesSecure } from "@/server/cookie-security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { DomainError, WrongPasswordError } from "@/server/errors";
import { beginPasswordCheck } from "@/features/auth/server/rate-limit";
import { formatWait } from "@/features/auth/rate-limit-policy";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/session";
import { changeOwnPassword } from "@/features/staff/server/service";

export interface PasswordState {
  error?: string;
}

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  // Allowed while a temporary password is still active: this is how it gets replaced.
  const ctx = await requireTenant(undefined, { allowMustChange: true });
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) return { error: "The two new passwords do not match." };

  // Someone holding a stolen session must not be able to guess the current password forever.
  const guard = await beginPasswordCheck(ctx.userId);
  if (!guard.ok) {
    return { error: `Too many attempts. Try again in ${formatWait(guard.retryAfterSeconds)}.` };
  }

  let version: number;
  try {
    version = await changeOwnPassword(ctx, { current, next });
  } catch (e) {
    if (e instanceof DomainError) {
      // Only a wrong current password counts; a too-short new password does not.
      if (!(e instanceof WrongPasswordError)) await guard.release();
      return { error: e.message };
    }
    throw e;
  }
  await guard.release();

  // The change ended every older session; keep this browser signed in with a fresh one.
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(ctx.userId, version), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookiesSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/orders");
}
