import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { beginLogin, beginPasswordCheck } from "./rate-limit";

const run = `rl-${Date.now()}`;
const mail = (n: string) => `${n}-${run}@it.test`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function fail(email: string, ip: string | null) {
  const g = await beginLogin(email, ip);
  return g; // a failed sign-in just keeps its record, so we do not call release()
}

const count = (scope: string, key: string) => db.loginAttempt.count({ where: { scope, key } });

const started = new Date();

afterAll(async () => {
  // Remove exactly what this file created: everything since it started, plus the
  // back-dated rows inserted for the window test.
  const stale = sha(`pair|${mail("old")}|203.0.113.6`);
  await db.loginAttempt.deleteMany({ where: { OR: [{ createdAt: { gte: started } }, { key: stale }] } });
  await db.$disconnect();
});

describe("per account and network", () => {
  it("allows five failed attempts, blocks the sixth, and tells how long to wait", async () => {
    const e = mail("a");
    for (let i = 0; i < 5; i++) expect((await fail(e, "203.0.113.1")).ok).toBe(true);
    const sixth = await fail(e, "203.0.113.1");
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
      expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it("does not extend its own lockout: blocked attempts leave no record", async () => {
    const e = mail("b");
    const pairKey = sha(`pair|${e}|203.0.113.2`);
    for (let i = 0; i < 5; i++) await fail(e, "203.0.113.2");
    expect(await count("pair", pairKey)).toBe(5);
    for (let i = 0; i < 10; i++) expect((await fail(e, "203.0.113.2")).ok).toBe(false);
    expect(await count("pair", pairKey)).toBe(5); // still 5, not 15
  });

  it("treats unknown and known emails identically, so it never reveals which exist", async () => {
    const outcomes: boolean[][] = [];
    for (const e of [mail("exists"), mail("ghost")]) {
      const seq: boolean[] = [];
      for (let i = 0; i < 7; i++) seq.push((await fail(e, "203.0.113.3")).ok);
      outcomes.push(seq);
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]).toEqual([true, true, true, true, true, false, false]);
  });

  it("lets the same person in from another network, and other people on the same network", async () => {
    const e = mail("c");
    for (let i = 0; i < 6; i++) await fail(e, "203.0.113.4");
    expect((await fail(e, "203.0.113.4")).ok).toBe(false);
    expect((await fail(e, "203.0.113.5")).ok).toBe(true); // different network: its own pair counter
    expect((await fail(mail("d"), "203.0.113.4")).ok).toBe(true); // different account, same network
  });

  it("only counts attempts inside the window", async () => {
    const e = mail("old");
    const key = sha(`pair|${e}|203.0.113.6`);
    const old = new Date(Date.now() - 20 * 60_000);
    await db.loginAttempt.createMany({ data: Array.from({ length: 5 }, () => ({ scope: "pair", key, createdAt: old })) });
    expect((await fail(e, "203.0.113.6")).ok).toBe(true); // five stale attempts do not count
  });

  it("a successful sign-in releases its record and clears earlier failures", async () => {
    const e = mail("ok");
    const key = sha(`pair|${e}|203.0.113.7`);
    for (let i = 0; i < 4; i++) await fail(e, "203.0.113.7");
    const good = await beginLogin(e, "203.0.113.7");
    expect(good.ok).toBe(true);
    if (good.ok) await good.release();
    expect(await count("pair", key)).toBe(0);
    for (let i = 0; i < 5; i++) expect((await fail(e, "203.0.113.7")).ok).toBe(true); // fresh allowance
  });
});

describe("per network", () => {
  it("limits one network guessing many different accounts (password spraying)", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 32; i++) results.push((await fail(mail(`spray${i}`), "198.51.100.9")).ok);
    expect(results.slice(0, 30).every(Boolean)).toBe(true);
    expect(results[30]).toBe(false);
    expect(results[31]).toBe(false);
  });

  it("skips the network counter when the IP is unknown, keeping the account limit", async () => {
    const e = mail("noip");
    const seq: boolean[] = [];
    for (let i = 0; i < 6; i++) seq.push((await fail(e, null)).ok);
    expect(seq).toEqual([true, true, true, true, true, false]);
  });
});

describe("per account overall", () => {
  it("caps a distributed attack on one account across many networks", async () => {
    const e = mail("dist");
    const seq: boolean[] = [];
    for (let i = 0; i < 52; i++) seq.push((await fail(e, `192.0.2.${i + 1}`)).ok);
    expect(seq.slice(0, 50).every(Boolean)).toBe(true);
    expect(seq[50]).toBe(false);
  });
});

describe("password change check", () => {
  it("allows five wrong current passwords, then blocks until released or aged out", async () => {
    const userId = `user-${run}`;
    for (let i = 0; i < 5; i++) expect((await beginPasswordCheck(userId)).ok).toBe(true);
    const blocked = await beginPasswordCheck(userId);
    expect(blocked.ok).toBe(false);
  });

  it("releases on success", async () => {
    const userId = `user2-${run}`;
    for (let i = 0; i < 3; i++) await beginPasswordCheck(userId);
    const g = await beginPasswordCheck(userId);
    if (g.ok) await g.release();
    for (let i = 0; i < 5; i++) expect((await beginPasswordCheck(userId)).ok).toBe(true);
  });
});
