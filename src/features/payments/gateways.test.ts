import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { esewaConfirm, esewaForm, esewaSign, khaltiInitiate, khaltiLookup, nprText, PROVIDERS, readEsewaReply, type FetchLike } from "./gateways";

const reply = (body: unknown, status = 200): ReturnType<FetchLike> => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("amounts", () => {
  it("writes rupees for the services", () => {
    expect(nprText(25_000)).toBe("250");
    expect(nprText(25_050)).toBe("250.5");
    expect(nprText(25_005)).toBe("250.05");
    expect(nprText(99)).toBe("0.99");
  });
  it("lists eSewa and Khalti as API services and the rest as manual", () => {
    expect(PROVIDERS.filter((p) => p.kind === "API").map((p) => p.id)).toEqual(["ESEWA", "KHALTI"]);
    expect(PROVIDERS.filter((p) => p.kind === "MANUAL").length).toBe(4);
  });
});

describe("eSewa", () => {
  const secret = "test-secret-key";
  it("signs the three fields in order with HMAC-SHA256 in base64", () => {
    const sig = esewaSign(secret, { total_amount: "100", transaction_uuid: "11-201-13", product_code: "EPAYTEST" }, ["total_amount", "transaction_uuid", "product_code"]);
    expect(sig).toBe(createHmac("sha256", secret).update("total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST").digest("base64"));
  });
  it("builds the form with the amount in rupees and a signature that matches", () => {
    const f = esewaForm({ mode: "TEST", productCode: "EPAYTEST", secret, amount: 25_050, uuid: "A-1", successUrl: "https://x/ok", failureUrl: "https://x/no" });
    expect(f.action).toBe("https://rc-epay.esewa.com.np/api/epay/main/v2/form");
    expect(f.fields).toMatchObject({ total_amount: "250.5", amount: "250.5", tax_amount: "0", transaction_uuid: "A-1", product_code: "EPAYTEST", signed_field_names: "total_amount,transaction_uuid,product_code" });
    expect(f.fields.signature).toBe(esewaSign(secret, { total_amount: "250.5", transaction_uuid: "A-1", product_code: "EPAYTEST" }, ["total_amount", "transaction_uuid", "product_code"]));
    expect(esewaForm({ mode: "LIVE", productCode: "X", secret, amount: 100, uuid: "u", successUrl: "a", failureUrl: "b" }).action).toBe("https://epay.esewa.com.np/api/epay/main/v2/form");
  });
  it("accepts eSewa's signed reply and refuses a changed or unsigned one", () => {
    const fields = { transaction_code: "000AWEO", status: "COMPLETE", total_amount: "250.5", transaction_uuid: "A-1", product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
    const signature = esewaSign(secret, fields, fields.signed_field_names.split(","));
    expect(readEsewaReply(encode({ ...fields, signature }), secret)?.transaction_code).toBe("000AWEO");
    expect(readEsewaReply(encode({ ...fields, total_amount: "1", signature }), secret)).toBeNull(); // amount changed
    expect(readEsewaReply(encode({ ...fields, signature }), "other-secret")).toBeNull();
    expect(readEsewaReply(encode(fields), secret)).toBeNull();
    expect(readEsewaReply("not base64 json", secret)).toBeNull();
  });
  it("confirms with eSewa's status service, for the right amount only", async () => {
    let seen = "";
    const ok: FetchLike = (url) => {
      seen = url;
      return reply({ status: "COMPLETE", total_amount: 250.5, ref_id: "0001ABC" });
    };
    const p = { mode: "TEST" as const, productCode: "EPAYTEST", amount: 25_050, uuid: "A-1" };
    expect(await esewaConfirm(ok, p)).toEqual({ paid: true, reference: "0001ABC" });
    expect(seen).toContain("product_code=EPAYTEST");
    expect(seen).toContain("total_amount=250.5");
    expect(seen).toContain("transaction_uuid=A-1");
    expect(await esewaConfirm(() => reply({ status: "COMPLETE", total_amount: 1, ref_id: "x" }), p)).toMatchObject({ paid: false, state: "failed" });
    expect(await esewaConfirm(() => reply({ status: "PENDING" }), p)).toMatchObject({ paid: false, state: "pending" });
    expect(await esewaConfirm(() => reply({ status: "CANCELED" }), p)).toMatchObject({ paid: false, state: "failed" });
    expect(await esewaConfirm(() => reply({}, 500), p)).toMatchObject({ paid: false, state: "pending" });
    expect(await esewaConfirm(() => Promise.reject(new Error("offline")), p)).toMatchObject({ paid: false, state: "pending", reason: "Could not reach eSewa" });
  });
});

describe("Khalti", () => {
  const start = { mode: "TEST" as const, secret: "s3cret", amount: 25_000, orderId: "ORD-1", orderName: "Bill 12", returnUrl: "https://x/back", websiteUrl: "https://x" };
  it("asks for a payment link with the amount in paisa and the key in the header", async () => {
    let req: { url: string; headers?: Record<string, string>; body?: string } | null = null;
    const f: FetchLike = (url, init) => {
      req = { url, headers: init?.headers, body: init?.body };
      return reply({ pidx: "bZQLD9wRVWo4CdESSfuSsB", payment_url: "https://test-pay.khalti.com/?pidx=bZQ", expires_at: "x" });
    };
    const r = await khaltiInitiate(f, start);
    expect(r).toEqual({ ok: true, start: { pidx: "bZQLD9wRVWo4CdESSfuSsB", payUrl: "https://test-pay.khalti.com/?pidx=bZQ" } });
    expect(req!.url).toBe("https://dev.khalti.com/api/v2/epayment/initiate/");
    expect(req!.headers!.Authorization).toBe("key s3cret");
    expect(JSON.parse(req!.body!)).toMatchObject({ amount: 25_000, purchase_order_id: "ORD-1", return_url: "https://x/back" });
  });
  it("reports a refused key or an unreachable Khalti in plain words", async () => {
    expect(await khaltiInitiate(() => reply({ detail: "Invalid token." }, 401), start)).toEqual({ ok: false, error: "Invalid token." });
    expect(await khaltiInitiate(() => reply({}, 401), start)).toEqual({ ok: false, error: "Khalti did not accept the secret key" });
    expect(await khaltiInitiate(() => Promise.reject(new Error("offline")), start)).toEqual({ ok: false, error: "Could not reach Khalti" });
    expect((await khaltiInitiate(() => reply({ pidx: 5 }), start)).ok).toBe(false);
  });
  it("confirms a completed payment for the right amount only", async () => {
    const p = { mode: "LIVE" as const, secret: "s", pidx: "abc", amount: 25_000 };
    let url = "";
    const done: FetchLike = (u) => {
      url = u;
      return reply({ status: "Completed", total_amount: 25_000, transaction_id: "TX9" });
    };
    expect(await khaltiLookup(done, p)).toEqual({ paid: true, reference: "TX9" });
    expect(url).toBe("https://khalti.com/api/v2/epayment/lookup/");
    expect(await khaltiLookup(() => reply({ status: "Completed", total_amount: 100, transaction_id: "x" }), p)).toMatchObject({ paid: false, state: "failed" });
    expect(await khaltiLookup(() => reply({ status: "Pending" }), p)).toMatchObject({ paid: false, state: "pending" });
    expect(await khaltiLookup(() => reply({ status: "Initiated" }), p)).toMatchObject({ paid: false, state: "pending" });
    expect(await khaltiLookup(() => reply({ status: "User canceled" }), p)).toMatchObject({ paid: false, state: "failed" });
    expect(await khaltiLookup(() => reply({ status: "Expired" }), p)).toMatchObject({ paid: false, state: "failed" });
  });
});
