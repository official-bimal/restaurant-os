import { describe, expect, it } from "vitest";
import { availableWidgets, TEMPLATE_ORDER, WIDGETS } from "./registry";
import { cleanTemplate, defaultLayout, moveItem, parseConfig, resolveLayout, rowsOf, toDeviceLayout, verticalTarget, type Placed } from "./layout";

const all = WIDGETS;
const order = TEMPLATE_ORDER.CLASSIC;
const ids = (l: Placed[]) => l.map((p) => p.id);

describe("widget library", () => {
  it("has unique ids, a default size each widget offers, and real descriptions", () => {
    expect(new Set(WIDGETS.map((w) => w.id)).size).toBe(WIDGETS.length);
    for (const w of WIDGETS) {
      expect(w.sizes).toContain(w.defaultSize);
      expect(w.title.length).toBeGreaterThan(2);
      expect(w.description.length).toBeGreaterThan(10);
    }
  });
  it("every template orders only real widgets", () => {
    for (const t of Object.values(TEMPLATE_ORDER)) for (const id of t) expect(WIDGETS.some((w) => w.id === id)).toBe(true);
  });
  it("shows people only the widgets their role allows", () => {
    expect(ids(availableWidgets("WAITER").map((w) => ({ id: w.id, size: w.defaultSize })))).not.toContain("salesToday");
    expect(availableWidgets("WAITER").some((w) => w.id === "openOrders")).toBe(true);
    expect(availableWidgets("OWNER").length).toBe(WIDGETS.length);
    expect(availableWidgets("ACCOUNTANT").some((w) => w.id === "salesToday")).toBe(true);
    expect(availableWidgets("ACCOUNTANT").some((w) => w.id === "stockAlerts")).toBe(false);
    // A custom role gets exactly what it was ticked for.
    const w = availableWidgets({ role: "WAITER", permissions: ["bills.view"] }).map((x) => x.id);
    expect(w).toContain("recentTransactions");
    expect(w).not.toContain("customerOverview");
  });
});

describe("resolving a layout", () => {
  it("uses the template order when nothing is saved", () => {
    const r = resolveLayout(null, availableWidgets("OWNER"), TEMPLATE_ORDER.COMPACT);
    expect(r.visible[0]!.id).toBe("attention");
    expect(r.hidden).toEqual([]);
    expect(ids(r.visible)).toHaveLength(WIDGETS.length);
  });
  it("keeps the saved order and hides what was hidden", () => {
    const saved = { order: [{ id: "floor", size: "M" as const }, { id: "salesToday", size: "S" as const }, { id: "openOrders", size: "S" as const }], hidden: ["salesToday"] };
    const r = resolveLayout(saved, availableWidgets("OWNER"), order);
    expect(ids(r.visible).slice(0, 2)).toEqual(["floor", "openOrders"]);
    expect(ids(r.hidden)).toEqual(["salesToday"]);
    expect(ids(r.visible)).not.toContain("salesToday");
  });
  it("adds new widgets after the arranged ones, and drops removed or forbidden ones", () => {
    const saved = { order: [{ id: "openOrders", size: "S" as const }, { id: "salesToday", size: "S" as const }, { id: "retiredWidget", size: "S" as const }], hidden: [] as string[] };
    const waiter = resolveLayout(saved, availableWidgets("WAITER"), order);
    expect(ids(waiter.visible)[0]).toBe("openOrders");
    expect(ids(waiter.visible)).not.toContain("salesToday"); // no permission
    expect(ids(waiter.visible)).not.toContain("retiredWidget"); // no longer exists
    expect(ids(waiter.visible)).toContain("floor"); // never seen before: appears
    const owner = resolveLayout(saved, availableWidgets("OWNER"), order);
    expect(ids(owner.visible).slice(0, 2)).toEqual(["openOrders", "salesToday"]);
    expect(new Set(ids(owner.visible)).size).toBe(ids(owner.visible).length);
  });
  it("puts a size the widget does not offer back to its default", () => {
    const r = resolveLayout({ order: [{ id: "paymentBreakdown", size: "S" }], hidden: [] }, availableWidgets("OWNER"), order);
    expect(r.visible.find((p) => p.id === "paymentBreakdown")!.size).toBe("M");
  });
  it("does not lose a hidden widget the order forgot", () => {
    const r = resolveLayout({ order: [], hidden: ["floor"] }, availableWidgets("OWNER"), order);
    expect(ids(r.hidden)).toEqual(["floor"]);
  });
});

describe("checking a layout from outside", () => {
  const good = { desktop: { order: [{ id: "floor", size: "M" }, { id: "floor", size: "L" }, { id: "nope", size: "S" }, { id: "salesToday", size: "L" }], hidden: ["openOrders", "nope", 7] }, mobile: { order: [], hidden: [] } };
  it("drops unknown widgets and repeats, fixes sizes, ignores bad hidden entries", () => {
    const c = parseConfig(good, all);
    expect(c.v).toBe(1);
    expect(c.desktop.order).toEqual([{ id: "floor", size: "M" }, { id: "salesToday", size: "S" }]);
    expect(c.desktop.hidden).toEqual(["openOrders"]);
  });
  it("refuses things that are not layouts", () => {
    for (const bad of [null, "x", 5, {}, { desktop: {}, mobile: {} }, { desktop: { order: "a", hidden: [] }, mobile: { order: [], hidden: [] } }]) expect(() => parseConfig(bad, all)).toThrow(/not valid/);
    expect(() => parseConfig({ desktop: { order: new Array(101).fill({ id: "floor", size: "M" }), hidden: [] }, mobile: { order: [], hidden: [] } }, all)).toThrow(/too large/);
  });
  it("round-trips what the editor saves", () => {
    const d = defaultLayout(all, order);
    const hidden = d.order.slice(0, 2);
    const saved = toDeviceLayout(d.order.slice(2), hidden);
    const c = parseConfig({ desktop: saved, mobile: saved }, all);
    const r = resolveLayout(c.desktop, all, order);
    expect(ids(r.hidden)).toEqual(ids(hidden));
    expect(ids(r.visible)).toEqual(ids(d.order.slice(2)));
  });
  it("only accepts the three templates", () => {
    expect(cleanTemplate("MODERN")).toBe("MODERN");
    expect(cleanTemplate("nope")).toBe("CLASSIC");
    expect(cleanTemplate(undefined)).toBe("CLASSIC");
  });
});

describe("moving cards", () => {
  const L = (...x: [string, "S" | "M" | "L"][]): Placed[] => x.map(([id, size]) => ({ id, size }));
  it("moves one item without changing the others", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
  it("works out rows for each device", () => {
    const l = L(["a", "S"], ["b", "S"], ["c", "M"], ["d", "L"], ["e", "S"]);
    expect(rowsOf(l, "desktop")).toEqual([0, 0, 0, 1, 2]);
    expect(rowsOf(l, "mobile")).toEqual([0, 0, 1, 2, 3]);
  });
  it("moves up and down by a row", () => {
    const l = L(["a", "S"], ["b", "S"], ["c", "M"], ["d", "L"], ["e", "S"]);
    expect(verticalTarget(l, "desktop", 4, "up")).toBe(3);
    expect(verticalTarget(l, "desktop", 3, "up")).toBe(0);
    expect(verticalTarget(l, "desktop", 0, "up")).toBe(0);
    expect(verticalTarget(l, "desktop", 1, "down")).toBe(3);
    expect(verticalTarget(l, "desktop", 4, "down")).toBe(4);
  });
});
