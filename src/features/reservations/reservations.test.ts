import { describe, expect, it } from "vitest";
import { bestTable, bookingProblem, canMove, clash, confirmationText, fits, floorReservations, isValidTime, reservedLine, tableChoices, toMinutes, whatsappLink } from "./reservations";

describe("choosing a table", () => {
  const tables = [
    { id: "t1", label: "T1", capacity: 2 },
    { id: "t2", label: "T2", capacity: 4 },
    { id: "t3", label: "T3", capacity: 4 },
    { id: "t4", label: "T4", capacity: 8 },
  ];
  const r = { id: "r1", date: "2026-11-20", time: "19:00", partySize: 4 };

  it("knows whether a party fits", () => {
    expect(fits(4, 4)).toBe(true);
    expect(fits(2, 3)).toBe(false);
  });

  it("marks tables held by another booking around that time, but not the booking's own hold", () => {
    const booked = [
      { id: "x", tableId: "t2", date: "2026-11-20", time: "19:30", name: "Ram" },
      { id: "r1", tableId: "t3", date: "2026-11-20", time: "19:00", name: "Own" },
      { id: "y", tableId: "t4", date: "2026-11-20", time: "22:00", name: "Late" },
    ];
    const c = tableChoices(tables, booked, r);
    expect(c.find((x) => x.id === "t2")).toMatchObject({ free: false, heldBy: "Ram", heldAt: "19:30" });
    expect(c.find((x) => x.id === "t3")?.free).toBe(true);
    expect(c.find((x) => x.id === "t4")?.free).toBe(true);
    expect(c.find((x) => x.id === "t1")?.fits).toBe(false);
  });

  it("picks the smallest free table that fits, in list order on a tie", () => {
    const booked = [{ id: "x", tableId: "t2", date: "2026-11-20", time: "19:00", name: "Ram" }];
    expect(bestTable(tableChoices(tables, booked, r))?.id).toBe("t3");
    expect(bestTable(tableChoices(tables, [], r))?.id).toBe("t2");
    expect(bestTable(tableChoices(tables, [], { ...r, partySize: 6 }))?.id).toBe("t4");
    expect(bestTable(tableChoices(tables, [], { ...r, partySize: 20 }))).toBeNull();
  });
});

describe("what the floor map says about reservations", () => {
  const row = (id: string, tableId: string | null, time: string, status: "CONFIRMED" | "SEATED" | "CANCELLED" | "REQUESTED" = "CONFIRMED") => ({ id, tableId, name: "Sita Rai", partySize: 4, time, status });
  const now = toMinutes("18:00");

  it("grades a booking by how close it is", () => {
    const at = (time: string) => floorReservations([row("a", "t1", time)], now).get("t1")?.state;
    expect(at("21:00")).toBe("later");
    expect(at("19:00")).toBe("soon");
    expect(at("18:10")).toBe("due");
    expect(at("17:50")).toBe("due");
    expect(at("17:30")).toBe("late");
  });

  it("drops bookings that are seated, cancelled, waiting, without a table, or long past", () => {
    const m = floorReservations([row("a", "t1", "19:00", "SEATED"), row("b", "t2", "19:00", "CANCELLED"), row("c", "t3", "19:00", "REQUESTED"), row("d", null, "19:00"), row("e", "t5", "15:00")], now);
    expect(m.size).toBe(0);
  });

  it("shows the earliest booking that still counts when a table has several", () => {
    const m = floorReservations([row("later", "t1", "21:00"), row("sooner", "t1", "19:00")], now);
    expect(m.get("t1")?.id).toBe("sooner");
  });

  it("words the line", () => {
    expect(reservedLine({ time: "19:00", name: "Sita Rai", partySize: 4, state: "soon" })).toBe("Reserved 19:00 · Sita ×4");
    expect(reservedLine({ time: "17:30", name: "Sita Rai", partySize: 4, state: "late" })).toBe("Late: 17:30 · Sita ×4");
  });
});

const ok = { name: "Sita Rai", partySize: 4, date: "2026-11-20", time: "19:30" };

describe("booking checks", () => {
  it("accepts a good booking", () => {
    expect(bookingProblem(ok, "2026-11-19", 600)).toBeNull();
  });
  it("refuses a past day, a past time today, and too far ahead", () => {
    expect(bookingProblem({ ...ok, date: "2026-11-18" }, "2026-11-19", 600)).toMatch(/passed/);
    expect(bookingProblem({ ...ok, date: "2026-11-19", time: "09:00" }, "2026-11-19", 600)).toMatch(/passed/);
    expect(bookingProblem({ ...ok, date: "2026-11-19", time: "21:00" }, "2026-11-19", 600)).toBeNull();
    expect(bookingProblem({ ...ok, date: "2027-03-01" }, "2026-11-19", 600)).toMatch(/60 days/);
  });
  it("refuses bad names, group sizes, dates and times", () => {
    expect(bookingProblem({ ...ok, name: " " }, "2026-11-19", 0)).toMatch(/name/);
    expect(bookingProblem({ ...ok, partySize: 0 }, "2026-11-19", 0)).toMatch(/call us/);
    expect(bookingProblem({ ...ok, partySize: 21 }, "2026-11-19", 0)).toMatch(/call us/);
    expect(bookingProblem({ ...ok, date: "2026-02-31" }, "2026-11-19", 0)).toMatch(/date/);
    expect(bookingProblem({ ...ok, time: "25:00" }, "2026-11-19", 0)).toMatch(/time/);
  });
});

describe("times and status", () => {
  it("reads times", () => {
    expect(isValidTime("07:05")).toBe(true);
    expect(isValidTime("7:05")).toBe(false);
    expect(toMinutes("19:30")).toBe(1170);
  });
  it("only moves forward", () => {
    expect(canMove("REQUESTED", "CONFIRMED")).toBe(true);
    expect(canMove("REQUESTED", "SEATED")).toBe(false);
    expect(canMove("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(canMove("SEATED", "CANCELLED")).toBe(false);
    expect(canMove("CANCELLED", "CONFIRMED")).toBe(false);
  });
  it("finds bookings too close at one table", () => {
    expect(clash({ date: "2026-11-20", time: "19:00" }, { date: "2026-11-20", time: "20:00" })).toBe(true);
    expect(clash({ date: "2026-11-20", time: "19:00" }, { date: "2026-11-20", time: "20:30" })).toBe(false);
    expect(clash({ date: "2026-11-20", time: "19:00" }, { date: "2026-11-21", time: "19:00" })).toBe(false);
  });
});

describe("messages", () => {
  it("writes the confirmation and a WhatsApp link", () => {
    const t = confirmationText(ok, "Nerro Cafe");
    expect(t).toContain("Hi Sita");
    expect(t).toContain("table for 4");
    const link = whatsappLink("+9779841234567", "Hello there");
    expect(link).toBe("https://wa.me/9779841234567?text=Hello%20there");
  });
});
