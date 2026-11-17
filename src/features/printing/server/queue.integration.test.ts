import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { businessForAgentKey, createAgentKey, getPrintConfig, hasAgentKey, paperFor, savePrintConfig, type PrintConfigInput } from "./settings";
import { renderDocument } from "./render";
import { cancelJob, collectJobs, finishJob, listJobs, queueDocument, retryJob } from "./queue";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  waiter: TenantContext;
  kitchen: TenantContext;
  branchId: string;
  areaId: string;
  momo: string;
  tea: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter, kitchen] = await Promise.all(["owner", "mgr", "wait", "kit"].map(mk));
  const biz = await db.business.create({ data: { name, panNumber: "555", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  for (const [u, role] of [[mgr, "MANAGER"], [waiter, "WAITER"], [kitchen, "KITCHEN"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: branch.id, businessId: biz.id } } } });
  }
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Buff Momo", price: 25_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Masala Tea", price: 8_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" },
    manager: { ...base, userId: mgr.id, role: "MANAGER" },
    waiter: { ...base, userId: waiter.id, role: "WAITER" },
    kitchen: { ...base, userId: kitchen.id, role: "KITCHEN" },
    branchId: branch.id,
    areaId: area.id,
    momo: momo.id,
    tea: tea.id,
  };
}

const config = (o: Partial<PrintConfigInput> = {}): PrintConfigInput => ({
  paperWidthMm: 80, paperHeightMm: null, marginMm: 4, fontSizeTenthPt: 90, headerLine: "", footerLine: "Thank you!",
  showPan: true, showAddress: true, showCustomer: true, kitchenLargeText: true, autoKitchenPrint: false, receiptCopies: 1, ...o,
});

async function newOrder(w: World) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.branchId, areaId: w.areaId, label: `T${uid()}` } });
  return createOrder(w.waiter, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-printq-a");
  b = await makeWorld("itest-printq-b");
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

describe("print settings", () => {
  it("start with sensible defaults, are changed only by people who manage printing, and are validated", async () => {
    expect(await getPrintConfig(a.owner.businessId)).toMatchObject({ paperWidthMm: 80, paperHeightMm: null, marginMm: 4, autoKitchenPrint: false });
    await expect(savePrintConfig(a.waiter, config())).rejects.toThrow(/permission/);
    await expect(savePrintConfig(a.kitchen, config())).rejects.toThrow(/permission/);
    await expect(savePrintConfig(a.owner, config({ paperWidthMm: 20 }))).rejects.toThrow(/Paper width/);
    await expect(savePrintConfig(a.owner, config({ paperWidthMm: 900 }))).rejects.toThrow(/Paper width/);
    await expect(savePrintConfig(a.owner, config({ paperHeightMm: 10 }))).rejects.toThrow(/Paper height/);
    await expect(savePrintConfig(a.owner, config({ marginMm: 40 }))).rejects.toThrow(/Margin/);
    await expect(savePrintConfig(a.owner, config({ paperWidthMm: 40, marginMm: 18 }))).rejects.toThrow(/no room/);
    await expect(savePrintConfig(a.owner, config({ fontSizeTenthPt: 300 }))).rejects.toThrow(/Text size/);
    await expect(savePrintConfig(a.owner, config({ receiptCopies: 9 }))).rejects.toThrow(/copies/);
    await savePrintConfig(a.manager, config({ paperWidthMm: 58, paperHeightMm: 150, footerLine: "  See you   soon  ", headerLine: "Open 7 to 7" }));
    expect(await getPrintConfig(a.owner.businessId)).toMatchObject({ paperWidthMm: 58, paperHeightMm: 150, footerLine: "See you soon", headerLine: "Open 7 to 7" });
    expect((await getPrintConfig(b.owner.businessId)).paperWidthMm).toBe(80); // another business is untouched
  });

  it("let a single print use another paper size without changing the saved one", async () => {
    const cfg = await getPrintConfig(a.owner.businessId);
    expect(paperFor(cfg)).toMatchObject({ widthMm: 58, heightMm: 150 });
    expect(paperFor(cfg, { w: "100", h: "0" })).toMatchObject({ widthMm: 100, heightMm: null });
    expect(paperFor(cfg, { w: "10", h: "99999" })).toMatchObject({ widthMm: 40, heightMm: 2000 });
    expect(paperFor(cfg, { w: "junk" })).toMatchObject({ widthMm: 58 });
    expect((await getPrintConfig(a.owner.businessId)).paperWidthMm).toBe(58);
  });
});

describe("files for a receipt, a credit note and a kitchen slip", () => {
  it("makes a PDF on the chosen paper, printer bytes, and text, and enforces who may print", async () => {
    await savePrintConfig(a.owner, config());
    const order = await newOrder(a);
    await addItem(a.waiter, order.id, { menuItemId: a.momo, quantity: 2, note: "extra spicy" });
    await addItem(a.waiter, order.id, { menuItemId: a.tea, quantity: 1 });
    const t = await previewBill(a.owner, order.id, { kind: "none" });
    const inv = await checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });

    const pdf = await renderDocument(a.owner, "invoice", inv.id, "pdf", { w: "58", h: "0" });
    const text = Buffer.from(pdf.bytes).toString("latin1");
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.file).toBe(`receipt-${inv.number}.pdf`);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 164.41"); // 58 mm
    expect(text).toContain("Buff Momo");
    expect(text).toContain("PAN: 555");

    const wide = Buffer.from((await renderDocument(a.owner, "invoice", inv.id, "pdf", { w: "100" })).bytes).toString("latin1");
    expect(wide).toContain("/MediaBox [0 0 283.46"); // 100 mm

    const bin = await renderDocument(a.owner, "invoice", inv.id, "escpos");
    expect(Array.from(bin.bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Buffer.from(bin.bytes).toString("latin1")).toContain("Masala Tea");

    const txt = Buffer.from((await renderDocument(a.owner, "invoice", inv.id, "text")).bytes).toString("utf8");
    expect(txt).toMatch(/TOTAL\s+Rs/);

    const kitchen = Buffer.from((await renderDocument(a.waiter, "kitchen", order.id, "text")).bytes).toString("utf8");
    expect(kitchen).toContain("2 x Buff Momo");
    expect(kitchen).toContain("extra spicy");

    const note = await refundInvoice(a.owner, inv.id, "cold food", { amount: 5_000 });
    const cn = Buffer.from((await renderDocument(a.owner, "credit-note", note.id, "text")).bytes).toString("utf8");
    expect(cn).toContain(`CREDIT NOTE #${note.number}`);
    expect(cn).toContain("cold food");

    await expect(renderDocument(a.waiter, "invoice", inv.id, "pdf")).rejects.toThrow(/permission/);
    await expect(renderDocument(b.owner, "invoice", inv.id, "pdf")).rejects.toThrow(/not found/i);
    await expect(renderDocument(b.owner, "kitchen", order.id, "text")).rejects.toThrow(/not found/i);
  });
});

describe("the printer key", () => {
  it("is shown once, kept only as a fingerprint, replaced (not recovered) when remade, and belongs to one business", async () => {
    expect(await hasAgentKey(a.owner.businessId)).toBe(false);
    await expect(createAgentKey(a.waiter)).rejects.toThrow(/permission/);
    const k1 = await createAgentKey(a.owner);
    expect(k1.startsWith("pk_")).toBe(true);
    expect(await businessForAgentKey(k1)).toBe(a.owner.businessId);
    const row = await db.printSetting.findUniqueOrThrow({ where: { businessId: a.owner.businessId } });
    expect(JSON.stringify(row)).not.toContain(k1); // only a hash is stored
    const k2 = await createAgentKey(a.owner);
    expect(await businessForAgentKey(k1)).toBeNull(); // the old key stopped working
    expect(await businessForAgentKey(k2)).toBe(a.owner.businessId);
    expect(await businessForAgentKey(await createAgentKey(b.owner))).toBe(b.owner.businessId);
    for (const bad of [null, "", "abc", "pk_", "pk_" + "x".repeat(200), "Bearer " + k2]) expect(await businessForAgentKey(bad)).toBeNull();
  });
});

describe("the print queue", () => {
  it("queues a kitchen slip by itself when asked, one waiting slip per order, and a printer collects only what is new", async () => {
    await savePrintConfig(a.owner, config({ autoKitchenPrint: true }));
    const order = await newOrder(a);
    await addItem(a.waiter, order.id, { menuItemId: a.momo, quantity: 2 });
    await addItem(a.waiter, order.id, { menuItemId: a.tea, quantity: 1 });
    await new Promise((r) => setTimeout(r, 300));
    const queued = await db.printJob.findMany({ where: { orderId: order.id } });
    expect(queued).toHaveLength(1); // both additions share one waiting slip
    expect(queued[0]).toMatchObject({ kind: "KITCHEN", status: "QUEUED", attempts: 0 });

    const first = await collectJobs(a.owner.businessId);
    const job = first.find((j) => j.id === queued[0]!.id)!;
    expect(job).toMatchObject({ kind: "KITCHEN", paperWidthMm: 80, columns: 48 });
    expect(job.text.join("\n")).toContain("2 x Buff Momo");
    expect(job.text.join("\n")).toContain("1 x Masala Tea");
    expect(Buffer.from(job.escposBase64, "base64")[0]).toBe(0x1b);
    // collected jobs are not handed out again straight away
    expect((await collectJobs(a.owner.businessId)).find((j) => j.id === job.id)).toBeUndefined();

    // nothing is marked printed until the printer says so
    expect(await db.orderItem.count({ where: { orderId: order.id, printedAt: { not: null } } })).toBe(0);
    await finishJob(a.owner.businessId, job.id, true);
    expect(await db.orderItem.count({ where: { orderId: order.id, printedAt: { not: null } } })).toBe(2);
    expect((await db.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PRINTED");

    // a later addition makes a new slip with only the new item
    await addItem(a.waiter, order.id, { menuItemId: a.tea, quantity: 3, note: "no sugar" });
    await new Promise((r) => setTimeout(r, 300));
    const next = (await collectJobs(a.owner.businessId)).find((j) => j.id !== job.id && j.text.join("\n").includes("3 x Masala Tea"))!;
    expect(next).toBeTruthy();
    expect(next.text.join("\n")).not.toContain("Buff Momo");
    await finishJob(a.owner.businessId, next.id, true);
  });

  it("does not lose items when the printer fails, tries again, and gives up after five tries", async () => {
    const order = await newOrder(a);
    await addItem(a.waiter, order.id, { menuItemId: a.momo, quantity: 1 });
    await new Promise((r) => setTimeout(r, 300));
    const jobId = (await db.printJob.findFirstOrThrow({ where: { orderId: order.id } })).id;
    const first = (await collectJobs(a.owner.businessId)).find((j) => j.id === jobId)!;
    await finishJob(a.owner.businessId, first.id, false, "out of paper");
    expect(await db.orderItem.count({ where: { orderId: order.id, printedAt: { not: null } } })).toBe(0);
    expect(await db.printJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "QUEUED", error: "out of paper", attempts: 1 });
    // fail four more times: it stops being offered and shows as failed
    for (let i = 0; i < 4; i++) {
      const j = (await collectJobs(a.owner.businessId)).find((x) => x.id === jobId);
      expect(j).toBeTruthy();
      await finishJob(a.owner.businessId, jobId, false, "paper jam");
    }
    expect(await db.printJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "FAILED", attempts: 5 });
    expect((await collectJobs(a.owner.businessId)).find((x) => x.id === jobId)).toBeUndefined();
    await retryJob(a.manager, jobId);
    expect((await collectJobs(a.owner.businessId)).find((x) => x.id === jobId)).toBeTruthy();
    await finishJob(a.owner.businessId, jobId, true);
  });

  it("queues receipts by hand, lets managers cancel, and keeps businesses apart", async () => {
    const order = await newOrder(a);
    await addItem(a.owner, order.id, { menuItemId: a.tea, quantity: 1 });
    const t = await previewBill(a.owner, order.id, { kind: "none" });
    const inv = await checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    const id = await queueDocument(a.waiter, "invoice", inv.id);
    await expect(queueDocument(b.owner, "invoice", inv.id)).rejects.toThrow(/not found/);
    await expect(queueDocument(a.waiter, "kitchen", "nope")).rejects.toThrow(/not found/);
    await expect(listJobs(a.waiter)).rejects.toThrow(/permission/);
    expect((await listJobs(a.manager)).some((j) => j.id === id)).toBe(true);
    await expect(finishJob(b.owner.businessId, id, true)).rejects.toThrow(/not found/i); // another business's key cannot touch it
    await expect(cancelJob(a.waiter, id)).rejects.toThrow(/permission/);
    await cancelJob(a.manager, id);
    expect((await db.printJob.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    await expect(cancelJob(a.manager, id)).rejects.toThrow(/cannot be cancelled/);
    expect((await collectJobs(a.owner.businessId)).find((j) => j.id === id)).toBeUndefined();
  });

  it("closes a kitchen slip that has nothing new on it instead of printing a blank one", async () => {
    const order = await newOrder(a);
    await addItem(a.waiter, order.id, { menuItemId: a.tea, quantity: 1 });
    await new Promise((r) => setTimeout(r, 300));
    await db.orderItem.updateMany({ where: { orderId: order.id }, data: { printedAt: new Date() } }); // already printed some other way
    const job = await db.printJob.findFirstOrThrow({ where: { orderId: order.id, status: "QUEUED" } });
    expect((await collectJobs(a.owner.businessId)).find((j) => j.id === job.id)).toBeUndefined();
    expect(await db.printJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED", error: "Nothing new to print." });
  });
});
