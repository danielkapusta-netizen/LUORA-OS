import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECOMMENDATION_STATUSES, RESEARCH_MARKETPLACES, researchImportSchema } from '@/lib/pricing-research';

// The Custom GPT is told the API's shape by docs/custom-gpt/openapi.json; this keeps it in step with the validation.
const spec = JSON.parse(readFileSync('docs/custom-gpt/openapi.json', 'utf8'));
const importBody = spec.paths['/api/pricing/recommendations'].post.requestBody.content['application/json'].schema;
const record = importBody.properties.recommendations.items;

describe('Custom GPT OpenAPI file', () => {
  it('describes both endpoints with bearer auth', () => {
    expect(Object.keys(spec.paths)).toEqual(['/api/pricing/recommendations/catalog', '/api/pricing/recommendations']);
    expect(spec.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' });
    expect(spec.paths['/api/pricing/recommendations/catalog'].get.operationId).toBe('getCatalog');
    expect(spec.paths['/api/pricing/recommendations'].post.operationId).toBe('importRecommendations');
  });

  it('lists the same statuses, marketplaces and limits as the import validation', () => {
    expect(record.properties.status.enum).toEqual([...RECOMMENDATION_STATUSES]);
    expect(record.properties.marketplace.enum).toEqual([...RESEARCH_MARKETPLACES]);
    expect(importBody.properties.recommendations.minItems).toBe(1);
    expect(importBody.properties.recommendations.maxItems).toBe(100);
    expect(record.properties.sources.maxItems).toBe(10);
    expect(record.properties.rationale.maxLength).toBe(3000);
    const required = new Set(Object.keys(record.properties));
    expect(new Set(record.required)).toEqual(required);
    // Prices: the pattern in the file is the one the server enforces.
    const pattern = new RegExp(record.properties.recommendedPrice.oneOf[0].pattern);
    expect(pattern.test('58.89')).toBe(true);
    expect(pattern.test('58.9')).toBe(false);
    expect(pattern.test('123456.00')).toBe(false);
  });

  it('describes a payload the server accepts, and the server rejects one the file would not allow', () => {
    const ok = {
      runId: 'luora-research-2026-11-16',
      recommendations: [
        {
          shopifyVariantId: 'gid://shopify/ProductVariant/123',
          accountId: 'acc',
          marketplace: 'empik',
          listingId: 'listing',
          status: 'change_price',
          recommendedPrice: '58.89',
          observedLuoraPrice: '69.90',
          researchedAt: '2026-11-16T09:14:00+01:00',
          rationale: 'Main Empik 62.99; lowest SkinKo 58.90; Luora 69.90.',
          sources: [{ label: 'Main Empik', url: 'https://www.empik.com/example,p123,kosmetyki-p' }],
        },
        { ...{ shopifyVariantId: 'gid://shopify/ProductVariant/124', accountId: 'acc', marketplace: 'empik' }, listingId: null, status: 'needs_review', recommendedPrice: null, observedLuoraPrice: null, researchedAt: '2026-11-16T09:20:00+01:00', rationale: 'Page blocked twice.', sources: [] },
      ],
    };
    expect(researchImportSchema.safeParse(ok).success).toBe(true);
    // Every field the server accepts is in the file, and the other way round.
    expect(Object.keys(ok.recommendations[0]).sort()).toEqual(Object.keys(record.properties).sort());
    // A proposal with no evidence, and an extra field, are refused by the server as the file says.
    expect(researchImportSchema.safeParse({ ...ok, recommendations: [{ ...ok.recommendations[0], sources: [] }] }).success).toBe(false);
    expect(researchImportSchema.safeParse({ ...ok, recommendations: [{ ...ok.recommendations[0], note: 'x' }] }).success).toBe(false);
  });
});
