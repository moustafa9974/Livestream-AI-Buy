/**
 * 64-bit difference hash (dHash). Shared by the browser (change filter) and the server
 * (cache lookup), so both sides compute identical hashes.
 *
 * Input: 9×8 grayscale pixels, row-major (9 per row). Each bit says whether a pixel is
 * brighter than its right neighbour, which makes the hash robust to small exposure and
 * compression changes but sensitive to things moving in or out of frame.
 */
export const DHASH_W = 9;
export const DHASH_H = 8;

export function dHashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== DHASH_W * DHASH_H) throw new Error(`dHash needs ${DHASH_W * DHASH_H} pixels`);
  let hex = "";
  for (let y = 0; y < DHASH_H; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      const left = gray[y * DHASH_W + x];
      const right = gray[y * DHASH_W + x + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** RGBA (canvas getImageData of a 9×8 draw) → luminance array. */
export function grayFromRgba(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    out.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

const POPCOUNT = Array.from({ length: 16 }, (_, n) => ((n >> 3) & 1) + ((n >> 2) & 1) + ((n >> 1) & 1) + (n & 1));

/** Number of differing bits (0–64) between two 16-hex-char hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

export const isDHash = (s: string) => /^[0-9a-f]{16}$/.test(s);
