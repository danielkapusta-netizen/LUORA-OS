import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), catalog: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/server/services/pricing-research', () => ({
  importPricingResearch: mocks.save, researchCatalog: mocks.catalog, ResearchInputError: class extends Error {},
}));
import { POST } from '@/app/api/pricing/recommendations/route';
import { GET } from '@/app/api/pricing/recommendations/catalog/route';
import { ResearchInputError } from '@/server/services/pricing-research';

const token = 'test-only-token-at-least-thirty-two-characters';
const post = (body = '{}', auth = token, type = 'application/json') => new Request('https://luora.example/api/pricing/recommendations', {
  method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': type }, body,
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('research routes', () => {
  it('rejects unauthenticated reads and writes before touching storage', async () => {
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', token);
    expect((await POST(post('{}', 'wrong'))).status).toBe(401);
    expect((await GET(new Request('https://luora.example/api/pricing/recommendations/catalog'))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it('returns validation failures without revalidating the pricing page', async () => {
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', token);
    mocks.save.mockRejectedValue(new ResearchInputError('Unknown Shopify variant'));
    expect((await POST(post())).status).toBe(422);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect((await POST(post('{'))).status).toBe(400);
    expect((await POST(post('{}', token, 'text/plain'))).status).toBe(415);
  });
  it('refreshes pricing after successful new research and returns counters', async () => {
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', token);
    const result = { received: 1, applied: 1, ignoredOlderOrEqual: 0 };
    mocks.save.mockResolvedValue(result);
    const response = await POST(post());
    expect(await response.json()).toEqual(result);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.revalidate).toHaveBeenCalledWith('/pricing');
  });
  it('passes catalog pagination through and does not cache authenticated results', async () => {
    vi.stubEnv('PRICING_RESEARCH_API_TOKEN', token);
    mocks.catalog.mockResolvedValue({ accounts: [], products: [], nextCursor: null });
    const response = await GET(new Request('https://luora.example/api/pricing/recommendations/catalog?after=product-50', { headers: { Authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.catalog).toHaveBeenCalledWith('product-50');
  });
});
