import { z } from "zod";

/**
 * The vision contract (SPEC §3), shared by every provider.
 *
 * Models return `box_2d` as [ymin, xmin, ymax, xmax] on a 0–1000 grid (Gemini's native
 * detection format, which it localizes best in); normalize() converts it to our
 * [x, y, w, h] in 0–1.
 */
export const RawVisionItem = z.object({
  label: z.string(),
  category: z.string(),
  brand_guess: z.string(),
  attributes: z.object({
    color: z.string().optional(),
    material: z.string().optional(),
    style: z.string().optional(),
    pattern: z.string().optional(),
  }),
  box_2d: z.array(z.number()).length(4),
  prominence: z.number(),
  confidence: z.number(),
  mentioned_in_audio: z.boolean(),
});

export const RawVisionResult = z.object({
  items: z.array(RawVisionItem),
  scene: z.string(),
});
export type RawVisionResult = z.infer<typeof RawVisionResult>;

/** Plain JSON Schema for providers that take one (Gemini responseJsonSchema, Ollama format). */
export const VISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short generic product name, e.g. 'black hooded sweatshirt'" },
          category: { type: "string", description: "Slash path, e.g. 'apparel/hoodie', 'home/mug'" },
          brand_guess: { type: "string", description: "Brand only if clearly legible, else 'unknown'" },
          attributes: {
            type: "object",
            properties: {
              color: { type: "string" },
              material: { type: "string" },
              style: { type: "string" },
              pattern: { type: "string" },
            },
          },
          box_2d: {
            type: "array",
            items: { type: "integer" },
            minItems: 4,
            maxItems: 4,
            description: "[ymin, xmin, ymax, xmax] normalized to 0-1000",
          },
          prominence: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          mentioned_in_audio: { type: "boolean" },
        },
        required: ["label", "category", "brand_guess", "attributes", "box_2d", "prominence", "confidence", "mentioned_in_audio"],
      },
    },
    scene: { type: "string" },
  },
  required: ["items", "scene"],
} as const;

export interface VisionItem {
  label: string;
  category: string;
  brandGuess: string | null;
  attributes: Record<string, string>;
  bbox: [number, number, number, number]; // x, y, w, h in 0–1
  prominence: number;
  confidence: number;
  mentionedInAudio: boolean;
}

export interface VisionResult {
  items: VisionItem[];
  scene: string;
}

export const MAX_ITEMS = 5;

// Code-enforced content safety (SPEC §6.5): never surface these as shoppable, whatever
// the model says. Matched on whole words in label + category.
const DENYLIST = [
  "weapon", "weapons", "gun", "guns", "firearm", "firearms", "rifle", "pistol", "handgun", "ammo", "ammunition",
  "explosive", "explosives", "grenade", "drug", "drugs", "narcotic", "cannabis", "marijuana", "weed", "cbd", "thc",
  "vape", "vapes", "vaping", "e-cigarette", "cigarette", "cigarettes", "tobacco", "cigar", "nicotine",
  "alcohol", "beer", "wine", "liquor", "vodka", "whiskey", "adult", "sex", "sexual", "erotic", "lingerie",
  "prescription", "medication", "pills",
];

// Items that are people, not products. We never identify or describe people.
const PERSON_WORDS = [
  "person", "people", "man", "woman", "men", "women", "boy", "girl", "child", "kid", "baby", "face", "human",
  "creator", "streamer", "host", "selfie", "portrait", "hand", "hands", "hair", "skin",
];

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}

export function isDenied(label: string, category: string): boolean {
  const w = new Set([...words(label), ...words(category)]);
  return DENYLIST.some((d) => w.has(d));
}

/** True when the item IS a person (label is only person words), not "baby bottle". */
export function isPerson(label: string, category: string): boolean {
  const top = category.toLowerCase().split("/")[0];
  if (["person", "people", "human", "face"].includes(top)) return true;
  const w = words(label);
  return w.length > 0 && w.every((x) => PERSON_WORDS.includes(x) || ["a", "the", "young", "smiling"].includes(x));
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Strip control chars/markup and cap length: model text is untrusted data. */
export function cleanText(s: string, max = 80): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Validated raw output → our VisionResult, applying every code-level guardrail:
 * denylist, no people, clamped numbers, sane boxes, max 5, most prominent first.
 * Nothing in here can influence price, commission or payouts: the output is only
 * labels and boxes.
 */
export function normalizeVision(raw: RawVisionResult): VisionResult {
  const items: VisionItem[] = [];
  for (const it of raw.items) {
    const label = cleanText(it.label).toLowerCase();
    const category = cleanText(it.category, 60).toLowerCase().replace(/\s+/g, "-");
    if (!label || !category) continue;
    if (isDenied(label, category) || isPerson(label, category)) continue;

    const [ymin, xmin, ymax, xmax] = it.box_2d.map((v) => clamp01(v / 1000));
    const x = Math.min(xmin, xmax);
    const y = Math.min(ymin, ymax);
    const w = Math.abs(xmax - xmin);
    const h = Math.abs(ymax - ymin);
    if (w < 0.01 || h < 0.01) continue; // degenerate box

    const brand = cleanText(it.brand_guess, 40);
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(it.attributes)) {
      if (typeof v === "string" && cleanText(v, 40)) attributes[k] = cleanText(v, 40).toLowerCase();
    }

    items.push({
      label,
      category,
      brandGuess: !brand || brand.toLowerCase() === "unknown" ? null : brand,
      attributes,
      bbox: [x, y, w, h],
      prominence: clamp01(it.prominence),
      confidence: clamp01(it.confidence),
      mentionedInAudio: it.mentioned_in_audio === true,
    });
  }
  items.sort((a, b) => b.prominence - a.prominence);
  // Models sometimes list a repeated product once per copy (a grid of mugs). Keep one
  // per label+category (the most prominent, since we sorted), so the tracker doesn't
  // turn copies into duplicate detections.
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = `${i.label}|${i.category}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { items: unique.slice(0, MAX_ITEMS), scene: cleanText(raw.scene, 200) };
}
