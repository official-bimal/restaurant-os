import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRINT, dismissBill, getDeviceId, loadBills, loadBlocks, loadUsed, makeBill, numbersAvailable, prepareOffline, receiptPdf, retryBill, syncBills, type MakeBillInput, type StoredSnapshot } from "./client";
import { OfflineBillError, priceOfflineBill, type OfflineSnapshot } from "./billing";

class MemoryStorage {
  private m = new Map<string, string>();
  full = false;
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error("quota");
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const snapshot: OfflineSnapshot = {
  v: 1,
  issuedAt: "2026-11-20T06:00:00.000Z",
  businessId: "biz",
  branchId: "br",
  userId: "u",
  business: { name: "Lakeside Cafe", pan: "123", timezone: "Asia/Kathmandu", serviceChargeBps: 1000, vatMode: "EXCLUSIVE", vatBps: 1300, vatAppliesToServiceCharge: true, roundToRupee: true },
  branch: { name: "Main", address: "Lakeside" },
  items: [{ id: "momo", name: "Buff Momo", price: 25_000, category: "Food" }, { id: "tea", name: "Tea", price: 8_000, category: "Drinks" }],
  tables: [{ id: "t1", label: "Main · T1" }],
};
const stored = (o: Partial<StoredSnapshot> = {}): StoredSnapshot => ({ snapshot: JSON.stringify(snapshot), sig: "sig", fetchedAt: "2026-11-20T06:00:00.000Z", canBill: true, print: DEFAULT_PRINT, ...o });
const NOW = new Date("2026-11-21T06:00:00.000Z");
const items = [{ menuItemId: "momo", quantity: 2 }, { menuItemId: "tea", quantity: 1 }];
const total = priceOfflineBill(snapshot, items, { kind: "none" }).totals.grandTotal;
const input = (o: Partial<MakeBillInput> = {}): MakeBillInput => ({ type: "TAKEAWAY", tableId: null, items, discount: { kind: "none" }, payments: [{ method: "CASH", amount: total }], ...o });
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

let ls: MemoryStorage;
beforeEach(() => {
  ls = new MemoryStorage();
  vi.stubGlobal("localStorage", ls);
  ls.setItem("ros-pos-blocks", JSON.stringify([{ id: "b1", from: 101, to: 103 }]));
  ls.setItem("ros-pos-snapshot", JSON.stringify(stored()));
});

describe("making a bill on the phone", () => {
  it("prices it from the snapshot, takes the lowest reserved number and saves it", () => {
    const saved = makeBill(stored(), input(), NOW);
    expect(saved.invoiceNumber).toBe(101);
    expect(saved.bill).toMatchObject({ invoiceNumber: 101, expectedTotal: total, type: "TAKEAWAY", tableId: null, billedAt: NOW.toISOString() });
    expect(saved.receipt).toMatchObject({ invoiceNumber: 101, orderNumber: null, grandTotal: total, business: "Lakeside Cafe", where: "Takeaway" });
    expect(saved.receipt.lines.map((l) => [l.name, l.total])).toEqual([["Buff Momo", 50_000], ["Tea", 8_000]]);
    expect(loadBills()).toHaveLength(1);
    expect(loadBills()[0]).toMatchObject({ state: "queued" });
    expect([...loadUsed()]).toEqual([101]);
  });

  it("never uses a number twice, and says so when the phone has run out", () => {
    const numbers = [1, 2, 3].map(() => makeBill(stored(), input(), NOW).invoiceNumber);
    expect(numbers).toEqual([101, 102, 103]);
    expect(numbersAvailable()).toBe(0);
    expect(() => makeBill(stored(), input(), NOW)).toThrow(/no invoice numbers left/);
    expect(loadBills()).toHaveLength(3); // the refused bill left nothing behind
    // dismissing a bill does not free its number
    retryBill("x");
    expect([...loadUsed()].sort()).toEqual([101, 102, 103]);
  });

  it("refuses what the server would refuse, and leaves no trace", () => {
    expect(() => makeBill(stored({ canBill: false }), input(), NOW)).toThrow(/not allowed to take payments/);
    expect(() => makeBill(stored(), input({ payments: [{ method: "CASH", amount: total - 1 }] }), NOW)).toThrow(/exactly/);
    expect(() => makeBill(stored(), input({ items: [{ menuItemId: "ghost", quantity: 1 }] }), NOW)).toThrow(/not on the menu/);
    expect(() => makeBill(stored(), input({ discount: { kind: "percent", bps: 20_000 } }), NOW)).toThrow(/0 to 100/);
    expect(() => makeBill(stored(), input({ type: "DINE_IN", tableId: null }), NOW)).toThrow(/Choose a table/);
    expect(() => makeBill(stored(), input({ type: "DINE_IN", tableId: "nope" }), NOW)).toThrow(/Choose a table/);
    expect(() => makeBill(stored(), input(), new Date("2026-12-30T00:00:00Z"))).toThrow(/more than 30 days/);
    expect(loadBills()).toEqual([]);
    expect(loadUsed().size).toBe(0);
  });

  it("works out a dine-in bill with a discount and split payment", () => {
    const priced = priceOfflineBill(snapshot, items, { kind: "percent", bps: 1000 });
    const t = priced.totals.grandTotal;
    const saved = makeBill(stored(), input({ type: "DINE_IN", tableId: "t1", discount: { kind: "percent", bps: 1000 }, payments: [{ method: "CASH", amount: t - 5_000 }, { method: "QR", amount: 5_000 }], customerPhone: " 9841000111 " }), NOW);
    expect(saved.bill).toMatchObject({ type: "DINE_IN", tableId: "t1", customerPhone: "9841000111", expectedTotal: t });
    expect(saved.receipt.discount).toBeGreaterThan(0);
    expect(saved.receipt.payments).toEqual([{ method: "CASH", amount: t - 5_000 }, { method: "QR", amount: 5_000 }]);
    expect(saved.tableLabel).toBe("Main · T1");
  });

  it("refuses, rather than print a bill that could be lost, when the phone's storage is full", () => {
    ls.full = true;
    expect(() => makeBill(stored(), input(), NOW)).toThrow(OfflineBillError);
    expect(() => makeBill(stored(), input(), NOW)).toThrow(/storage is full/);
  });
});

describe("sending saved bills", () => {
  it("records what the server answered, one bill at a time", async () => {
    makeBill(stored(), input(), NOW);
    makeBill(stored(), input(), NOW);
    const out = await syncBills(reply(200, { ok: true, invoiceNumber: 101, orderNumber: 55, retry: false }));
    expect(out).toEqual({ sent: 2, problems: 0, waiting: false });
    expect(loadBills().map((b) => [b.state, b.orderNumber])).toEqual([["synced", 55], ["synced", 55]]);
    expect((await syncBills(reply(200, { ok: true }))).sent).toBe(0); // nothing left to send
  });

  it("keeps a bill the server cannot accept, with the reason, and a retry puts it back in the queue", async () => {
    makeBill(stored(), input(), NOW);
    const out = await syncBills(reply(200, { ok: false, code: "DAY_CLOSED", error: "The day has been closed.", retry: false }));
    expect(out).toMatchObject({ sent: 0, problems: 1 });
    expect(loadBills()[0]).toMatchObject({ state: "problem", code: "DAY_CLOSED", message: "The day has been closed." });
    retryBill(loadBills()[0]!.bill.key);
    expect(loadBills()[0]).toMatchObject({ state: "queued" });
    expect(loadBills()[0]!.message).toBeUndefined();
  });

  it("keeps everything and tries again later when there is no connection or the server is having trouble", async () => {
    makeBill(stored(), input(), NOW);
    makeBill(stored(), input(), NOW);
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await syncBills(down)).toEqual({ sent: 0, problems: 0, waiting: true });
    expect(await syncBills(reply(500, { ok: false, code: "SERVER", retry: true }))).toMatchObject({ waiting: true });
    expect(await syncBills(reply(401, { ok: false, code: "AUTH", retry: true }))).toMatchObject({ waiting: true });
    expect(loadBills().every((b) => b.state === "queued")).toBe(true);
  });

  it("sends the signed snapshot and the bill, and never two sends at once", async () => {
    makeBill(stored(), input(), NOW);
    let calls = 0;
    const slow = (async (_url: string, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init!.body));
      expect(body.sig).toBe("sig");
      expect(body.bill.invoiceNumber).toBe(101);
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify({ ok: true, orderNumber: 7, retry: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([syncBills(slow), syncBills(slow)]);
    expect(calls).toBe(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("only removes bills that are done: a bill still waiting to be sent stays", async () => {
    const waiting = makeBill(stored(), input(), NOW);
    dismissBill(waiting.bill.key);
    expect(loadBills()).toHaveLength(1);
    await syncBills(reply(200, { ok: true, orderNumber: 1, retry: false }));
    dismissBill(waiting.bill.key);
    expect(loadBills()).toHaveLength(0);
  });
});

describe("getting ready while online", () => {
  it("stores the signed snapshot, the number blocks and the used numbers", async () => {
    ls = new MemoryStorage();
    vi.stubGlobal("localStorage", ls);
    const body = { snapshot: JSON.stringify(snapshot), sig: "abc", canBill: true, print: DEFAULT_PRINT, blocks: [{ id: "b9", from: 500, to: 549 }], used: [500, 501] };
    expect(await prepareOffline(reply(200, body))).toBeNull();
    expect(loadBlocks()).toEqual([{ id: "b9", from: 500, to: 549 }]);
    expect([...loadUsed()]).toEqual([500, 501]);
    expect(numbersAvailable()).toBe(48);
    expect(JSON.parse(ls.getItem("ros-pos-snapshot")!).sig).toBe("abc");
  });
  it("says what is wrong when the server refuses, and stays quiet when there is simply no connection", async () => {
    expect(await prepareOffline(reply(401, {}))).toMatch(/sign in again/);
    expect(await prepareOffline(reply(400, { error: "Too many phones hold invoice numbers." }))).toMatch(/Too many phones/);
    const down = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await prepareOffline(down)).toBeNull();
  });
  it("gives the phone one lasting id", () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(getDeviceId()).toBe(id);
  });
});

describe("the receipt on the phone", () => {
  it("is a real PDF at the chosen paper size, built with no connection", () => {
    const saved = makeBill(stored(), input(), NOW);
    const text = Buffer.from(receiptPdf(saved, DEFAULT_PRINT, { widthMm: 58, heightMm: null })).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 164.41");
    expect(text).toContain("Offline sale");
    expect(text).toContain("Buff Momo");
    expect(text).toContain("Invoice #101");
    const wide = Buffer.from(receiptPdf(saved, DEFAULT_PRINT)).toString("latin1");
    expect(wide).toContain("/MediaBox [0 0 226.77"); // the saved 80 mm
  });
});
