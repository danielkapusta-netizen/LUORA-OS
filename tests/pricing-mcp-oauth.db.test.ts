import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { marketplaceAccounts, pricingRecommendations, productListings, products, sessions, users } from '@/server/db/schema';
import { withMcp, type WorkerEnv } from '@/server/mcp/oauth-app';

// The real OAuth layer (Cloudflare's OAuth library with simulated KV) in front of the real MCP handler, driven the way
// ChatGPT drives it: discovery, registration, sign-in and consent, code + PKCE, refresh, revocation. Dummy values only.

// Decoded JSON from the wire: its shape is what each test asserts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const APP = 'https://luora.test';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const RESOURCE = `${APP}/mcp`;

describe('pricing MCP behind OAuth', () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-mcp-oauth-'));
  let dispose: (() => Promise<void>) | undefined;
  let env: WorkerEnv;
  let appCalls = 0;
  let accountId: string;
  let listingId: string;
  const worker = withMcp(async () => { appCalls++; return new Response('the app', { status: 200, headers: { 'x-app': '1' } }); });
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

  const incoming = (request: Request) => { request.headers.set('host', new URL(APP).host); return request; };
  const call = (request: Request, over: Partial<WorkerEnv> = {}) => worker(incoming(request), { ...env, ...over } as WorkerEnv, ctx);
  const get = (pathAndQuery: string, headers: Record<string, string> = {}) => call(new Request(`${APP}${pathAndQuery}`, { headers }));
  const post = (pathName: string, body: BodyInit, headers: Record<string, string>) => call(new Request(`${APP}${pathName}`, { method: 'POST', body, headers }));
  const form = (data: Record<string, string | string[]>) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
    return body;
  };

  async function signIn(role: 'marketing' | 'logistics', email: string) {
    const [user] = await getDb().insert(users).values({ email, name: role === 'marketing' ? 'Mia' : 'Leo', passwordHash: 'x', role }).returning({ id: users.id });
    const token = randomBytes(24).toString('hex');
    await getDb().insert(sessions).values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
    return { userId: user.id, cookie: `luora_session=${token}` };
  }
  async function registerClient() {
    const response = await post('/oauth/register', JSON.stringify({ client_name: 'ChatGPT test', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }), { 'content-type': 'application/json' });
    expect(response.status).toBe(201);
    return ((await response.json()) as { client_id: string }).client_id;
  }
  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };
  const authorizeUrl = (clientId: string, challenge: string, extra: Record<string, string> = {}) =>
    `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'state-1', scope: 'pricing:read pricing:write', resource: RESOURCE, ...extra })}`;

  /** Signs in, approves the consent screen and returns the authorization code. */
  async function authorize(session: { cookie: string }, clientId: string, challenge: string, scopes = ['pricing:read', 'pricing:write'], extra: Record<string, string> = {}) {
    const page = await get(authorizeUrl(clientId, challenge, extra), { cookie: session.cookie });
    expect(page.status).toBe(200);
    // Framing is forbidden, and no form-action: approving redirects to the client, which Chrome would block under it.
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('content-security-policy')).not.toContain('form-action');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    const html = await page.text();
    const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
    const bindingCookies = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const done = await post(authorizeUrl(clientId, challenge, extra), form({ handle, decision: 'approve', scope: scopes }), {
      'content-type': 'application/x-www-form-urlencoded', cookie: `${session.cookie}; ${bindingCookies}`,
    });
    expect(done.status).toBe(302);
    const location = new URL(done.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('state-1');
    expect(location.searchParams.get('iss')).toBe(APP);
    return location.searchParams.get('code')!;
  }
  async function exchange(clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) {
    const response = await post('/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE, ...extra }), { 'content-type': 'application/x-www-form-urlencoded' });
    return { status: response.status, body: (await response.json()) as Json };
  }
  async function refresh(clientId: string, refreshToken: string) {
    const response = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: RESOURCE }), { 'content-type': 'application/x-www-form-urlencoded' });
    return { status: response.status, body: (await response.json()) as Json };
  }
  async function tokens(session: { cookie: string }, scopes?: string[]) {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(session, clientId, challenge, scopes);
    const result = await exchange(clientId, code, verifier);
    expect(result.status).toBe(200);
    return { clientId, ...(result.body as { access_token: string; refresh_token: string; expires_in: number; scope: string }) };
  }
  async function mcpClient(accessToken: string) {
    const fetchLike = (input: string | URL | Request, init?: RequestInit) => call(new Request(input, init));
    const client = new Client({ name: 'chatgpt-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), { fetch: fetchLike as typeof fetch, requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }));
    return client;
  }
  const rawRpc = (accessToken: string | null, method: string, params: unknown = {}) =>
    post('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) });
  const record = () => ({
    shopifyVariantId: 'gid://shopify/ProductVariant/555', accountId, marketplace: 'empik', listingId, status: 'change_price', recommendedPrice: '58.89', observedLuoraPrice: '69.90',
    researchedAt: new Date(Date.now() - 60_000).toISOString(), rationale: 'Main Empik 62.99 zł; Luora 69.90 zł.', sources: [{ label: 'Main Empik', url: 'https://www.empik.com/product,p1,kosmetyki-p' }],
  });

  beforeAll(async () => {
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo }); dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    env = { ...bindings.env, APP_URL: APP } as unknown as WorkerEnv;
    expect(env.OAUTH_KV, 'the OAUTH_KV binding must exist in wrangler.jsonc').toBeTruthy();
    const db = getDb();
    [{ id: accountId }] = await db.insert(marketplaceAccounts).values({ type: 'empik', name: 'Luora', credentials: 'do-not-expose' }).returning({ id: marketplaceAccounts.id });
    const [product] = await db.insert(products).values({ sku: 'sku-555', name: 'Serum', shopifyVariantId: 'gid://shopify/ProductVariant/555' }).returning({ id: products.id });
    [{ id: listingId }] = await db.insert(productListings).values({ productId: product.id, accountId, externalId: 'offer-1', title: 'Serum', price: '69.90', currency: 'PLN' }).returning({ id: productListings.id });
  }, 120_000);
  // wrangler.jsonc sets global_fetch_strictly_public, which workerd reports through this global (needed for CIMD).
  beforeEach(() => vi.stubGlobal('Cloudflare', { compatibilityFlags: { global_fetch_strictly_public: true } }));
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { await dispose?.(); rmSync(persistTo, { recursive: true, force: true }); });

  it('publishes the discovery documents ChatGPT needs', async () => {
    const resource = (await (await get('/.well-known/oauth-protected-resource/mcp')).json()) as Json;
    // OpenAI's guide names the bare path; the same document is served there too.
    expect(await (await get('/.well-known/oauth-protected-resource')).json()).toEqual(resource);
    expect(resource.resource).toBe(RESOURCE);
    expect(resource.authorization_servers).toEqual([APP]);
    expect(resource.scopes_supported).toEqual(['pricing:read', 'pricing:write']);
    const server = (await (await get('/.well-known/oauth-authorization-server')).json()) as Json;
    expect(server.issuer).toBe(APP);
    expect(server.authorization_endpoint).toBe(`${APP}/oauth/authorize`);
    expect(server.token_endpoint).toBe(`${APP}/oauth/token`);
    expect(server.registration_endpoint).toBe(`${APP}/oauth/register`);
    expect(server.code_challenge_methods_supported).toEqual(['S256']);
    expect(server.client_id_metadata_document_supported).toBe(true);
    expect(server.authorization_response_iss_parameter_supported).toBe(true);
    expect(server.scopes_supported).toEqual(expect.arrayContaining(['pricing:read', 'pricing:write']));
  });

  it('refuses every MCP request without a valid token, discovery and calls alike, and points at the metadata', async () => {
    for (const [method, params] of [['initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } }], ['tools/list', {}], ['tools/call', { name: 'get_pricing_catalog', arguments: {} }]] as const) {
      for (const token of [null, 'not-a-token']) {
        const response = await rawRpc(token, method, params);
        expect(response.status, `${method} with ${token}`).toBe(401);
        expect(response.headers.get('www-authenticate')).toContain(`resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp"`);
        expect(await response.text()).not.toContain('get_pricing_catalog');
      }
    }
    expect((await get('/mcp')).status).toBe(401);
  });

  it('runs the whole flow: sign in, consent, code + PKCE, then MCP initialize, discovery and both tools', async () => {
    const session = await signIn('marketing', 'mia@example.test');
    const granted = await tokens(session);
    expect(granted.scope.split(' ').sort()).toEqual(['pricing:read', 'pricing:write']);
    expect(granted.expires_in).toBeLessThanOrEqual(3600);
    expect(granted.refresh_token).toBeTruthy();

    const client = await mcpClient(granted.access_token);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['get_pricing_catalog', 'import_pricing_recommendations']);
    const catalog = await client.callTool({ name: 'get_pricing_catalog', arguments: {} });
    expect((catalog.structuredContent as { products: unknown[] }).products).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain('do-not-expose');
    const before = await getDb().select().from(productListings);
    const imported = await client.callTool({ name: 'import_pricing_recommendations', arguments: { runId: 'oauth-run', recommendations: [record()] } });
    expect(imported.structuredContent).toEqual({ received: 1, applied: 1, ignoredOlderOrEqual: 0 });
    expect(await getDb().select().from(pricingRecommendations).where(eq(pricingRecommendations.runId, 'oauth-run'))).toHaveLength(1);
    expect(await getDb().select().from(productListings)).toEqual(before); // no price touched
    await client.close();
  });

  it('rotates refresh tokens: a newer one works, and an old one stops working once its replacement was used', async () => {
    const session = await signIn('marketing', 'rot@example.test');
    const first = await tokens(session);
    const second = await refresh(first.clientId, first.refresh_token);
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    const third = await refresh(first.clientId, second.body.refresh_token);
    expect(third.status).toBe(200);
    expect((await refresh(first.clientId, first.refresh_token)).status).toBe(400); // the first token is spent
    // a refreshed access token works against /mcp
    expect((await rawRpc(third.body.access_token, 'tools/list')).status).toBe(200);
  });

  it('gives a read-only grant no import access', async () => {
    const session = await signIn('marketing', 'ro@example.test');
    const granted = await tokens(session, ['pricing:read']);
    expect(granted.scope).toBe('pricing:read');
    const before = await getDb().select().from(pricingRecommendations);
    const response = await rawRpc(granted.access_token, 'tools/call', { name: 'import_pricing_recommendations', arguments: { runId: 'ro-run', recommendations: [{ ...record(), researchedAt: new Date(Date.now() - 1000).toISOString() }] } });
    const text = await response.text();
    expect(response.status === 403 || text.includes('"isError":true')).toBe(true);
    expect(await getDb().select().from(pricingRecommendations)).toEqual(before);
    expect((await rawRpc(granted.access_token, 'tools/call', { name: 'get_pricing_catalog', arguments: {} })).status).toBe(200);
  });

  it('keeps people out of the consent screen unless they are signed in and allowed to use pricing', async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const signedOut = await get(authorizeUrl(clientId, challenge));
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get('location')).toMatch(/^\/login\?next=%2Foauth%2Fauthorize/);
    const logistics = await signIn('logistics', 'leo@example.test');
    const refused = await get(authorizeUrl(clientId, challenge), { cookie: logistics.cookie });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('location')).toBeNull();
    expect(await refused.text()).not.toContain('name="handle"');
  });

  it('refuses a request for a different resource and a client that was never registered', async () => {
    const session = await signIn('marketing', 'res@example.test');
    const clientId = await registerClient();
    const { challenge } = pkce();
    const wrongResource = await get(authorizeUrl(clientId, challenge, { resource: 'https://evil.example/mcp' }), { cookie: session.cookie });
    expect(wrongResource.status).not.toBe(200);
    const unknown = await get(authorizeUrl('no-such-client', challenge), { cookie: session.cookie });
    expect(unknown.status).not.toBe(200);
    expect(unknown.headers.get('location') ?? '').not.toContain('code=');
  });

  it('rejects a code exchange with the wrong PKCE verifier or a different resource, and a code cannot be reused', async () => {
    const session = await signIn('marketing', 'pk@example.test');
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(session, clientId, challenge);
    expect((await exchange(clientId, code, 'x'.repeat(43))).status).toBe(400);
    const other = pkce();
    const code2 = await authorize(session, clientId, other.challenge);
    expect((await exchange(clientId, code2, other.verifier, { resource: 'https://evil.example/mcp' })).status).toBe(400);
    const code3 = await authorize(session, clientId, challenge);
    expect((await exchange(clientId, code3, verifier)).status).toBe(200);
    expect((await exchange(clientId, code3, verifier)).status).toBe(400);
  });

  it('accepts a client that publishes a metadata document (CIMD), which ChatGPT prefers', async () => {
    const clientId = 'https://chatgpt.example/oauth/client.json';
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input) === clientId) {
        return Response.json({ client_id: clientId, client_name: 'ChatGPT', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
      }
      return original(input, init);
    });
    const session = await signIn('marketing', 'cimd@example.test');
    const { verifier, challenge } = pkce();
    const page = await get(authorizeUrl(clientId, challenge), { cookie: session.cookie });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('chatgpt.example'); // the verified domain is shown to the person
    const code = await authorize(session, clientId, challenge);
    expect((await exchange(clientId, code, verifier)).status).toBe(200);
  });

  it('lets a person disconnect an app, which ends both its access and refresh tokens', async () => {
    const session = await signIn('marketing', 'rev@example.test');
    const granted = await tokens(session);
    expect((await rawRpc(granted.access_token, 'tools/list')).status).toBe(200);

    const page = await get('/oauth/connections', { cookie: session.cookie });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(granted.clientId);
    const grantId = /name="grantId" value="([^"]+)"/.exec(html)![1];

    // another person cannot disconnect it
    const intruder = await signIn('marketing', 'intruder@example.test');
    await post('/oauth/connections', form({ grantId }), { 'content-type': 'application/x-www-form-urlencoded', cookie: intruder.cookie });
    expect((await rawRpc(granted.access_token, 'tools/list')).status).toBe(200);
    // a request from another origin is refused
    expect((await post('/oauth/connections', form({ grantId }), { 'content-type': 'application/x-www-form-urlencoded', cookie: session.cookie, origin: 'https://evil.example' })).status).toBe(403);

    const revoked = await post('/oauth/connections', form({ grantId }), { 'content-type': 'application/x-www-form-urlencoded', cookie: session.cookie });
    expect(revoked.status).toBe(303);
    expect((await rawRpc(granted.access_token, 'tools/list')).status).toBe(401);
    expect((await refresh(granted.clientId, granted.refresh_token)).status).toBe(400);
  });

  it('leaves the rest of the app untouched, and keeps /mcp closed if the deployment has no KV namespace', async () => {
    const before = appCalls;
    const page = await get('/orders');
    expect(page.headers.get('x-app')).toBe('1');
    expect(appCalls).toBe(before + 1);
    const noKv = await call(new Request(`${APP}/mcp`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), { OAUTH_KV: undefined });
    expect(noKv.status).toBe(503);
    expect((await call(new Request(`${APP}/api/health`), { OAUTH_KV: undefined })).headers.get('x-app')).toBe('1');
  });
});
