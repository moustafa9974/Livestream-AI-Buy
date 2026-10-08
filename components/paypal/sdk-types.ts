/**
 * Minimal types for the PayPal JS SDK v6 surface we use (developer.paypal.com/sdk/js/reference,
 * checked 2026-10-08). Hand-written to avoid an extra dependency.
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

export interface PayPalApproveData {
  orderId: string;
  payerId?: string;
}

export interface PayPalSessionCallbacks {
  onApprove: (data: PayPalApproveData) => Promise<void> | void;
  onCancel?: (data: { orderId?: string }) => void;
  onError?: (error: { code?: string; message?: string }) => void;
}

export interface PayPalGuestSessionCallbacks extends PayPalSessionCallbacks {
  onComplete?: (data: unknown) => void;
  /** Recoverable errors (e.g. declined card); PayPal keeps the form open for a retry. */
  onWarn?: (warning: { code?: string; message?: string }) => void;
}

export interface PayPalPaymentSession {
  start(
    options: { presentationMode: "auto" | "popup" | "modal" | "redirect" },
    orderPromise: Promise<{ orderId: string }>,
  ): Promise<void>;
}

export interface PayPalEligibility {
  isEligible(method: "paypal" | "card" | "venmo" | "paylater" | "credit" | "advanced_cards"): boolean;
}

export interface PayPalSdkInstance {
  findEligibleMethods(options: { currencyCode: string }): Promise<PayPalEligibility>;
  createPayPalOneTimePaymentSession(callbacks: PayPalSessionCallbacks): PayPalPaymentSession;
  createPayPalGuestOneTimePaymentSession(callbacks: PayPalGuestSessionCallbacks): Promise<PayPalPaymentSession> | PayPalPaymentSession;
}

export interface PayPalNamespace {
  createInstance(options: {
    clientId: string;
    components: Array<"paypal-payments" | "paypal-guest-payments">;
    pageType?: "checkout" | "product-details" | "cart";
    locale?: string;
  }): Promise<PayPalSdkInstance>;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

// Web components rendered by the SDK.
type El = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": El & { type?: "pay" | "checkout" | "buynow"; class?: string };
      "paypal-basic-card-container": El;
      "paypal-basic-card-button": El;
    }
  }
}
