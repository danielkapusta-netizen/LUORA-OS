import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMarketplaceSource, rationaleParts, recommendationNeedsRefresh, researchImportSchema } from '@/lib/pricing-research';
import { authorizeResearch, readResearchBody } from '@/server/pricing-research-api';

const item = () => ({
  shopifyVariantId: 'gid://shopify/ProductVariant/123', accountId: 'empik-1', marketplace: 'empik' as const,
  listingId: 'offer-1', status: 'change_price' as const, recommendedPrice: '58.89', observedLuoraPrice: '69.90',
  researchedAt: new Date().toISOString(), rationale: 'Main Empik 62.99 zł; lowest SkinKo 58.90 zł; Luora 69.90 zł. Test if margin permits.',
  sources: [{ label: 'Main Empik', url: 'https://www.empik.com/product,p123,kosmetyki-p' }, { label: 'SkinKo', url: 'https://www.empik.com/product,p123,kosmetyki-p#offers' }],
});
const valid = () => ({ runId: 'daily-2026-10-30', recommendations: [item()] });

afterEach(() => vi.unstubAllEnvs());

describe('research contract', () => {
  it('accepts exact identifiers, a gross PLN proposal and linked evidence', () => {
    expect(researchImportSchema.parse(valid()).recommendations[0].recommendedPrice).toBe('58.89');
  });
  it.each(['0.00', '-1.00', '58,89', '58.899', 'NaN', '100000.00', '058.89'])('refuses invalid proposed price %s', (price) => {
    const input = valid(); input.recommendations[0].recommendedPrice = price;
    expect(researchImportSchema.safeParse(input).success).toBe(false);
  });
  it('requires evidence, an observed price and an exact offer for an actionable price', () => {
    for (const patch of [{ sources: [] }, { observedLuoraPrice: null }, { listingId: null }, { recommendedPrice: null }]) {
      expect(researchImportSchema.safeParse({ ...valid(), recommendations: [{ ...item(), ...patch }] }).success).toBe(false);
    }
  });
  it('represents failed checks and missing listings without inventing a price', () => {
    for (const status of ['needs_review', 'add_listing', 'fix_placement', 'keep_price']) {
      const r = { ...item(), status, listingId: null, recommendedPrice: null, observedLuoraPrice: null, sources: [] };
      expect(researchImportSchema.safeParse({ ...valid(), recommendations: [r] }).success).toBe(true);
      expect(researchImportSchema.safeParse({ ...valid(), recommendations: [{ ...r, recommendedPrice: '58.89' }] }).success).toBe(false);
    }
  });
  it('refuses duplicates, unknown fields, future dates and oversized batches', () => {
    expect(researchImportSchema.safeParse({ ...valid(), recommendations: [item(), item()] }).success).toBe(false);
    expect(researchImportSchema.safeParse({ ...valid(), publishPrices: true }).success).toBe(false);
    expect(researchImportSchema.safeParse({ ...valid(), recommendations: [{ ...item(), researchedAt: new Date(Date.now() + 3600_000).toISOString() }] }).success).toBe(false);
    expect(researchImportSchema.safeParse({ ...valid(), recommendations: Array.from({ length: 101 }, (_, i) => ({ ...item(), shopifyVariantId: String(i) })) }).success).toBe(false);
  });
  it.each(['javascript:alert(1)', 'http://empik.com/p1', 'https://empik.com.evil.test/p1', 'https://empik.com@evil.test/p1', 'https://allegro.pl/p1', 'https://user:password@empik.pl/p1'])('refuses unsafe or unrelated evidence %s', (url) => {
    expect(isMarketplaceSource(url, 'empik')).toBe(false);
    expect(researchImportSchema.safeParse({ ...valid(), recommendations: [{ ...item(), sources: [{ label: 'Seller', url }] }] }).success).toBe(false);
  });
  it('links source names as text, preserving punctuation and refusing to interpret HTML', () => {
    const sources = item().sources;
    expect(rationaleParts('Main Empik 62.99 zł; lowest SkinKo 58.90 zł.', sources)).toEqual([
      { text: 'Main Empik', url: sources[0].url }, { text: ' 62.99 zł; lowest ' }, { text: 'SkinKo', url: sources[1].url }, { text: ' 58.90 zł.' },
    ]);
    expect(rationaleParts('<script>alert(1)</script>', sources)).toEqual([{ text: '<script>alert(1)</script>' }]);
  });
  it('marks old research and price changes for a recheck', () => {
    const now = Date.now();
    expect(recommendationNeedsRefresh(new Date(now), '69.90', '69.9', now)).toBe(false);
    expect(recommendationNeedsRefresh(new Date(now), '69.90', '65.90', now)).toBe(true);
    expect(recommendationNeedsRefresh(new Date(now), '69.90', null, now)).toBe(true);
    expect(recommendationNeedsRefresh(new Date(now - 49 * 3600_000), '69.90', '69.90', now)).toBe(true);
  });
});

describe('scoped research authentication and request limits', () => {
  const token = 'test-only-research-token-with-more-than-32-characters';
  const request = (auth?: string) => new Request('https://luora.example/api/pricing/recommendations', { headers: auth ? { Authorization: auth } : {} });
  it('is disabled until a sufficiently long separate token is configured', () => {
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', '');
    expect(authorizeResearch(request())?.status).toBe(503);
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', 'short');
    expect(authorizeResearch(request('Bearer short'))?.status).toBe(503);
  });
  it('requires the bearer token and keeps responses out of caches', () => {
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', token);
    for (const auth of [undefined, token, 'Bearer wrong']) {
      const denied = authorizeResearch(request(auth));
      expect(denied?.status).toBe(401);
      expect(denied?.headers.get('cache-control')).toBe('no-store');
    }
    expect(authorizeResearch(request(`Bearer ${token}`))).toBeNull();
  });
  it('accepts JSON and rejects bad content types or broken JSON', async () => {
    const req = (body: string, type = 'application/json') => new Request('https://luora.example', { method: 'POST', headers: { 'Content-Type': type }, body });
    const payload = valid();
    expect(await readResearchBody(req(JSON.stringify(payload)))).toEqual(payload);
    await expect(readResearchBody(req('{}', 'text/plain'))).rejects.toMatchObject({ status: 415 });
    await expect(readResearchBody(req('{'))).rejects.toMatchObject({ status: 400 });
  });
  it('bounds the actual body even without Content-Length', async () => {
    const req = new Request('https://luora.example', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(512 * 1024 + 1) });
    await expect(readResearchBody(req)).rejects.toMatchObject({ status: 413 });
  });
});
