import { cn } from "@/lib/utils";

/**
 * PayPal's official wordmark, loaded unmodified from PayPal's own CDN: the same files
 * PayPal's checkout SDK uses (@paypal/sdk-logos 2.3.7, github.com/paypal/paypal-sdk-logos).
 * Linked rather than copied into the repo, so the trademark isn't redistributed under
 * our MIT license. "white" is PayPal's variant for dark backgrounds.
 * Brand use: unaltered, never inside our own buttons (PayPal buttons come from the SDK).
 */
const SRC = {
  white: "https://www.paypalobjects.com/js-sdk-logos/2.3.7/paypal-white.svg",
  blue: "https://www.paypalobjects.com/js-sdk-logos/2.3.7/paypal-blue.svg",
} as const;

export function PayPalLogo({ variant = "white", className }: { variant?: keyof typeof SRC; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- PayPal's own hosted SVG, shown as-is
  return <img src={SRC[variant]} alt="PayPal" className={cn("inline-block h-5 w-auto", className)} />;
}
