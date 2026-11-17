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
  /** Paisa off the bill. */
  valueMinor: number;
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

const usable = (r: CosReward) => r.type === "DISCOUNT" && (r.valueMinor ?? 0) > 0 && r.redeemable;
const toBillReward = (r: CosReward): BillReward => ({ id: r.customerRewardId, name: r.name, valueMinor: r.valueMinor ?? 0, cost: r.requiredBalance });

export interface UsedReward {
  /** The id of this use, kept on the bill so it can never be released afterwards. */
  externalId: string;
  name: string;
  valueMinor: number;
  consumed: number;
}

/** Uses the reward in Customer OS for this bill. Throws a DomainError (nothing changed) if it cannot. */
export async function redeemRewardForBill(
  ctx: TenantContext,
  p: { orderId: string; customerId: string | null; confirmed: boolean; rewardId: string },
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
  if (!usable(reward)) throw new DomainError("That reward cannot be used as a discount.");

  const externalId = `${p.orderId}:${randomUUID().slice(0, 8)}`;
  const res = await cosRedeem(loaded.target, { externalId, customerRewardId: p.rewardId, phone: customer.phone }, { fetchImpl: opts.fetchImpl });
  if (!res.ok) {
    // A timeout or dropped connection may have happened after Customer OS used the reward: make sure it is given back.
    if (res.retry) await enqueueRelease(ctx.businessId, p.orderId, externalId, 10 * 60_000);
    throw new DomainError(res.retry ? "Customer OS could not be reached to use the reward. Take payment without it, or try again." : res.message);
  }
  forgetBalance(ctx.businessId, customer.phone);
  if (res.data.valueMinor !== reward.valueMinor || res.data.type !== "DISCOUNT") {
    await releaseReward(ctx.businessId, p.orderId, externalId, opts);
    throw new DomainError("The reward changed while it was being used. Please try again.");
  }
  return { externalId, name: res.data.rewardName, valueMinor: res.data.valueMinor ?? 0, consumed: res.data.consumed };
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
