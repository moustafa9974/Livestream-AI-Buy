import { searchWords } from "../search/types";

/**
 * Ranks a catalog product against what the camera saw. Pure and backend-independent.
 *
 * score = 0.8 × embedding cosine + 0.2 × word coverage (or coverage alone without
 * embeddings), then category and colour adjustments: a black hoodie must not be sold
 * as the grey one, and a mug must never match a lamp.
 */

export interface Seen {
  label: string;
  category: string;
  attributes: Record<string, string>;
}

export interface Candidate {
  title: string;
  category: string;
  attributes: Record<string, string>;
}

export interface MatchThresholds {
  exact: number;
  similar: number;
}

const words = (s: string) => new Set(searchWords(s));

const leaf = (category: string) => category.split("/").pop() ?? "";

/**
 * Share of the seen item's *product words* the candidate also has (0–1). Colour words
 * and the top-level category ("electronics") are excluded: they're shared by unrelated
 * products and made "silver laptop" look like a silver mic during calibration.
 */
export function coverage(seen: Seen, c: Candidate): number {
  const colors = words(`${seen.attributes.color ?? ""} ${c.attributes.color ?? ""}`);
  const a = [...words(`${seen.label} ${leaf(seen.category)}`)].filter((w) => !colors.has(w));
  const nonColorAttrs = Object.entries(c.attributes).filter(([k]) => k !== "color").map(([, v]) => v);
  const b = words(`${c.title} ${leaf(c.category)} ${nonColorAttrs.join(" ")}`);
  if (a.length === 0) return 0;
  return a.filter((w) => b.has(w)).length / a.length;
}

/** Same leaf category, or the candidate mentions the last word of the seen label. */
export function headNounMatch(seen: Seen, c: Candidate): boolean {
  if (leaf(seen.category) && leaf(seen.category) === leaf(c.category)) return true;
  const head = searchWords(seen.label).at(-1);
  return !!head && words(`${c.title} ${c.category.replaceAll("/", " ")}`).has(head);
}

export function scoreCandidate(seen: Seen, c: Candidate, vectorScore: number | null) {
  const cov = coverage(seen, c);
  let score = vectorScore !== null ? 0.8 * vectorScore + 0.2 * cov : cov;
  const reasons: string[] = [];

  // Text-only mode: the product must be the same *kind* of thing (same leaf category,
  // or its words include the seen label's head noun). Otherwise a shared adjective
  // ("wireless keyboard" vs "Wireless Mic Kit") would count as a match.
  if (vectorScore === null && !headNounMatch(seen, c)) {
    score *= 0.5;
    reasons.push("head_noun_mismatch");
  }

  const [seenTop, seenLeaf] = seen.category.split("/");
  const [candTop, candLeaf] = c.category.split("/");
  if (seenTop && candTop && seenTop !== candTop) {
    score -= 0.15;
    reasons.push("category_mismatch");
  } else if (seenLeaf && candLeaf && seenLeaf === candLeaf) {
    score += 0.03;
    reasons.push("same_leaf_category");
  } else if (seenLeaf && candLeaf && coverage(seen, c) < 0.5) {
    // Same department, different kind of thing (laptop vs microphone, plant vs tumbler).
    score -= 0.08;
    reasons.push("leaf_mismatch");
  }

  const seenColor = words(seen.attributes.color ?? "");
  const candColor = words(c.attributes.color ?? "");
  let colorConflict = false;
  if (seenColor.size && candColor.size) {
    if ([...seenColor].some((w) => candColor.has(w))) {
      score += 0.04;
      reasons.push("color_match");
    } else {
      // A different colour can never be "exact" (see classify), but the same kind of
      // product in another colour is exactly what "similar" means, so only a small nudge.
      score -= 0.04;
      colorConflict = true;
      reasons.push("color_conflict");
    }
  }
  return { score: Math.max(0, Math.min(1, score)), colorConflict, coverage: cov, reasons };
}

/** "exact" needs the threshold AND no colour conflict; otherwise "similar" or no match. */
export function classify(
  s: { score: number; colorConflict: boolean },
  t: MatchThresholds,
): "exact" | "similar" | null {
  if (s.score >= t.exact && !s.colorConflict) return "exact";
  if (s.score >= t.similar) return "similar";
  return null;
}
