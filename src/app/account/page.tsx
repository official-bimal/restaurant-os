import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { logout } from "@/app/login/actions";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const ctx = await requireTenant(undefined, { allowMustChange: true });
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm border border-stone-200 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">My account</h1>
          {ctx.mustChangePassword ? (
            <p className="mt-1 text-sm text-amber-800">
              You are using a temporary password. Choose your own to continue.
            </p>
          ) : (
            <p className="mt-1 text-sm text-stone-500">Change your password. Other devices will be signed out.</p>
          )}
        </div>
        <PasswordForm />
        <div className="flex items-center justify-between text-sm">
          {!ctx.mustChangePassword ? (
            <Link href="/orders" className="text-stone-600 underline">
              Back to orders
            </Link>
          ) : (
            <span />
          )}
          <form action={logout}>
            <button className="text-stone-600 underline">Sign out</button>
          </form>
        </div>
      </div>
    </main>
  );
}
