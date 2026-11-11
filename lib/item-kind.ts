/**
 * What kind of thing a detection label names: its head noun, which in English labels is
 * the last word ("black laptop computer" → "computer", "white ceramic mug" → "mug").
 * The AI describes the same object differently across frames, and objects that match no
 * store product can't be merged by product, so the rail merges them by kind instead.
 */
export function itemKind(label: string): string {
  const words = label.toLowerCase().match(/[a-z]+/g) ?? [];
  const head = words.at(-1) ?? label.toLowerCase();
  // Plural → singular, enough for product nouns ("headphones" → "headphone", not "glass").
  return head.length > 3 && head.endsWith("s") && !head.endsWith("ss") ? head.slice(0, -1) : head;
}
