"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import {
  attachCustomerToOrder,
  confirmOrderCustomer,
  detachCustomerFromOrder,
} from "@/features/loyalty/server/customers";

async function done(orderId: string): Promise<never> {
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

export async function attachCustomerAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant("customer.use");
  const input = z
    .object({ phone: z.string().max(40), name: z.string().max(200).optional(), consent: z.string().optional() })
    .parse({
      phone: formData.get("phone") ?? "",
      name: (formData.get("name") as string) || undefined,
      consent: (formData.get("consent") as string) || undefined,
    });
  await guarded(`/orders/${orderId}`, () =>
    attachCustomerToOrder(ctx, orderId, { phone: input.phone, name: input.name, marketingConsent: input.consent === "on" }),
  );
  await done(orderId);
}

export async function confirmCustomerAction(orderId: string) {
  const ctx = await requireTenant("customer.use");
  await guarded(`/orders/${orderId}`, () => confirmOrderCustomer(ctx, orderId));
  await done(orderId);
}

export async function detachCustomerAction(orderId: string) {
  const ctx = await requireTenant("customer.use");
  await guarded(`/orders/${orderId}`, () => detachCustomerFromOrder(ctx, orderId));
  await done(orderId);
}
