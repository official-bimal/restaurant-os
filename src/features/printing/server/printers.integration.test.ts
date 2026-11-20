import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { addPrinter, deletePrinter, getRoutes, listPrinters, queueTest, saveRoutes, updatePrinter } from "./printers";
import { cancelJob, collectJobs, finishJob, listJobs, queueDocument, queueKitchenSlip } from "./queue";
import { getPrintConfig, saveSlipFields } from "./settings";
import { renderDocument } from "./render";
import { DEFAULT_FIELDS } from "../slip-fields";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function world(name: string) {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, waiter, cashier] = await Promise.all(["owner", "wait", "cash"].map(mk));
  const biz = await db.business.create({ data: { name, panNumber: "555", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  await db.membership.create({ data: { userId: waiter.id, businessId: biz.id, role: "WAITER" } });
  await db.membership.create({ data: { userId: cashier.id, businessId: biz.id, role: "CASHIER" } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const other = await db.branch.create({ data: { businessId: biz.id, name: "Second" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const bar = await db.station.create({ data: { businessId: biz.id, name: "Bar" } });
  const grill = await db.station.create({ data: { businessId: biz.id, name: "Grill" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Masala Tea", price: 8_000, stationId: bar.id } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Buff Momo", price: 25_000, stationId: grill.id } });
  const salad = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Salad", price: 15_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id, other.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" } as TenantContext,
    waiter: { ...base, userId: waiter.id, role: "WAITER" } as TenantContext,
    cashier: { ...base, userId: cashier.id, role: "CASHIER" } as TenantContext,
    branchId: branch.id,
    otherBranchId: other.id,
    areaId: area.id,
    bar: bar.id,
    grill: grill.id,
    tea: tea.id,
    momo: momo.id,
    salad: salad.id,
  };
}

type W = Awaited<ReturnType<typeof world>>;
let a: W;
let b: W;

const order = async (w: W) => {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.branchId, areaId: w.areaId, label: `T${uid()}` } });
  return createOrder(w.waiter, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
};

beforeAll(async () => {
  a = await world("itest-prt-a");
  b = await world("itest-prt-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.printJob.deleteMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

let kitchen = "";
let barPrinter = "";
let counter = "";

describe("printers", () => {
  it("are added, listed, renamed and kept apart between businesses, for people who manage printing only", async () => {
    await expect(addPrinter(a.waiter, { name: "Kitchen" })).rejects.toThrow(/permission/);
    await expect(listPrinters(a.cashier)).rejects.toThrow(/permission/);
    kitchen = await addPrinter(a.owner, { name: "  Kitchen  ", paperWidthMm: "58" });
    barPrinter = await addPrinter(a.owner, { name: "Bar" });
    counter = await addPrinter(a.owner, { name: "Counter", paperWidthMm: "" });
    await expect(addPrinter(a.owner, { name: "kitchen" })).rejects.toThrow(/already/);
    await expect(addPrinter(a.owner, { name: "X", paperWidthMm: "10" })).rejects.toThrow(/40 to 300/);
    expect((await listPrinters(a.owner)).map((p) => [p.name, p.paperWidthMm])).toEqual([["Bar", null], ["Counter", null], ["Kitchen", 58]]);
    expect(await listPrinters(b.owner)).toEqual([]);
    await updatePrinter(a.owner, barPrinter, { name: "Bar printer", paperWidthMm: "80" });
    await expect(updatePrinter(a.owner, barPrinter, { name: "Counter" })).rejects.toThrow(/already/);
    await expect(updatePrinter(b.owner, barPrinter, { name: "Hacked" })).rejects.toThrow(/not found/);
    await expect(deletePrinter(b.owner, barPrinter)).rejects.toThrow(/not found/);
    expect((await listPrinters(a.owner)).find((p) => p.id === barPrinter)).toMatchObject({ name: "Bar printer", paperWidthMm: 80 });
  });

  it("are listed per branch", async () => {
    await db.printer.create({ data: { businessId: a.owner.businessId, branchId: a.otherBranchId, name: "Second branch printer" } });
    expect((await listPrinters(a.owner)).map((p) => p.name)).not.toContain("Second branch printer");
    expect((await listPrinters({ ...a.owner, branchId: a.otherBranchId })).map((p) => p.name)).toEqual(["Second branch printer"]);
  });
});

describe("routing", () => {
  it("checks printers and stations and keeps the routes it is given", async () => {
    const otherPrinter = (await db.printer.findFirstOrThrow({ where: { branchId: a.otherBranchId } })).id;
    await expect(saveRoutes(a.waiter, [])).rejects.toThrow(/permission/);
    await expect(saveRoutes(a.owner, [{ kind: "KITCHEN", stationKey: "", printerId: otherPrinter }])).rejects.toThrow(/this branch/);
    await expect(saveRoutes(a.owner, [{ kind: "KITCHEN", stationKey: a.bar, printerId: "nope" }])).rejects.toThrow(/this branch/);
    const bStation = (await db.station.findFirstOrThrow({ where: { businessId: b.owner.businessId } })).id;
    await expect(saveRoutes(a.owner, [{ kind: "KITCHEN", stationKey: bStation, printerId: kitchen }])).rejects.toThrow(/station/);
    await saveRoutes(a.owner, [
      { kind: "KITCHEN", stationKey: "", printerId: kitchen },
      { kind: "KITCHEN", stationKey: a.bar, printerId: barPrinter },
      { kind: "RECEIPT", stationKey: "", printerId: counter },
      { kind: "CREDIT_NOTE", stationKey: "", printerId: "" },
    ]);
    const r = await getRoutes(a.owner);
    expect(r.routes.map((x) => `${x.kind}:${x.stationKey || "-"}`).sort()).toEqual([`KITCHEN:${a.bar}`, "KITCHEN:-", "RECEIPT:-"].sort());
    expect(r.stations.map((s) => s.name)).toEqual(["Bar", "Grill"]);
    expect((await getRoutes(b.owner)).routes).toEqual([]);
  });

  it("sends each station's dishes to its own printer, with only those dishes", async () => {
    const o = await order(a);
    await addItem(a.waiter, o.id, { menuItemId: a.tea, quantity: 2, note: "no sugar" });
    await addItem(a.waiter, o.id, { menuItemId: a.momo, quantity: 1 });
    await addItem(a.waiter, o.id, { menuItemId: a.salad, quantity: 1 });
    await queueKitchenSlip(a.owner.businessId, a.branchId, o.id, a.waiter.userId);
    const jobs = (await db.printJob.findMany({ where: { orderId: o.id } })).sort((x, y) => (x.printerId ?? "").localeCompare(y.printerId ?? ""));
    expect(jobs.map((j) => j.printerId).sort()).toEqual([barPrinter, kitchen].sort());
    // Asking again does not stack a second slip for either printer.
    await queueKitchenSlip(a.owner.businessId, a.branchId, o.id, a.waiter.userId);
    expect(await db.printJob.count({ where: { orderId: o.id } })).toBe(2);

    const bar = await collectJobs(a.owner.businessId, { branchId: a.branchId, printerId: barPrinter });
    expect(bar).toHaveLength(1);
    expect(bar[0]!.text.join("\n")).toContain("2 x Masala Tea");
    expect(bar[0]!.text.join("\n")).toContain("no sugar");
    expect(bar[0]!.text.join("\n")).not.toContain("Buff Momo");
    expect(bar[0]!.text.join("\n")).not.toContain("Salad");
    expect(bar[0]!.columns).toBeGreaterThan(40); // the bar printer has 80 mm paper

    const kit = await collectJobs(a.owner.businessId, { branchId: a.branchId, printerId: kitchen });
    expect(kit).toHaveLength(1);
    const kt = kit[0]!.text.join("\n");
    expect(kt).toContain("1 x Buff Momo");
    expect(kt).toContain("1 x Salad"); // no station: the kitchen default
    expect(kt).not.toContain("Masala Tea");
    expect(kit[0]!.columns).toBeLessThan(bar[0]!.columns); // the kitchen printer has 58 mm paper

    // Nothing is left for a program that names no printer, or for another business's printer.
    expect(await collectJobs(a.owner.businessId, { branchId: a.branchId })).toEqual([]);
    expect(await collectJobs(b.owner.businessId, { printerId: kitchen })).toEqual([]);

    // Each printer's slip marks only its own items as printed.
    await finishJob(a.owner.businessId, bar[0]!.id, true);
    const items = await db.orderItem.findMany({ where: { orderId: o.id }, include: { menuItem: true } });
    expect(items.filter((i) => i.printedAt).map((i) => i.name)).toEqual(["Masala Tea"]);
    await finishJob(a.owner.businessId, kit[0]!.id, true);
    expect((await db.orderItem.findMany({ where: { orderId: o.id } })).every((i) => i.printedAt)).toBe(true);
  });

  it("adds a later item for the same printer to the slip that is waiting", async () => {
    const o = await order(a);
    await addItem(a.waiter, o.id, { menuItemId: a.momo, quantity: 1 });
    await queueKitchenSlip(a.owner.businessId, a.branchId, o.id, null);
    const first = await db.printJob.findFirstOrThrow({ where: { orderId: o.id } });
    expect(first.stationKeys).toEqual([a.grill]);
    await addItem(a.waiter, o.id, { menuItemId: a.salad, quantity: 1 });
    await queueKitchenSlip(a.owner.businessId, a.branchId, o.id, null);
    expect(await db.printJob.count({ where: { orderId: o.id } })).toBe(1);
    expect((await db.printJob.findFirstOrThrow({ where: { orderId: o.id } })).stationKeys.sort()).toEqual(["", a.grill].sort());
    const [job] = await collectJobs(a.owner.businessId, { branchId: a.branchId, printerId: kitchen });
    expect(job!.text.join("\n")).toContain("Salad");
    await finishJob(a.owner.businessId, job!.id, true);
  });

  it("sends bills and credit notes to their printers, and a bill with no route to any printer program", async () => {
    const o = await order(a);
    await addItem(a.waiter, o.id, { menuItemId: a.momo, quantity: 1 });
    const t = await previewBill(a.owner, o.id, { kind: "none" });
    const inv = await checkout(a.owner, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    const jobId = await queueDocument(a.owner, "invoice", inv.id);
    expect((await db.printJob.findUniqueOrThrow({ where: { id: jobId } })).printerId).toBe(counter);
    const got = await collectJobs(a.owner.businessId, { branchId: a.branchId, printerId: counter });
    expect(got.map((j) => j.kind)).toEqual(["RECEIPT"]);
    await finishJob(a.owner.businessId, got[0]!.id, true);
    // Credit notes have no route, so they wait for a program that names no printer, as before.
    await saveRoutes(a.owner, [{ kind: "RECEIPT", stationKey: "", printerId: counter }]);
    const unrouted = await queueKitchenSlip(a.owner.businessId, a.branchId, (await order(a)).id, null);
    expect((await db.printJob.findUniqueOrThrow({ where: { id: unrouted } })).printerId).toBeNull();
  });

  it("with no kitchen routes, behaves as before: one slip for a program that names no printer", async () => {
    await saveRoutes(a.owner, []);
    const o = await order(a);
    await addItem(a.waiter, o.id, { menuItemId: a.tea, quantity: 1 });
    await addItem(a.waiter, o.id, { menuItemId: a.momo, quantity: 1 });
    await queueKitchenSlip(a.owner.businessId, a.branchId, o.id, null);
    const [job] = await collectJobs(a.owner.businessId, { branchId: a.branchId });
    const text = job!.text.join("\n");
    expect(text).toContain("Masala Tea");
    expect(text).toContain("Buff Momo");
    await finishJob(a.owner.businessId, job!.id, true);
  });
});

describe("test pages and removing a printer", () => {
  it("queue one test page per printer and print it for that printer's paper", async () => {
    await expect(queueTest(a.waiter)).rejects.toThrow(/permission/);
    await expect(queueTest(a.owner, "nope")).rejects.toThrow(/not found/);
    expect(await queueTest(a.owner)).toBe(3);
    expect(await queueTest(a.owner)).toBe(0); // already waiting
    const jobs = await collectJobs(a.owner.businessId, { branchId: a.branchId, printerId: kitchen });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("TEST");
    const text = jobs[0]!.text.join("\n");
    expect(text).toContain("TEST PAGE");
    expect(text).toContain("Kitchen");
    expect(text).toContain("Paper 58 mm");
    await finishJob(a.owner.businessId, jobs[0]!.id, true);
    expect((await db.printJob.findUniqueOrThrow({ where: { id: jobs[0]!.id } })).status).toBe("PRINTED");
  });

  it("cancels what was waiting for a removed printer and drops its routes", async () => {
    await saveRoutes(a.owner, [{ kind: "KITCHEN", stationKey: "", printerId: kitchen }]);
    const o = await order(a);
    await addItem(a.waiter, o.id, { menuItemId: a.salad, quantity: 1 });
    await queueKitchenSlip(a.owner.businessId, a.branchId, o.id, null);
    await deletePrinter(a.owner, kitchen);
    expect((await db.printJob.findFirstOrThrow({ where: { orderId: o.id } })).status).toBe("CANCELLED");
    expect((await getRoutes(a.owner)).routes).toEqual([]);
    expect((await listPrinters(a.owner)).map((p) => p.name)).not.toContain("Kitchen");
    // Nothing is left that a program with no printer name could pick up by mistake.
    expect(await collectJobs(a.owner.businessId, { branchId: a.branchId })).toEqual([]);
    expect((await listJobs(a.owner)).length).toBeGreaterThan(0);
    await expect(cancelJob(a.owner, "nope")).rejects.toThrow();
  });
});

describe("what prints", () => {
  it("is saved by people who manage printing and changes the next slip", async () => {
    expect((await getPrintConfig(a.owner.businessId)).fields).toEqual(DEFAULT_FIELDS);
    await expect(saveSlipFields(a.waiter, DEFAULT_FIELDS)).rejects.toThrow(/permission/);
    await saveSlipFields(a.owner, { kot: { ...DEFAULT_FIELDS.kot, waiter: true, itemNote: false, station: false }, bill: { ...DEFAULT_FIELDS.bill, payments: false } });
    const o = await order(a);
    await addItem(a.waiter, o.id, { menuItemId: a.tea, quantity: 1, note: "no sugar" });
    const slip = Buffer.from((await renderDocument(a.owner, "kitchen", o.id, "text")).bytes).toString("utf8");
    expect(slip).toContain("Taken by itest-prt-a wait");
    expect(slip).not.toContain("no sugar");
    expect(slip).not.toContain("BAR");
    expect(slip).toContain("1 x Masala Tea");
    const t = await previewBill(a.owner, o.id, { kind: "none" });
    const inv = await checkout(a.owner, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    const bill = Buffer.from((await renderDocument(a.owner, "invoice", inv.id, "text")).bytes).toString("utf8");
    expect(bill).not.toContain("Paid by");
    expect(bill).toMatch(/TOTAL\s+Rs/);
    expect((await getPrintConfig(b.owner.businessId)).fields).toEqual(DEFAULT_FIELDS); // another business is untouched
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: "print.fields" } })).toBe(1);
  });
});
