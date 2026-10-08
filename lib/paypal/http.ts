import { getEnv } from "../env";

/**
 * Minimal typed PayPal REST client.
 *
 * - OAuth token cached in memory until 60s before expiry; refreshed once on a 401.
 * - Every call has a timeout.
 * - Retries (network error, timeout, 429, 5xx) happen ONLY for GETs or requests that
 *   carry a PayPal-Request-Id, because PayPal de-duplicates those, so a retry can
 *   never create a second order/refund/payout.
 * - Errors carry PayPal's `name`, `debug_id` and issue codes, never request bodies,
 *   tokens or payer details.
 */

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly paypalName: string | undefined,
    readonly debugId: string | undefined,
    readonly issues: string[],
    readonly retryable: boolean,
  ) {
    super(
      `PayPal API ${status}${paypalName ? ` ${paypalName}` : ""}` +
        (issues.length ? ` [${issues.join(", ")}]` : "") +
        (debugId ? ` debug_id=${debugId}` : ""),
    );
    this.name = "PayPalApiError";
  }

  hasIssue(issue: string): boolean {
    return this.issues.includes(issue);
  }
}

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  /** Pre-serialized JSON sent byte-for-byte (webhook verification needs this). */
  rawBody?: string;
  /** PayPal-Request-Id idempotency key. Required for POSTs that create money movement. */
  requestId?: string;
  /** Ask for the full resource back instead of a minimal one. */
  preferRepresentation?: boolean;
}

export interface PayPalHttpConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

export function createPayPalHttp(config: PayPalHttpConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = config.maxRetries ?? 2;
  let token: { value: string; expiresAt: number } | undefined;

  async function timedFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function getToken(force = false): Promise<string> {
    if (!force && token && Date.now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await timedFetch(`${config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw await toError(res);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return token.value;
  }

  async function request<T>(req: PayPalRequest): Promise<T> {
    const canRetry = req.method === "GET" || Boolean(req.requestId);
    let refreshedToken = false;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${await getToken()}`,
          "Content-Type": "application/json",
        };
        if (req.requestId) headers["PayPal-Request-Id"] = req.requestId;
        if (req.preferRepresentation) headers["Prefer"] = "return=representation";
        res = await timedFetch(`${config.baseUrl}${req.path}`, {
          method: req.method,
          headers,
          body: req.rawBody ?? (req.body === undefined ? undefined : JSON.stringify(req.body)),
        });
      } catch (err) {
        // A definite token error (bad credentials) won't fix itself on retry.
        if (err instanceof PayPalApiError && !err.retryable) throw err;
        // Network failure or our timeout: outcome unknown. Retry only if idempotent.
        if (canRetry && attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        if (err instanceof PayPalApiError) throw err;
        throw new PayPalApiError(0, "NETWORK_ERROR", undefined, [], canRetry);
      }

      if (res.status === 401 && !refreshedToken) {
        refreshedToken = true;
        await getToken(true);
        continue;
      }
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }
      const error = await toError(res);
      if (error.retryable && canRetry && attempt < maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw error;
    }
  }

  return { request, getToken };
}

function backoff(attempt: number): number {
  return 300 * 2 ** attempt + Math.floor(Math.random() * 100);
}

async function toError(res: Response): Promise<PayPalApiError> {
  let body: { name?: string; error?: string; debug_id?: string; details?: { issue?: string }[] } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error body: keep status only.
  }
  const issues = (body.details ?? []).map((d) => d.issue).filter((i): i is string => !!i);
  const retryable = res.status === 429 || res.status >= 500;
  return new PayPalApiError(res.status, body.name ?? body.error, body.debug_id, issues, retryable);
}

export type PayPalHttp = ReturnType<typeof createPayPalHttp>;

let shared: PayPalHttp | undefined;

/** Process-wide client built from env. Throws if PayPal isn't configured. */
export function paypalHttp(): PayPalHttp {
  if (shared) return shared;
  const env = getEnv();
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)");
  }
  shared = createPayPalHttp({
    baseUrl: BASE_URLS[env.PAYPAL_ENV],
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    timeoutMs: env.PAYPAL_TIMEOUT_MS,
  });
  return shared;
}
