import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatNpr } from "@/features/billing/calc";
import { getResult } from "@/features/payments/server/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payment", referrer: "no-referrer", robots: { index: false, follow: false } };

/** Where the customer lands after eSewa or Khalti. It only reports what the service itself confirmed. */
export default async function PayResultPage({ params }: PageProps<"/pay/[token]/result">) {
  const { token } = await params;
  const r = await getResult(token);
  if (!r) notFound();
  const paid = r.status === "PAID";
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-md space-y-3 p-6 text-center">
        <p className="text-sm text-stone-500">{r.business}</p>
        <h1 className="text-3xl font-semibold">{formatNpr(r.amount)}</h1>
        {paid ? (
          <p className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Payment received through {r.provider}. Thank you! You can close this page.</p>
        ) : r.status === "FAILED" || r.status === "CANCELLED" || r.status === "EXPIRED" ? (
          <p className="rounded-xl bg-red-50 p-4 text-red-800">The payment was not completed, and nothing was taken. Please tell the cashier.</p>
        ) : (
          <p className="rounded-xl bg-amber-50 p-4 text-amber-900">We are waiting for {r.provider} to confirm your payment. Please tell the cashier if this does not change in a minute.</p>
        )}
      </div>
    </main>
  );
}
