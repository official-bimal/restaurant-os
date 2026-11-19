"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { createBill, recordBillPayment, voidBill } from "@/features/purchasing/server/bills";

const BACK = "/stock/bills";
const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
const done = () => {
  revalidatePath("/stock", "layout");
  redirect(BACK);
};

export async function createBillAction(formData: FormData) {
  const ctx = await requireTenant("supplier.pay");
  await guarded(BACK, () =>
    createBill(ctx, {
      supplierId: String(formData.get("supplierId") ?? ""),
      number: String(formData.get("number") ?? ""),
      billDate: String(formData.get("billDate") ?? ""),
      dueDate: String(formData.get("dueDate") ?? ""),
      amount: rupeesToPaisa(formData.get("amount")),
      vatAmount: rupeesToPaisa(formData.get("vatAmount")),
      note: String(formData.get("note") ?? ""),
    }),
  );
  done();
}

export async function payBillAction(billId: string, formData: FormData) {
  const ctx = await requireTenant("supplier.pay");
  await guarded(BACK, () =>
    recordBillPayment(ctx, billId, {
      amount: rupeesToPaisa(formData.get("amount")),
      method: String(formData.get("method") ?? ""),
      paidOn: String(formData.get("paidOn") ?? ""),
      reference: String(formData.get("reference") ?? ""),
      note: String(formData.get("note") ?? ""),
    }),
  );
  done();
}

export async function voidBillAction(billId: string, formData: FormData) {
  const ctx = await requireTenant("supplier.pay");
  await guarded(BACK, () => voidBill(ctx, billId, String(formData.get("reason") ?? "")));
  done();
}
