import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Talking to the payment services. No database here: signatures, request bodies and reading replies, with the network call passed in so
 * it can be tested. Money is integer paisa.
 *
 * eSewa (ePay v2): the customer is sent to eSewa with a signed form; eSewa sends them back with a signed reply; we then ask eSewa's status
 * service to confirm. Khalti (ePayment): we ask Khalti for a payment link, send the customer there, then look the payment up.
 * Either way, the customer coming back to our page proves nothing: only eSewa's or Khalti's own answer does.
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type Mode = "TEST" | "LIVE";

export interface ProviderInfo {
  id: "ESEWA" | "KHALTI" | "FONEPAY" | "CONNECTIPS" | "IMEPAY" | "CARD";
  label: string;
  /** API: the software starts and checks the payment. MANUAL: the customer pays on their own and staff record the reference. */
  kind: "API" | "MANUAL";
  /** Chip colours for the buttons. */
  chip: string;
  hint: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "ESEWA", label: "eSewa", kind: "API", chip: "bg-[#60bb46] text-white", hint: "Customer scans or taps a link and pays in their eSewa app." },
  { id: "KHALTI", label: "Khalti", kind: "API", chip: "bg-[#5c2d91] text-white", hint: "Customer pays with Khalti, an e-banking or a card." },
  { id: "FONEPAY", label: "Fonepay QR", kind: "MANUAL", chip: "bg-[#e1251b] text-white", hint: "Customer scans your Fonepay QR with any bank app; you type the reference they show." },
  { id: "CONNECTIPS", label: "ConnectIPS", kind: "MANUAL", chip: "bg-[#0a5eb7] text-white", hint: "Bank-to-bank transfer; you type the reference." },
  { id: "IMEPAY", label: "IME Pay", kind: "MANUAL", chip: "bg-[#d62828] text-white", hint: "Customer pays in the IME Pay app; you type the reference." },
  { id: "CARD", label: "Card", kind: "MANUAL", chip: "bg-stone-800 text-white", hint: "Paid on your card machine; you type the approval code." },
];

export const providerLabel = (id: string) => PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** Rupees as text for a service that wants rupees: 25000 paisa is "250", 25050 is "250.5". */
export function nprText(paisa: number): string {
  const rs = paisa / 100;
  return Number.isInteger(rs) ? String(rs) : rs.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

const sameAmount = (value: unknown, paisa: number) => {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && Math.round(n * 100) === paisa;
};

// ---------------------------------------------------------------------------------------------------
// eSewa

/**
 * eSewa's published sandbox login. The secret key is the one eSewa documents for testing; check it against their developer page if a test
 * payment is refused, since they may change it. Real businesses use the code and key eSewa gives them.
 */
export const ESEWA_TEST = { productCode: "EPAYTEST", secret: "8gBm/:&EnhH.1/q" };

export const esewaFormUrl = (mode: Mode) => (mode === "LIVE" ? "https://epay.esewa.com.np/api/epay/main/v2/form" : "https://rc-epay.esewa.com.np/api/epay/main/v2/form");
export const esewaStatusUrl = (mode: Mode) => (mode === "LIVE" ? "https://epay.esewa.com.np/api/epay/transaction/status/" : "https://rc.esewa.com.np/api/epay/transaction/status/");

/** HMAC-SHA256, base64, over "name=value,name=value" for the named fields in order: how eSewa signs both ways. */
export function esewaSign(secret: string, values: Record<string, string>, names: string[]): string {
  const message = names.map((n) => `${n}=${values[n] ?? ""}`).join(",");
  return createHmac("sha256", secret).update(message).digest("base64");
}

export interface EsewaForm {
  action: string;
  fields: Record<string, string>;
}

/** The signed form that sends the customer to eSewa. */
export function esewaForm(p: { mode: Mode; productCode: string; secret: string; amount: number; uuid: string; successUrl: string; failureUrl: string }): EsewaForm {
  const total = nprText(p.amount);
  const names = ["total_amount", "transaction_uuid", "product_code"];
  const base: Record<string, string> = { total_amount: total, transaction_uuid: p.uuid, product_code: p.productCode };
  return {
    action: esewaFormUrl(p.mode),
    fields: {
      amount: total,
      tax_amount: "0",
      total_amount: total,
      transaction_uuid: p.uuid,
      product_code: p.productCode,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: p.successUrl,
      failure_url: p.failureUrl,
      signed_field_names: names.join(","),
      signature: esewaSign(p.secret, base, names),
    },
  };
}

export interface EsewaReply {
  transaction_code?: string;
  status?: string;
  total_amount?: string | number;
  transaction_uuid?: string;
  product_code?: string;
  signed_field_names?: string;
  signature?: string;
}

/** Reads eSewa's `data` reply and checks its signature. Null when it is damaged or was not signed with our secret. */
export function readEsewaReply(data: string, secret: string): EsewaReply | null {
  let reply: EsewaReply;
  try {
    reply = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as EsewaReply;
  } catch {
    return null;
  }
  if (!reply || typeof reply !== "object" || !reply.signature || !reply.signed_field_names) return null;
  const names = String(reply.signed_field_names).split(",").map((n) => n.trim()).filter(Boolean);
  if (names.length === 0 || names.length > 20) return null;
  const values: Record<string, string> = {};
  for (const n of names) values[n] = String((reply as Record<string, unknown>)[n] ?? "");
  const want = Buffer.from(esewaSign(secret, values, names));
  const got = Buffer.from(String(reply.signature));
  return want.length === got.length && timingSafeEqual(want, got) ? reply : null;
}

export type Confirmation = { paid: true; reference: string } | { paid: false; state: "pending" | "failed"; reason: string };

/** Asks eSewa's status service whether this payment is complete, for exactly this amount. */
export async function esewaConfirm(f: FetchLike, p: { mode: Mode; productCode: string; amount: number; uuid: string }): Promise<Confirmation> {
  const url = `${esewaStatusUrl(p.mode)}?product_code=${encodeURIComponent(p.productCode)}&total_amount=${encodeURIComponent(nprText(p.amount))}&transaction_uuid=${encodeURIComponent(p.uuid)}`;
  let body: Record<string, unknown>;
  try {
    const res = await f(url);
    if (!res.ok) return { paid: false, state: "pending", reason: `eSewa answered ${res.status}` };
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { paid: false, state: "pending", reason: "Could not reach eSewa" };
  }
  const status = String(body.status ?? "");
  if (status === "COMPLETE") {
    if (body.total_amount !== undefined && !sameAmount(body.total_amount, p.amount)) return { paid: false, state: "failed", reason: "eSewa reports a different amount" };
    return { paid: true, reference: String(body.ref_id ?? body.transaction_code ?? p.uuid) };
  }
  if (["PENDING", "AMBIGUOUS", "NOT_FOUND"].includes(status)) return { paid: false, state: "pending", reason: `eSewa says ${status.toLowerCase().replace("_", " ")}` };
  return { paid: false, state: "failed", reason: `eSewa says ${status.toLowerCase() || "no result"}` };
}

// ---------------------------------------------------------------------------------------------------
// Khalti

export const khaltiBase = (mode: Mode) => (mode === "LIVE" ? "https://khalti.com/api/v2" : "https://dev.khalti.com/api/v2");

export interface KhaltiStart {
  pidx: string;
  payUrl: string;
}

/** Asks Khalti for a payment link for this bill. Khalti wants the amount in paisa. */
export async function khaltiInitiate(
  f: FetchLike,
  p: { mode: Mode; secret: string; amount: number; orderId: string; orderName: string; returnUrl: string; websiteUrl: string },
): Promise<{ ok: true; start: KhaltiStart } | { ok: false; error: string }> {
  try {
    const res = await f(`${khaltiBase(p.mode)}/epayment/initiate/`, {
      method: "POST",
      headers: { Authorization: `key ${p.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ return_url: p.returnUrl, website_url: p.websiteUrl, amount: p.amount, purchase_order_id: p.orderId, purchase_order_name: p.orderName.slice(0, 100) }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok || typeof body.pidx !== "string" || typeof body.payment_url !== "string") {
      const why = typeof body.detail === "string" ? body.detail : res.status === 401 ? "Khalti did not accept the secret key" : `Khalti answered ${res.status}`;
      return { ok: false, error: why.slice(0, 160) };
    }
    return { ok: true, start: { pidx: body.pidx, payUrl: body.payment_url } };
  } catch {
    return { ok: false, error: "Could not reach Khalti" };
  }
}

/** Asks Khalti whether a payment is complete, for exactly this amount. */
export async function khaltiLookup(f: FetchLike, p: { mode: Mode; secret: string; pidx: string; amount: number }): Promise<Confirmation> {
  let body: Record<string, unknown>;
  try {
    const res = await f(`${khaltiBase(p.mode)}/epayment/lookup/`, { method: "POST", headers: { Authorization: `key ${p.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ pidx: p.pidx }) });
    if (!res.ok) return { paid: false, state: "pending", reason: `Khalti answered ${res.status}` };
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { paid: false, state: "pending", reason: "Could not reach Khalti" };
  }
  const status = String(body.status ?? "");
  if (status === "Completed") {
    if (!sameAmount(Number(body.total_amount) / 100, p.amount)) return { paid: false, state: "failed", reason: "Khalti reports a different amount" };
    return { paid: true, reference: String(body.transaction_id ?? p.pidx) };
  }
  if (status === "Pending" || status === "Initiated") return { paid: false, state: "pending", reason: `Khalti says ${status.toLowerCase()}` };
  return { paid: false, state: "failed", reason: `Khalti says ${status.toLowerCase() || "no result"}` };
}
