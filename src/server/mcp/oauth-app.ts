import OAuthProvider, { type OAuthHelpers, type OAuthResourceAuth } from '@cloudflare/workers-oauth-provider';
import { setCfEnv, type CfEnv } from '../cf';
import { AUTHORIZE_PATH, CONNECTIONS_PATH, handleAuthorize, handleConnections } from './consent';
import { handleMcpRequest } from './handler';
import { PRICING_SCOPES } from './pricing-tools';

// OAuth 2.1 in front of the MCP endpoint. ChatGPT cannot send a static API key or bearer token: it signs a person in
// with OAuth (authorization code + PKCE). The authorization server is the Cloudflare OAuth library running inside this
// same Worker; the "sign in" step is the app's own login, so no second identity system exists.

export const MCP_PATH = '/mcp';
const DAY = 86_400;

export type WorkerEnv = CfEnv & { APP_URL?: string; OAUTH_KV?: KVNamespace; OAUTH_PROVIDER?: OAuthHelpers };
export type WorkerFetch = (request: Request, env: WorkerEnv, ctx: ExecutionContext) => Promise<Response>;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/** The 401 a client gets without a valid token: it points at the protected resource metadata (RFC 9728). */
function challenge(origin: string, error?: string): Response {
  const parts = [`resource_metadata="${origin}${RESOURCE_METADATA_PATH}${MCP_PATH}"`, `scope="${PRICING_SCOPES.read} ${PRICING_SCOPES.write}"`];
  if (error) parts.unshift(`error="${error}"`);
  return jsonResponse(401, { error: error ?? 'unauthorized' }, { 'WWW-Authenticate': `Bearer ${parts.join(', ')}` });
}

function buildProvider(origin: string, app: WorkerFetch): OAuthProvider<WorkerEnv> {
  return new OAuthProvider<WorkerEnv>({
    apiRoute: MCP_PATH,
    apiHandler: {
      async fetch(request, env, ctx) {
        setCfEnv(env);
        // The library has verified the token's signature, audience (this /mcp resource) and expiry by now.
        const auth = (ctx as unknown as { auth?: OAuthResourceAuth }).auth;
        const props = (ctx as unknown as { props?: { userId?: string } }).props;
        const userId = auth?.userId ?? props?.userId;
        if (!auth || !userId) return challenge(origin, 'invalid_token');
        return handleMcpRequest(request, origin, {
          clientId: auth.clientId ?? '',
          userId,
          scopes: auth.scope,
          audience: auth.audience,
          expiresAt: auth.expiresAt,
        });
      },
    },
    defaultHandler: {
      async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);
        if (pathname === AUTHORIZE_PATH || pathname === CONNECTIONS_PATH) {
          if (!env.OAUTH_PROVIDER) return jsonResponse(503, { error: 'OAuth is not configured' });
          setCfEnv(env);
          return pathname === AUTHORIZE_PATH ? handleAuthorize(request, env.OAUTH_PROVIDER) : handleConnections(request, env.OAUTH_PROVIDER);
        }
        // Normally the library answers a missing or bad token itself; this keeps /mcp closed even if a request slips through.
        if (pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`)) return challenge(origin);
        return app(request, env, ctx);
      },
    },
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register', // dynamic registration, for clients that do not publish a metadata document
    clientIdMetadataDocumentEnabled: true, // ChatGPT's preferred registration method; needs the global_fetch_strictly_public flag
    scopesSupported: [PRICING_SCOPES.read, PRICING_SCOPES.write],
    // What any access needs. Both, so a client asks for both up front: a connector that can read but not import is no use.
    requiredScopes: [PRICING_SCOPES.read, PRICING_SCOPES.write],
    accessTokenTTL: 3600,
    // A scheduled task refreshes its token each time it runs; a grant that is not used for 90 days expires.
    refreshTokenTTL: 90 * DAY,
    refreshTokenIdleTTL: 90 * DAY,
    resourceMetadata: {
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [origin],
      resource_name: 'Luora OS pricing research',
    },
  });
}

const providers = new Map<string, OAuthProvider<WorkerEnv>>();

/**
 * Wraps the app's fetch handler. Everything outside /mcp and /oauth/* behaves exactly as before; /mcp and the OAuth
 * endpoints answer 503 (closed) rather than open if the Worker was deployed without its KV namespace or APP_URL.
 */
export function withMcp(app: WorkerFetch): WorkerFetch {
  return async (request, env, ctx) => {
    const { pathname } = new URL(request.url);
    const mine = pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`) || pathname.startsWith('/oauth/') || pathname.startsWith('/.well-known/oauth-');
    if (!mine) return app(request, env, ctx);
    if (!env.OAUTH_KV || !env.APP_URL) return jsonResponse(503, { error: 'The MCP endpoint is not configured on this deployment' });
    const origin = new URL(env.APP_URL).origin;
    let provider = providers.get(origin);
    if (!provider) providers.set(origin, (provider = buildProvider(origin, app)));
    // RFC 9728 puts the metadata of the /mcp resource at /.well-known/oauth-protected-resource/mcp (what the 401 challenge
    // advertises). OpenAI's guide names the bare path, so serve the same document there as well.
    if (pathname === RESOURCE_METADATA_PATH) {
      const alias = new URL(request.url);
      alias.pathname = `${RESOURCE_METADATA_PATH}${MCP_PATH}`;
      return provider.fetch(new Request(alias, request), env, ctx);
    }
    return provider.fetch(request, env, ctx);
  };
}
