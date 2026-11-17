"use server";

import { cookiesSecure } from "@/server/cookie-security";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { db } from "@/server/db";
import { clientIpFromHeaders } from "@/server/client-ip";
import { beginLogin } from "@/features/auth/server/rate-limit";
import { formatWait } from "@/features/auth/rate-limit-policy";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/session";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Verified against when the email is unknown, so the response time is the same
// whether or not the account exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash("not-a-real-password"));

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  // Rate limit BEFORE any password hashing: a locked-out visitor costs us almost nothing.
  const guard = await beginLogin(parsed.data.email, clientIpFromHeaders(await headers()));
  if (!guard.ok) {
    return { error: `Too many sign-in attempts. Try again in ${formatWait(guard.retryAfterSeconds)}.` };
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  let ok = false;
  try {
    ok = await verify(user?.passwordHash ?? (await getDummyHash()), parsed.data.password);
  } catch {
    ok = false;
  }
  if (!user || !ok) return { error: "Wrong email or password." };

  const membership = await db.membership.findFirst({ where: { userId: user.id } });
  if (!membership) return { error: "This account has no restaurant yet." };

  // Correct credentials: this attempt and earlier failures from this network stop counting.
  await guard.release();

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(user.id, user.sessionVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookiesSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(user.mustChangePassword ? "/account" : "/dashboard");
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
