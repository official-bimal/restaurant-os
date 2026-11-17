import { z } from "zod";

/**
 * Orders taken while the Wi-Fi is down. The phone keeps them in its own storage and sends them when it is back online.
 * Only plain orders are supported offline (dine-in and takeaway, with items and notes). Payments, bills, discounts,
 * delivery and add-ons need the server and stay online-only.
 */

export const offlineOrderSchema = z.object({
  /** Made on the phone when the order is taken; the server uses it so a repeat send never creates a second order. */
  key: z.string().min(8).max(100),
  branchId: z.string().min(1).max(60),
  type: z.enum(["DINE_IN", "TAKEAWAY"]),
  tableId: z.string().max(60).nullish(),
  takenAt: z.string().max(40).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1).max(60),
        quantity: z.number().int().min(1).max(99),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(60),
});

export type OfflineOrder = z.infer<typeof offlineOrderSchema>;

export type SyncOutcome =
  | { ok: true; orderId: string; number: number; repeat: boolean }
  /** Not applied. `retry` means the phone should try again later; otherwise someone has to look at it. */
  | { ok: false; error: string; retry: boolean };
