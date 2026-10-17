import { decode } from "jpeg-js";
import { DHASH_H, DHASH_W, dHashFromGray } from "./dhash";

/**
 * Server-side dHash for frames that don't come from a browser (KERNEL screenshots):
 * decode the JPEG, box-average down to 9×8 luminance, then the same dHash the
 * browser sampler computes, so caching and change detection behave identically.
 */
export function dHashFromJpeg(jpeg: Uint8Array): string {
  const img = decode(jpeg, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 20 });
  const gray: number[] = [];
  for (let cy = 0; cy < DHASH_H; cy++) {
    const y0 = Math.floor((cy * img.height) / DHASH_H);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / DHASH_H));
    for (let cx = 0; cx < DHASH_W; cx++) {
      const x0 = Math.floor((cx * img.width) / DHASH_W);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / DHASH_W));
      let sum = 0;
      let n = 0;
      // Sample a grid inside the cell instead of every pixel: plenty for a 72-cell hash.
      const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const i = (y * img.width + x) * 4;
          sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
          n++;
        }
      }
      gray.push(sum / n);
    }
  }
  return dHashFromGray(gray);
}
