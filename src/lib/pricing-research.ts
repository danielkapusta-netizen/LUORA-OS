import { z } from 'zod';
import { msg } from './i18n/msg';
import { parsePrice, samePrice } from './price';

export const RESEARCH_MARKETPLACES = ['allegro', 'empik', 'hebe'] as const;
export type ResearchMarketplace = (typeof RESEARCH_MARKETPLACES)[number];
export const RECOMMENDATION_STATUSES = ['change_price', 'keep_price', 'fix_placement', 'add_listing', 'needs_review'] as const;
export const RECOMMENDATION_LABELS = {
  change_price: msg('Test proposed price'),
  keep_price: msg('Keep current price'),
  fix_placement: msg('Check seller placement'),
  add_listing: msg('Add listing'),
  needs_review: msg('Needs verification'),
} as const;

export function isResearchMarketplace(value: string): value is ResearchMarketplace {
  return (RESEARCH_MARKETPLACES as readonly string[]).includes(value);
}

const price = z.string().regex(/^\d{1,5}\.\d{2}$/).refine((v) => parsePrice(v) === v, 'Use a positive PLN amount with two decimals');
const source = z.strictObject({
  label: z.string().trim().min(1).max(120),
  url: z.url().max(2000),
});
export type ResearchSource = z.infer<typeof source>;

/** Only evidence on the marketplace being researched is linked from the pricing screen. */
export function isMarketplaceSource(url: string, marketplace: ResearchMarketplace): boolean {
  try {
    const parsed = new URL(url);
    const hosts = marketplace === 'empik' ? ['empik.com', 'empik.pl'] : [`${marketplace}.pl`];
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
      && hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

const recommendation = z.strictObject({
  shopifyVariantId: z.string().trim().min(1).max(150),
  accountId: z.string().trim().min(1).max(100),
  marketplace: z.enum(RESEARCH_MARKETPLACES),
  listingId: z.string().trim().min(1).max(100).nullable(),
  status: z.enum(RECOMMENDATION_STATUSES),
  recommendedPrice: price.nullable(),
  observedLuoraPrice: price.nullable(),
  researchedAt: z.iso.datetime({ offset: true }).refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60_000, 'Research time cannot be in the future'),
  rationale: z.string().trim().min(1).max(3000),
  sources: z.array(source).max(10),
}).superRefine((v, ctx) => {
  if (v.status === 'change_price' && (!v.recommendedPrice || !v.observedLuoraPrice || !v.listingId || v.sources.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'A price proposal needs a listing, observed Luora price, proposed price and evidence' });
  }
  if (v.status !== 'change_price' && v.recommendedPrice !== null) {
    ctx.addIssue({ code: 'custom', path: ['recommendedPrice'], message: 'Only change_price has a proposed price' });
  }
  if (v.status === 'add_listing' && v.listingId !== null) {
    ctx.addIssue({ code: 'custom', path: ['listingId'], message: 'An existing offer needs placement or activation review, not add_listing' });
  }
  for (const [i, link] of v.sources.entries()) {
    if (!isMarketplaceSource(link.url, v.marketplace)) ctx.addIssue({ code: 'custom', path: ['sources', i, 'url'], message: 'Use an HTTPS link to this marketplace' });
  }
});

export const researchImportSchema = z.strictObject({
  runId: z.string().trim().min(1).max(100),
  recommendations: z.array(recommendation).min(1).max(100),
}).superRefine((v, ctx) => {
  const keys = new Set<string>();
  for (const [i, item] of v.recommendations.entries()) {
    const key = JSON.stringify([item.shopifyVariantId, item.accountId]);
    if (keys.has(key)) ctx.addIssue({ code: 'custom', path: ['recommendations', i], message: 'Duplicate product/account recommendation' });
    keys.add(key);
  }
});
export type ResearchImport = z.infer<typeof researchImportSchema>;

/** Old research remains readable, but must be checked again before copying a price. */
export function recommendationNeedsRefresh(researchedAt: Date, observed: string | null, current: string | null, now = Date.now()): boolean {
  return now - researchedAt.getTime() > 48 * 60 * 60_000 || !samePrice(observed, current);
}

/** Link source labels inside the rationale without accepting HTML or executable Markdown. */
export function rationaleParts(text: string, sources: ResearchSource[]): { text: string; url?: string }[] {
  const labels = [...sources].sort((a, b) => b.label.length - a.label.length);
  const result: { text: string; url?: string }[] = [];
  let remaining = text;
  while (remaining) {
    let match: ResearchSource | undefined;
    let at = remaining.length;
    for (const item of labels) {
      const index = remaining.indexOf(item.label);
      if (index >= 0 && index < at) { match = item; at = index; }
    }
    if (!match) { result.push({ text: remaining }); break; }
    if (at) result.push({ text: remaining.slice(0, at) });
    result.push({ text: match.label, url: match.url });
    remaining = remaining.slice(at + match.label.length);
  }
  return result;
}
