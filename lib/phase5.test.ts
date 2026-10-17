import { encode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { isZapierHookUrl } from "./zapier-url";
import { dHashFromGray, hamming } from "./vision/dhash";
import { dHashFromJpeg } from "./vision/server-hash";

describe("Zapier hook URL guard (user-supplied URL → no SSRF)", () => {
  it("accepts only https Catch Hook URLs on hooks.zapier.com", () => {
    expect(isZapierHookUrl("https://hooks.zapier.com/hooks/catch/123/abc/")).toBe(true);
    expect(isZapierHookUrl("http://hooks.zapier.com/hooks/catch/123/abc/")).toBe(false);
    expect(isZapierHookUrl("https://hooks.zapier.com.evil.com/hooks/catch/1/2/")).toBe(false);
    expect(isZapierHookUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isZapierHookUrl("https://hooks.zapier.com/admin")).toBe(false);
    expect(isZapierHookUrl("not a url")).toBe(false);
  });
});

describe("server-side dHash (KERNEL frames)", () => {
  // A 90×80 image: brightness rises left→right, so every dHash bit is 0, like the browser path.
  function gradientJpeg(invert = false) {
    const w = 90;
    const h = 80;
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = invert ? 255 - Math.round((x / (w - 1)) * 255) : Math.round((x / (w - 1)) * 255);
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    return encode({ data, width: w, height: h }, 90).data;
  }

  it("matches the browser's dHash for the same picture", () => {
    const browserStyle = dHashFromGray(Array.from({ length: 72 }, (_, i) => (i % 9) * 30));
    expect(hamming(dHashFromJpeg(gradientJpeg()), browserStyle)).toBeLessThanOrEqual(2);
  });

  it("very different pictures hash far apart", () => {
    expect(hamming(dHashFromJpeg(gradientJpeg()), dHashFromJpeg(gradientJpeg(true)))).toBeGreaterThan(50);
  });
});
