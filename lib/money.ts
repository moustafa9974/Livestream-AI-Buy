/**
 * Money helpers. All amounts are integer minor units (cents for USD).
 * Floats never touch money: PayPal sends/receives decimal *strings*, which we
 * parse/format with string arithmetic only.
 */

// PayPal REST currency codes. HUF, JPY and TWD do not accept decimals in PayPal.
// Source: developer.paypal.com/api/rest/reference/currency-codes (re-check before adding).
const CURRENCY_EXPONENT: Record<string, number> = {
  AUD: 2, BRL: 2, CAD: 2, CNY: 2, CZK: 2, DKK: 2, EUR: 2, HKD: 2, HUF: 0, ILS: 2,
  JPY: 0, MYR: 2, MXN: 2, TWD: 0, NZD: 2, NOK: 2, PHP: 2, PLN: 2, GBP: 2, SGD: 2,
  SEK: 2, CHF: 2, THB: 2, USD: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENT);

export type Currency = string;

export function isSupportedCurrency(code: string): boolean {
  return code in CURRENCY_EXPONENT;
}

export function currencyExponent(currency: Currency): number {
  const exp = CURRENCY_EXPONENT[currency];
  if (exp === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return exp;
}

function assertMinor(minor: number): void {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Money must be a safe integer of minor units, got ${minor}`);
  }
}

/** "12.34" + USD → 1234. Rejects more decimals than the currency allows. */
export function toMinor(value: string, currency: Currency): number {
  const exp = currencyExponent(currency);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid money string: "${value}"`);
  const [, sign, whole, frac = ""] = match;
  if (frac.length > exp) {
    throw new Error(`"${value}" has more than ${exp} decimals for ${currency}`);
  }
  const minor = Number(whole + frac.padEnd(exp, "0"));
  assertMinor(minor);
  return sign ? -minor : minor;
}

/** 1234 + USD → "12.34". This is the exact string format PayPal expects in `value`. */
export function toPayPalValue(minor: number, currency: Currency): string {
  assertMinor(minor);
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor).toString().padStart(exp + 1, "0");
  if (exp === 0) return sign + digits;
  return `${sign}${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

export function toPayPalAmount(minor: number, currency: Currency) {
  return { currency_code: currency, value: toPayPalValue(minor, currency) };
}

/** Display formatting only. Never parse the result back. */
export function formatMoney(minor: number, currency: Currency, locale = "en-US"): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp);
}

/**
 * Commission = floor(base × bps / 10000). Floor so the platform never pays out
 * more than the agreed rate; BigInt so large bases can't lose precision.
 */
export function commissionMinor(baseMinor: number, rateBps: number): number {
  assertMinor(baseMinor);
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new Error(`rateBps must be an integer in [0, 10000], got ${rateBps}`);
  }
  if (baseMinor < 0) throw new Error("Commission base cannot be negative");
  return Number((BigInt(baseMinor) * BigInt(rateBps)) / 10_000n);
}

/**
 * How much commission to claw back when `refundMinor` of `capturedMinor` is refunded.
 * Proportional, rounded up so cumulative partial refunds always reverse the full
 * commission by the time the order is fully refunded. Capped at what's left.
 */
export function commissionReversalMinor(args: {
  commissionMinor: number;
  alreadyReversedMinor: number;
  capturedMinor: number;
  refundedTotalMinor: number; // cumulative refunded, including this refund
}): number {
  const { commissionMinor: c, alreadyReversedMinor, capturedMinor, refundedTotalMinor } = args;
  [c, alreadyReversedMinor, capturedMinor, refundedTotalMinor].forEach(assertMinor);
  if (capturedMinor <= 0) return 0;
  const refunded = Math.min(refundedTotalMinor, capturedMinor);
  const targetReversed = Number(
    (BigInt(c) * BigInt(refunded) + BigInt(capturedMinor) - 1n) / BigInt(capturedMinor),
  );
  return Math.max(0, Math.min(c, targetReversed) - alreadyReversedMinor);
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((acc, v) => {
    assertMinor(v);
    const next = acc + v;
    assertMinor(next);
    return next;
  }, 0);
}
