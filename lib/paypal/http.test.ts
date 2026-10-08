import { describe, expect, it, vi } from "vitest";
import { createGateway } from "./gateway";
import { createPayPalHttp, PayPalApiError } from "./http";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(handler: Handler, opts: { timeoutMs?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let tokens = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/v1/oauth2/token")) {
      tokens++;
      return json(200, { access_token: `tok-${tokens}`, expires_in: 32400 });
    }
    return handler(u, init ?? {});
  });
  const http = createPayPalHttp({
    baseUrl: "https://api-m.sandbox.paypal.com",
    clientId: "id",
    clientSecret: "secret",
    timeoutMs: opts.timeoutMs ?? 1000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
  const apiCalls = () => calls.filter((c) => !c.url.endsWith("/oauth2/token"));
  return { http, calls, apiCalls, tokenCount: () => tokens };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe("PayPal http client", () => {
  it("caches the OAuth token across calls", async () => {
    const { http, tokenCount } = setup(() => json(200, { ok: true }));
    await http.request({ method: "GET", path: "/a" });
    await http.request({ method: "GET", path: "/b" });
    expect(tokenCount()).toBe(1);
  });

  it("refreshes the token once on 401", async () => {
    let first = true;
    const { http, tokenCount, apiCalls } = setup(() => {
      if (first) {
        first = false;
        return json(401, { error: "invalid_token" });
      }
      return json(200, { ok: true });
    });
    await expect(http.request({ method: "GET", path: "/a" })).resolves.toEqual({ ok: true });
    expect(tokenCount()).toBe(2);
    expect(header(apiCalls()[1].init, "Authorization")).toBe("Bearer tok-2");
  });

  it("sends PayPal-Request-Id and Prefer headers", async () => {
    const { http, apiCalls } = setup(() => json(201, { id: "X" }));
    await http.request({ method: "POST", path: "/v2/checkout/orders", body: {}, requestId: "rid-1", preferRepresentation: true });
    expect(header(apiCalls()[0].init, "PayPal-Request-Id")).toBe("rid-1");
    expect(header(apiCalls()[0].init, "Prefer")).toBe("return=representation");
  });

  it("retries 5xx for idempotent POSTs (with a request id)", async () => {
    let n = 0;
    const { http, apiCalls } = setup(() => (++n < 3 ? json(503, { name: "SERVICE_UNAVAILABLE" }) : json(201, { id: "X" })));
    await expect(http.request({ method: "POST", path: "/p", body: {}, requestId: "rid" })).resolves.toEqual({ id: "X" });
    expect(apiCalls()).toHaveLength(3);
  });

  it("never retries a POST without a request id (could double-charge)", async () => {
    const { http, apiCalls } = setup(() => json(503, { name: "SERVICE_UNAVAILABLE" }));
    await expect(http.request({ method: "POST", path: "/p", body: {} })).rejects.toBeInstanceOf(PayPalApiError);
    expect(apiCalls()).toHaveLength(1);
  });

  it("does not retry 4xx and exposes PayPal's error name, issues and debug_id", async () => {
    const { http, apiCalls } = setup(() =>
      json(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "abc123", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }),
    );
    const err = (await http
      .request({ method: "POST", path: "/p", body: {}, requestId: "rid" })
      .catch((e: unknown) => e)) as PayPalApiError;
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.status).toBe(422);
    expect(err.paypalName).toBe("UNPROCESSABLE_ENTITY");
    expect(err.debugId).toBe("abc123");
    expect(err.hasIssue("ORDER_ALREADY_CAPTURED")).toBe(true);
    expect(err.message).not.toContain("secret");
    expect(apiCalls()).toHaveLength(1);
  });

  it("times out hung requests and retries GETs", async () => {
    let n = 0;
    const { http, apiCalls } = setup(
      (_url, init) =>
        ++n === 1
          ? new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))
          : json(200, { ok: true }),
      { timeoutMs: 20 },
    );
    await expect(http.request({ method: "GET", path: "/slow" })).resolves.toEqual({ ok: true });
    expect(apiCalls()).toHaveLength(2);
  });

  it("fails fast on bad credentials without retrying", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "invalid_client" }));
    const http = createPayPalHttp({
      baseUrl: "https://x", clientId: "id", clientSecret: "bad", timeoutMs: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {},
    });
    await expect(http.request({ method: "GET", path: "/a" })).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("webhook signature verification", () => {
  it("posts the raw event body back verbatim", async () => {
    // Odd spacing/key order on purpose: re-serializing would change these bytes.
    const raw = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"45.00"}}}';
    const { http, apiCalls } = setup(() => json(200, { verification_status: "SUCCESS" }));
    const ok = await createGateway(http).verifyWebhookSignature(
      { authAlgo: "SHA256withRSA", certUrl: "https://c", transmissionId: "t", transmissionSig: "s", transmissionTime: "now" },
      raw,
      "WEBHOOK-ID",
    );
    expect(ok).toBe(true);
    const sent = apiCalls()[0].init.body as string;
    expect(sent.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(sent)).toMatchObject({ webhook_id: "WEBHOOK-ID", auth_algo: "SHA256withRSA" });
  });

  it("returns false on FAILURE", async () => {
    const { http } = setup(() => json(200, { verification_status: "FAILURE" }));
    const ok = await createGateway(http).verifyWebhookSignature(
      { authAlgo: "a", certUrl: "c", transmissionId: "t", transmissionSig: "s", transmissionTime: "n" },
      "{}",
      "W",
    );
    expect(ok).toBe(false);
  });
});
