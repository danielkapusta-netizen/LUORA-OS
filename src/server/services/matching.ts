// Suggests which Shopify product an Allegro / Empik listing is, from the titles alone. The
// platforms share no SKU, and the titles differ in word order, Polish descriptions and
// punctuation, so this compares the distinctive words of the names.

/** Words that never tell two products apart. */
const STOPWORDS = new Set(['do', 'z', 'ze', 'na', 'w', 'i', 'oraz', 'dla', 'the', 'of', 'for', 'with', 'and', 'default', 'title']);

const UNITS: Record<string, string> = { ml: 'ml', g: 'g', gr: 'g', szt: 'szt', sztuk: 'szt', pcs: 'szt', platkow: 'szt', plat: 'szt' };
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(ml|gr|g|szt|sztuk|pcs|platkow)\b/g;

export interface NormalizedTitle {
  words: string[];
  sizes: string[];
  /** All words run together, to find brands written with or without a space ("Haru Haru"). */
  condensed: string;
}

export function normalizeTitle(title: string): NormalizedTitle {
  let s = title
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ - default title$/, '')
    .replace(/\bspf\s*(\d+)/g, 'spf$1');
  const sizes: string[] = [];
  s = s.replace(SIZE_RE, (_m, n: string, unit: string) => {
    sizes.push(`${Number(n.replace(',', '.'))}${UNITS[unit]}`);
    return ' ';
  });
  const words = s
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)));
  return { words: [...new Set(words)], sizes: [...new Set(sizes)], condensed: words.join('') };
}

export interface MatchCandidate {
  id: string;
  name: string;
}

export interface MatchSuggestion {
  productId: string;
  score: number;
}

/** Scores at or above this are shown as "suggested". */
export const SUGGESTION_THRESHOLD = 0.6;
/** "Confirm all" only takes suggestions this good and this far ahead of the runner-up. */
const CLEAR_SCORE = 0.7;
const CLEAR_LEAD = 0.08;

/** A suggestion good enough to confirm in bulk: a strong score, clearly ahead of the next one. */
export function isClearSuggestion(suggestions: MatchSuggestion[]): boolean {
  const [top, next] = suggestions;
  return Boolean(top && top.score >= CLEAR_SCORE && (!next || top.score - next.score >= CLEAR_LEAD));
}

/**
 * Builds a matcher over the Shopify products. Words are weighted by how rare they are in the
 * catalogue, so "quercetinol" counts far more than "cream". The brand (first word of the Shopify
 * name) must appear in the listing title, and a different pack size halves the score.
 */
export function createMatcher(products: MatchCandidate[]) {
  // Shopify names read "English name – Polish description"; only the name identifies the product.
  // The pack size may sit in the description, so it is read from the full name.
  const entries = products.map((p) => ({ id: p.id, words: normalizeTitle(p.name.split(' – ')[0]).words, sizes: normalizeTitle(p.name).sizes }));
  const df = new Map<string, number>();
  for (const e of entries) for (const w of e.words) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log(1 + entries.length / (df.get(w) ?? entries.length));
  const total = (words: string[]) => words.reduce((sum, w) => sum + (df.has(w) ? weight(w) : 0), 0);
  const productWeight = new Map(entries.map((e) => [e.id, total(e.words)]));

  return function suggest(title: string, limit = 3): MatchSuggestion[] {
    const listing = normalizeTitle(title);
    const listingWords = new Set(listing.words);
    const listingWeight = total(listing.words);
    const out: MatchSuggestion[] = [];
    for (const e of entries) {
      const brand = e.words[0];
      // "Haru Haru" in a listing still matches the brand "HaruHaru".
      if (!brand || !(listingWords.has(brand) || (brand.length >= 4 && listing.condensed.includes(brand)))) continue;
      const shared = total(e.words.filter((w) => listingWords.has(w)));
      const ofProduct = shared / (productWeight.get(e.id) || 1);
      const ofListing = shared / (listingWeight || 1);
      let score = 0.7 * ofProduct + 0.3 * ofListing;
      if (sizesConflict(listing.sizes, e.sizes)) score *= 0.5;
      if (score > 0) out.push({ productId: e.id, score: Math.round(score * 100) / 100 });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  };
}

/** Both titles name a size in the same unit, and no size is shared. */
function sizesConflict(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (a.some((s) => b.includes(s))) return false;
  const unit = (s: string) => s.replace(/^[\d.]+/, '');
  return a.some((x) => b.some((y) => unit(x) === unit(y)));
}
