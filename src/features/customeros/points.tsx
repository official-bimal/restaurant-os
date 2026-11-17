import type { TenantContext } from "@/server/auth";
import { lookupBalance } from "./server/outbox";

/**
 * A customer's loyalty points as Customer OS holds them. Renders nothing when Customer OS is not connected, and a quiet
 * "unavailable" line when it cannot be reached (the page still works). Never shows an error to the cashier.
 */
export async function CustomerOsPoints({ ctx, customerId, className = "" }: { ctx: TenantContext; customerId: string; className?: string }) {
  const v = await lookupBalance(ctx, customerId);
  if (v.state === "off") return null;
  if (v.state === "unavailable") {
    return <p className={`text-stone-500 ${className}`}>Customer OS points: unavailable right now</p>;
  }
  const b = v.balance;
  if (!b.found) return <p className={`text-stone-600 ${className}`}>Customer OS points: 0 (no purchases recorded yet)</p>;
  // A reward stays on the list after the points behind it were taken back (a refund) but cannot be used until they are earned again.
  const ready = b.rewards.filter((r) => r.redeemable).length;
  const unit = b.program?.type === "STAMPS" ? "stamp" : "point";
  return (
    <p className={`text-stone-700 ${className}`}>
      <span className="font-medium">
        {b.balance} {unit}
        {b.balance === 1 ? "" : "s"}
      </span>{" "}
      in Customer OS
      {b.rewardCost ? ` · reward at ${b.rewardCost}` : ""}
      {ready > 0 ? ` · ${ready} reward${ready === 1 ? "" : "s"} ready` : ""}
    </p>
  );
}
