import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, insertMany } from '@/server/db/client';
import { marketplaceAccounts, pricingRecommendations, productListings, products, users } from '@/server/db/schema';
import { handleMcpRequest, type McpCaller } from '@/server/mcp/handler';

// Decoded JSON from the wire: its shape is what each test asserts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const APP = 'https://luora.test';

describe('pricing MCP tools (D1)', () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-mcp-'));
  let dispose: (() => Promise<void>) | undefined;
  let accountId: string;
  let marketingUser: string;
  let logisticsUser: string;
  let firstListingId: string;
  const variant = (n: number) => `gid://shopify/ProductVariant/${1000 + n}`;
  const caller = (over: Partial<McpCaller> = {}): McpCaller => ({
    clientId: 'test-client', userId: marketingUser, scopes: ['pricing:read', 'pricing:write'], audience: `${APP}/mcp`, expiresAt: Math.floor(Date.now() / 1000) + 3600, ...over,
  });
  const record = (over: Record<string, unknown> = {}, time = Date.now() - 60_000) => ({
    shopifyVariantId: variant(0), accountId, marketplace: 'empik', listingId: firstListingId, status: 'change_price',
    recommendedPrice: '58.89', observedLuoraPrice: '69.90', researchedAt: new Date(time).toISOString(),
    rationale: 'Main Empik 62.99 zł; lowest SkinKo 58.90 zł; Luora 69.90 zł.',
    sources: [{ label: 'Main Empik', url: 'https://www.empik.com/product,p1,kosmetyki-p' }], ...over,
  });

  /** A request as the Worker receives it: with the Host header the platform adds. */
  const asIncoming = (request: Request) => { request.headers.set('host', new URL(APP).host); return request; };

  /** An SDK client whose network is the handler itself, so initialize, discovery and calls are real MCP traffic. */
  async function connect(over: Partial<McpCaller> = {}) {
    const fetchLike = (input: string | URL | Request, init?: RequestInit) => handleMcpRequest(asIncoming(new Request(input, init)), APP, caller(over));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${APP}/mcp`), { fetch: fetchLike as typeof fetch }));
    return client;
  }
  /** One raw JSON-RPC call, for the status codes the SDK client hides. */
  async function rpc(method: string, params: unknown, over: Partial<McpCaller> = {}, headers: Record<string, string> = {}) {
    const response = await handleMcpRequest(
      asIncoming(new Request(`${APP}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })),
      APP, caller(over),
    );
    const text = await response.text();
    const data = text.startsWith('event:') || text.includes('\ndata:') || text.startsWith('data:') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() : text;
    let json: Json | null = null;
    try { json = data ? JSON.parse(data) : null; } catch { /* not JSON */ }
    return { status: response.status, json, text };
  }
  const saved = () => getDb().select().from(pricingRecommendations);

  beforeAll(async () => {
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo }); dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    const db = getDb();
    [accountId] = (await db.insert(marketplaceAccounts).values([{ type: 'empik', name: 'Luora', credentials: 'do-not-expose' }]).returning({ id: marketplaceAccounts.id })).map((a) => a.id);
    // 120 products: three pages of the catalogue.
    // D1 allows 100 bound values per statement, so seed in small batches.
    for (let start = 0; start < 120; start += 8) {
      const inserted = await db.insert(products).values(Array.from({ length: 8 }, (_, i) => ({ sku: `sku-${start + i}`, name: `Product ${start + i}`, shopifyVariantId: variant(start + i), ean: `590000000${start + i}` }))).returning({ id: products.id, sku: products.sku });
      await insertMany(db, productListings, inserted.map((p) => ({ productId: p.id, accountId, externalId: `offer-${p.sku}`, title: p.sku, price: '69.90', currency: 'PLN' })));
    }
    const [first] = await db.select({ id: productListings.id }).from(productListings).innerJoin(products, eq(products.id, productListings.productId)).where(eq(products.shopifyVariantId, variant(0)));
    firstListingId = first.id;
    [marketingUser, logisticsUser] = (await db.insert(users).values([
      { email: 'marketing@example.test', name: 'Mia', passwordHash: 'x', role: 'marketing' },
      { email: 'logistics@example.test', name: 'Leo', passwordHash: 'x', role: 'logistics' },
    ]).returning({ id: users.id })).map((u) => u.id);
  }, 120_000);
  afterAll(async () => { await dispose?.(); rmSync(persistTo, { recursive: true, force: true }); });

  it('initializes and lists exactly two narrowly scoped tools with accurate annotations and schemas', async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe('luora-os-pricing');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_pricing_catalog', 'import_pricing_recommendations']);
    const catalog = tools.find((t) => t.name === 'get_pricing_catalog')!;
    const importer = tools.find((t) => t.name === 'import_pricing_recommendations')!;
    expect(catalog.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(importer.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(catalog.inputSchema.properties).toHaveProperty('after');
    expect(importer.inputSchema.properties).toHaveProperty('runId');
    expect(importer.inputSchema.properties).toHaveProperty('recommendations');
    expect(catalog.outputSchema).toBeTruthy();
    await client.close();
  });

  it('pages through the catalogue with the existing cursor and exposes no credentials', async () => {
    const client = await connect();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const result = await client.callTool({ name: 'get_pricing_catalog', arguments: cursor ? { after: cursor } : {} });
      expect(result.isError).toBeFalsy();
      const page = result.structuredContent as { accounts: { id: string }[]; products: { id: string; listings: unknown[] }[]; nextCursor: string | null };
      expect(page.accounts).toEqual([{ id: accountId, marketplace: 'empik', name: 'Luora' }]);
      expect(page.products.length).toBeLessThanOrEqual(50);
      seen.push(...page.products.map((p) => p.id));
      expect(JSON.stringify(result)).not.toContain('do-not-expose');
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(120);
    await client.close();
  });

  it('imports a verified recommendation without touching any marketplace price or account', async () => {
    const before = { listings: await getDb().select().from(productListings), accounts: await getDb().select().from(marketplaceAccounts) };
    const client = await connect();
    const result = await client.callTool({ name: 'import_pricing_recommendations', arguments: { runId: 'mcp-run-1', recommendations: [record()] } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ received: 1, applied: 1, ignoredOlderOrEqual: 0 });
    expect(await saved()).toHaveLength(1);
    expect(await getDb().select().from(productListings)).toEqual(before.listings);
    expect(await getDb().select().from(marketplaceAccounts)).toEqual(before.accounts);
    await client.close();
  });

  it('ignores equal or older observations and lets only a strictly newer one replace the stored research', async () => {
    const client = await connect();
    const t = Date.now() - 60_000; // the time used by the first import
    const send = async (over: Record<string, unknown>, time: number) =>
      (await client.callTool({ name: 'import_pricing_recommendations', arguments: { runId: 'mcp-run-x', recommendations: [record(over, time)] } })).structuredContent as { applied: number };
    expect((await send({ recommendedPrice: '1.00' }, t - 5_000)).applied).toBe(0);
    const [row] = await saved();
    expect((await send({ recommendedPrice: '2.00' }, row.researchedAt.getTime())).applied).toBe(0);
    expect((await send({ recommendedPrice: '58.79' }, row.researchedAt.getTime() + 1_000)).applied).toBe(1);
    expect((await saved())[0]).toMatchObject({ recommendedPrice: '58.79' });
    await client.close();
  });

  it('rejects an invalid batch as a tool error and saves none of it', async () => {
    const client = await connect();
    const before = await saved();
    const bad = await client.callTool({ name: 'import_pricing_recommendations', arguments: { runId: 'bad', recommendations: [record({ shopifyVariantId: variant(5) }, Date.now() - 30_000), record({ recommendedPrice: '58,89' })] } });
    expect(bad.isError).toBe(true);
    // A valid first record next to an unknown variant: the whole batch must be refused, the valid one included.
    const validNeedsReview = record({ shopifyVariantId: variant(6), listingId: null, status: 'needs_review', recommendedPrice: null, observedLuoraPrice: null, sources: [] }, Date.now() - 30_000);
    const unknown = await client.callTool({ name: 'import_pricing_recommendations', arguments: { runId: 'unknown', recommendations: [validNeedsReview, record({ shopifyVariantId: 'gid://shopify/ProductVariant/9', listingId: null, status: 'needs_review', recommendedPrice: null, observedLuoraPrice: null, sources: [] })] } });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown.content)).toContain('Unknown Shopify variant');
    expect(await saved()).toEqual(before);
    await client.close();
  });

  it('refuses a read-only token on the import tool and writes nothing', async () => {
    const before = await saved();
    const { status, json } = await rpc('tools/call', { name: 'import_pricing_recommendations', arguments: { runId: 'ro', recommendations: [record({}, Date.now() - 10_000)] } }, { scopes: ['pricing:read'] });
    expect(status === 403 || json?.result?.isError === true).toBe(true);
    expect(await saved()).toEqual(before);
    // and the read tool still works with the read scope alone
    const read = await rpc('tools/call', { name: 'get_pricing_catalog', arguments: {} }, { scopes: ['pricing:read'] });
    expect(read.status).toBe(200);
    expect(read.json?.result?.isError).toBeFalsy();
  });

  it('checks the person\'s current role on every call', async () => {
    const asLogistics = await rpc('tools/call', { name: 'get_pricing_catalog', arguments: {} }, { userId: logisticsUser });
    expect(asLogistics.json?.result?.isError).toBe(true);
    expect(JSON.stringify(asLogistics.json?.result?.content)).toContain('no longer has access');
    const unknown = await rpc('tools/call', { name: 'get_pricing_catalog', arguments: {} }, { userId: 'deleted-user' });
    expect(unknown.json?.result?.isError).toBe(true);
    // demoting the person cuts access at once, with the same token
    await getDb().update(users).set({ role: 'logistics' }).where(eq(users.id, marketingUser));
    expect((await rpc('tools/call', { name: 'get_pricing_catalog', arguments: {} })).json?.result?.isError).toBe(true);
    await getDb().update(users).set({ role: 'marketing' }).where(eq(users.id, marketingUser));
    expect((await rpc('tools/call', { name: 'get_pricing_catalog', arguments: {} })).json?.result?.isError).toBeFalsy();
  });

  it('refuses a batch over 512 KiB and a request from another origin', async () => {
    const big = Array.from({ length: 27 }, (_, i) => record({ shopifyVariantId: variant(20 + i), sources: Array.from({ length: 10 }, (_, k) => ({ label: `S${k}`, url: `https://www.empik.com/${'a'.repeat(1990)}` })) }, Date.now() - 20_000));
    const before = await saved();
    const oversized = await rpc('tools/call', { name: 'import_pricing_recommendations', arguments: { runId: 'big', recommendations: big } });
    expect(oversized.status === 413 || oversized.json?.result?.isError === true).toBe(true);
    expect(await saved()).toEqual(before);
    const foreign = await rpc('tools/list', {}, {}, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('answers GET with 405 (stateless endpoint, no standalone stream)', async () => {
    const response = await handleMcpRequest(asIncoming(new Request(`${APP}/mcp`, { method: 'GET', headers: { accept: 'text/event-stream' } })), APP, caller());
    expect(response.status).toBe(405);
  });

  it('keeps the MCP layer free of marketplace adapters, orders and customers', () => {
    const dir = path.join(process.cwd(), 'src/server/mcp');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const imports = (readFileSync(path.join(dir, file), 'utf8').match(/from '[^']+'/g) ?? []).join('\n');
      expect(imports, file).not.toMatch(/integrations|services\/(orders|customers|shipping|pricing'|inventory)|marketplaces/);
    }
  });
});
