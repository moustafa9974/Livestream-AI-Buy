/**
 * What kind of thing a detection label names: its head noun, which in English labels is
 * usually the last word ("white ceramic mug" → "mug"). Generic trailing words don't count,
 * so "laptop computer" is a laptop (and merges with "laptop"), while "computer mouse"
 * stays a mouse. The AI describes the same object differently across frames, and objects
 * that match no store product can't be merged by product, so the rail merges them by kind.
 */
const GENERIC = new Set(["computer", "device", "item", "product", "object", "thing", "unit", "set", "accessory", "accessories", "equipment"]);

const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function itemKind(label: string): string {
  const words = label.toLowerCase().match(/[a-z]+/g) ?? [];
  // Last non-generic word; if every word is generic ("computer"), use the last one.
  const head = [...words].reverse().find((w) => !GENERIC.has(w)) ?? words.at(-1) ?? label.toLowerCase();
  // Plural → singular, enough for product nouns ("headphones" → "headphone", not "glass").
  return singular(head);
}
