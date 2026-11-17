import type { Tx } from "@/server/audit";

/**
 * When the last delivery of a run is delivered or fails, the run is done. Called from every place a delivery can end
 * (the rider's page and link, and staff), inside the same transaction as that change.
 */
export async function settleBatchIfDone(tx: Tx, businessId: string, batchId: string | null | undefined) {
  if (!batchId) return;
  const pending = await tx.order.count({
    where: { businessId, batchId, deliveryStatus: { in: ["PREPARING", "OUT_FOR_DELIVERY"] }, status: { notIn: ["CANCELLED", "MERGED"] } },
  });
  if (pending === 0) {
    await tx.deliveryBatch.updateMany({ where: { id: batchId, businessId, status: { not: "DONE" } }, data: { status: "DONE", doneAt: new Date() } });
  }
}
