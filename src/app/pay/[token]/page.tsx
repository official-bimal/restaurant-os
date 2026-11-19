import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { formatNpr } from "@/features/billing/calc";
import { baseUrlFrom } from "@/features/payments/server/base-url";
import { getPayPage } from "@/features/payments/server/service";
import { EsewaForm } from "./auto-submit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pay your bill", referrer: "no-referrer", robots: { index: false, follow: false } };

/** The customer's page: opened from the cashier's QR code. It sends them to eSewa or Khalti. The long token in the link is the only key. */
export default async function PayPage({ params }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  const page = await getPayPage(token, baseUrlFrom(await headers()));
  if (!page) notFound();
  if (page.kind === "khalti") redirect(page.url);
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-md space-y-3 p-6 text-center">
        <p className="text-sm text-stone-500">{page.business}</p>
        <h1 className="text-3xl font-semibold">{formatNpr(page.amount)}</h1>
        {page.kind === "esewa" && (
          <>
            <p className="text-stone-600">Taking you to eSewa to pay your bill…</p>
            <EsewaForm action={page.form.action} fields={page.form.fields} />
          </>
        )}
        {page.kind === "done" && <p className="rounded-xl bg-emerald-50 p-4 text-emerald-800">This bill has been paid. Thank you!</p>}
        {page.kind === "expired" && <p className="rounded-xl bg-amber-50 p-4 text-amber-900">This payment link has expired. Please ask the cashier for a new one.</p>}
        {page.kind === "closed" && <p className="rounded-xl bg-stone-100 p-4 text-stone-700">This payment link is no longer in use. Please ask the cashier.</p>}
      </div>
    </main>
  );
}
