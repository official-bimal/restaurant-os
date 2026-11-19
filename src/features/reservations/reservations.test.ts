import { describe, expect, it } from "vitest";
import { bookingProblem, canMove, clash, confirmationText, isValidTime, toMinutes, whatsappLink } from "./reservations";

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
