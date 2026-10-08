"use client";

import { useEffect, useState } from "react";
import type { PayPalSdkInstance } from "./sdk-types";

const SCRIPT_URL = {
  sandbox: "https://www.sandbox.paypal.com/web-sdk/v6/core",
  live: "https://www.paypal.com/web-sdk/v6/core",
} as const;

// One script + one SDK instance per page load, shared by every checkout drawer.
let instancePromise: Promise<PayPalSdkInstance> | undefined;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.paypal) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("PayPal SDK failed to load")), { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function getInstance(clientId: string, env: "sandbox" | "live"): Promise<PayPalSdkInstance> {
  instancePromise ??= loadScript(SCRIPT_URL[env])
    .then(() =>
      window.paypal!.createInstance({
        clientId,
        components: ["paypal-payments", "paypal-guest-payments"],
        pageType: "checkout",
      }),
    )
    .catch((err) => {
      instancePromise = undefined; // allow a retry on the next mount
      throw err;
    });
  return instancePromise;
}

export type SdkState =
  | { status: "loading" }
  | { status: "ready"; sdk: PayPalSdkInstance; paypal: boolean; card: boolean }
  | { status: "error"; message: string };

export function usePayPalSdk(clientId: string, env: "sandbox" | "live", currency: string): SdkState {
  const [state, setState] = useState<SdkState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getInstance(clientId, env)
      .then(async (sdk) => {
        const methods = await sdk.findEligibleMethods({ currencyCode: currency });
        if (!cancelled) {
          setState({ status: "ready", sdk, paypal: methods.isEligible("paypal"), card: methods.isEligible("card") });
        }
      })
      .catch((err: Error) => !cancelled && setState({ status: "error", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [clientId, env, currency]);

  return state;
}
