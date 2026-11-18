import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { cosRedeem, cosRelease, type CosReward, type FetchLike } from "../client";
import { loadTarget } from "./link";
import { enqueueRelease, forgetBalance, lookupBalance } from "./outbox";

/**
 * Using a Customer OS reward as a discount on a bill.
 *
 * Order of events at checkout: (1) the reward is used in Customer OS, (2) the bill is paid here with the discount, and (3) if the
 * bill could not be paid, the reward's points are given back. Each use has its own id (the order plus a fresh random part), so a
 * cashier who retries a failed bill uses the reward again for real instead of being handed an old, already-released use.
 * Releasing is also queued if it cannot be done on the spot, and never undoes a reward that ended up on a paid bill.
 */

export interface BillReward {
  /** Customer OS's id for the earned reward. */
  id: string;
  name: string;
  /** A discount takes `valueMinor` off the bill; a free item takes off the price of the one item the cashier picks. */
  type: "DISCOUNT" | "FREE_ITEM";
  /** Paisa off the bill (DISCOUNT only; null for a free item, whose value is the chosen item's price). */
  valueMinor: number | null;
  /** Points or stamps it uses up. */
  cost: number;
}

/** Rewards of this customer that can be used as a discount on a bill, for the order page. Never throws. */
export async function listBillRewards(ctx: TenantContext, customerId: string): Promise<{ state: "off" | "unavailable" | "ok"; rewards: BillReward[] }> {
  const v = await lookupBalance(ctx, customerId);
  if (v.state !== "ok") return { state: v.state, rewards: [] };
  if (!v.balance.found) return { state: "ok", rewards: [] };
  return { state: "ok", rewards: v.balance.rewards.filter(usable).map(toBillReward) };
}

const usable = (r: CosReward) => r.redeemable && (r.type === "FREE_ITEM" || (r.valueMinor ?? 0) > 0);
const toBillReward = (r: CosReward): BillReward => ({ id: r.customerRewardId, name: r.name, type: r.type, valueMinor: r.type === "DISCOUNT" ? (r.valueMinor ?? 0) : null, cost: r.requiredBalance });

export interface UsedReward {
  /** The id of this use, kept on the bill so it can never be released afterwards. */
  externalId: string;
  name: string;
  /** Paisa taken off the bill: the discount, or the price of the free item. */
  valueMinor: number;
  /** The free item's name (free-item rewards only). */
  itemName?: string;
  consumed: number;
}

/** Uses the reward in Customer OS for this bill. Throws a DomainError (nothing changed) if it cannot. */
export async function redeemRewardForBill(
  ctx: TenantContext,
  p: { orderId: string; customerId: string | null; confirmed: boolean; rewardId: string; freeItemId?: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<UsedReward> {
  if (!p.customerId) throw new DomainError("Add a customer to the order to use a reward.");
  if (!p.confirmed) throw new DomainError("Confirm in person that this is the customer before using their reward.");
  const loaded = await loadTarget(ctx.businessId);
  if (!loaded || !loaded.enabled) throw new DomainError("Customer OS is not connected, so rewards cannot be used.");
  const customer = await db.customer.findFirst({ where: { id: p.customerId, businessId: ctx.businessId }, select: { phone: true } });
  if (!customer) throw new DomainError("Customer not found.");

  const view = await lookupBalance(ctx, p.customerId, { fresh: true, fetchImpl: opts.fetchImpl });
  if (view.state !== "ok") throw new DomainError("Customer OS cannot be reached right now. Take payment without the reward, or try again in a moment.");
  const reward = view.balance.found ? view.balance.rewards.find((r) => r.customerRewardId === p.rewardId) : undefined;
  if (!reward) throw new DomainError("That reward is no longer available for this customer.");
  if (!usable(reward)) throw new DomainError("That reward cannot be used on a bill.");

  // What the reward is worth on THIS bill. A discount is worth what Customer OS says; a free item is worth the price of one unit of the
  // item the cashier picked, which must be a real, live item on this order (the price comes from here, never from the page).
  let valueMinor = reward.valueMinor ?? 0;
  let itemName: string | undefined;
  if (reward.type === "FREE_ITEM") {
    if (!p.freeItemId) throw new DomainError("Choose which item is free.");
    const item = await db.orderItem.findFirst({ where: { id: p.freeItemId, orderId: p.orderId, businessId: ctx.businessId }, select: { name: true, unitPrice: true, status: true, complimentary: true } });
    if (!item || item.status === "CANCELLED" || item.complimentary || item.unitPrice <= 0) throw new DomainError("That item cannot be made free.");
    valueMinor = item.unitPrice;
    itemName = item.name;
  }

  const externalId = `${p.orderId}:${randomUUID().slice(0, 8)}`;
  const res = await cosRedeem(loaded.target, { externalId, customerRewardId: p.rewardId, phone: customer.phone }, { fetchImpl: opts.fetchImpl });
  if (!res.ok) {
    // A timeout or dropped connection may have happened after Customer OS used the reward: make sure it is given back.
    if (res.retry) await enqueueRelease(ctx.businessId, p.orderId, externalId, 10 * 60_000);
    throw new DomainError(res.retry ? "Customer OS could not be reached to use the reward. Take payment without it, or try again." : res.message);
  }
  forgetBalance(ctx.businessId, customer.phone);
  if (res.data.type !== reward.type || (reward.type === "DISCOUNT" && res.data.valueMinor !== reward.valueMinor)) {
    await releaseReward(ctx.businessId, p.orderId, externalId, opts);
    throw new DomainError("The reward changed while it was being used. Please try again.");
  }
  return { externalId, name: res.data.rewardName, valueMinor, itemName, consumed: res.data.consumed };
}

/** The reward used on a paid bill (if any), and whether it has already been given back. For the refund form. */
export async function rewardUsedOnBill(businessId: string, orderId: string): Promise<{ externalId: string; returned: boolean } | null> {
  const used = await db.customerOsEvent.findFirst({ where: { businessId, kind: "REDEEM", invoiceId: orderId }, select: { refId: true } });
  if (!used) return null;
  const back = await db.customerOsEvent.findUnique({ where: { businessId_kind_refId: { businessId, kind: "RETURN", refId: used.refId } }, select: { id: true } });
  return { externalId: used.refId, returned: !!back };
}

/** The bill was not paid: give the points back now, or queue it if Customer OS cannot be reached. Never throws. */
export async function releaseReward(businessId: string, orderId: string, externalId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<void> {
  try {
    const loaded = await loadTarget(businessId);
    if (loaded) {
      const r = await cosRelease(loaded.target, { externalId }, { fetchImpl: opts.fetchImpl });
      if (r.ok || r.status === 404) return;
    }
  } catch {
    // fall through to the queue
  }
  await enqueueRelease(businessId, orderId, externalId).catch(() => undefined);
}
