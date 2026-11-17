/**
 * The Restaurant OS side of the Customer OS API (/api/integrations/v1). Plain HTTP with a timeout: no database, no secrets
 * beyond the key passed in. `fetchImpl` is injectable so tests need no network.
 */

export interface CosTarget {
  baseUrl: string;
  key: string;
}

export interface CosPurchase {
  externalId: string;
  phone: string;
  name?: string;
  /** Integer paisa. */
  amountMinor: number;
  /** ISO 8601 */
  occurredAt: string;
}

export interface CosPurchaseResult {
  purchaseId: string;
  deduplicated: boolean;
  pointsEarned: number;
  balance: number | null;
  programType: "POINTS" | "STAMPS" | null;
  rewardsAvailable: number;
}

export type CosBalance =
  | { found: false }
  | {
      found: true;
      name: string;
      program: { name: string; type: "POINTS" | "STAMPS" } | null;
      balance: number;
      rewardCost: number | null;
      rewardName: string | null;
      rewardsAvailable: number;
      rewards: CosReward[];
      totalSpendMinor: number;
      purchaseCount: number;
    };

/** An earned reward waiting to be used. */
export interface CosReward {
  customerRewardId: string;
  name: string;
  type: "FREE_ITEM" | "DISCOUNT";
  /** DISCOUNT only: integer paisa off the bill. */
  valueMinor: number | null;
  /** Points or stamps it uses up. */
  requiredBalance: number;
  redeemable: boolean;
}

export interface CosRedemption {
  redemptionId: string;
  rewardName: string;
  type: "FREE_ITEM" | "DISCOUNT";
  valueMinor: number | null;
  consumed: number;
  balance: number;
  deduplicated: boolean;
}

export interface CosRefundResult {
  counted: number;
  pointsReversed: number;
  pointsShortfall: number;
  balance: number | null;
  deduplicated: boolean;
  fullyRefunded: boolean;
}

/** `retry: true` means trying the same request later may work (network, server, key problems); false means it never will. */
export type CosResult<T> = { ok: true; data: T } | { ok: false; retry: boolean; status: number; message: string };

export type FetchLike =(url: string, init: RequestInit) => Promise<Response>;

/** The address the owner typed, cleaned to scheme + host (+ path prefix) with no trailing slash, or null if unusable. */
export function cleanBaseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

async function call<T>(
  target: CosTarget,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  opts: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<CosResult<T>> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  try {
    const res = await doFetch(`${target.baseUrl}/api/integrations/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${target.key}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      cache: "no-store",
      redirect: "error",
    });
    type Envelope = { ok?: boolean; data?: T; error?: { message?: string } };
    const json = await res.json().then(
      (v) => v as Envelope | null,
      () => null as Envelope | null,
    );
    if (res.ok && json?.ok && json.data !== undefined) return { ok: true, data: json.data };
    const message = json?.error?.message ?? `Customer OS answered ${res.status}.`;
    // 401 (key wrong or revoked), 429 and 5xx can clear up; other 4xx mean this request itself is wrong.
    const retry = res.status === 401 || res.status === 429 || res.status >= 500;
    return { ok: false, retry, status: res.status, message };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, retry: true, status: 0, message: timedOut ? "Customer OS did not answer in time." : "Could not reach Customer OS." };
  }
}

export const cosPing = (t: CosTarget, o?: { fetchImpl?: FetchLike }) => call<{ business: string }>(t, "GET", "/ping", undefined, { timeoutMs: 8_000, ...o });
export const cosRecordPurchase = (t: CosTarget, p: CosPurchase, o?: { fetchImpl?: FetchLike }) => call<CosPurchaseResult>(t, "POST", "/purchases", p, o);
export const cosLookup = (t: CosTarget, phone: string, o?: { fetchImpl?: FetchLike }) => call<CosBalance>(t, "POST", "/customers/lookup", { phone }, { timeoutMs: 4_000, ...o });
export const cosRedeem = (t: CosTarget, p: { externalId: string; customerRewardId: string; phone: string }, o?: { fetchImpl?: FetchLike }) =>
  call<CosRedemption>(t, "POST", "/rewards/redeem", p, { timeoutMs: 8_000, ...o });
export const cosRelease = (t: CosTarget, p: { externalId: string }, o?: { fetchImpl?: FetchLike }) =>
  call<{ released: true; deduplicated: boolean; balance: number }>(t, "POST", "/rewards/release", p, o);
export const cosRefund = (t: CosTarget, p: { saleExternalId: string; externalRefundId: string; amountMinor: number }, o?: { fetchImpl?: FetchLike }) =>
  call<CosRefundResult>(t, "POST", "/refunds", p, o);
