import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse, type AuthInfo } from '@modelcontextprotocol/server';
import { buildPricingMcpServer, MAX_IMPORT_BYTES } from './pricing-tools';

/** What the OAuth layer verified about the access token before the MCP handler is reached. */
export interface McpCaller {
  clientId: string;
  userId: string;
  scopes: string[];
  audience: string;
  expiresAt?: number;
}

// The handler is stateless: every request gets a fresh server from the factory, so nothing is held between calls.
// The body limit leaves room for the 512 KiB batch plus the JSON-RPC envelope.
const handler = createMcpHandler(buildPricingMcpServer, { maxRequestBodySize: MAX_IMPORT_BYTES + 64 * 1024 });

/**
 * Serves one MCP request for a caller whose token has already been verified (signature, audience, expiry).
 * Scopes and the person's current role are checked again inside each tool.
 */
export async function handleMcpRequest(request: Request, appUrl: string, caller: McpCaller): Promise<Response> {
  // The SDK handler checks neither Host nor Origin: guard against DNS rebinding here. A server-to-server client such
  // as ChatGPT sends no Origin; a browser page on another site does, and is refused.
  const hostname = new URL(appUrl).hostname;
  const refused = hostHeaderValidationResponse(request, [hostname]) ?? originValidationResponse(request, [hostname]);
  if (refused) return refused;

  const authInfo: AuthInfo = {
    token: '', // the credential itself is never passed on or kept
    clientId: caller.clientId,
    scopes: caller.scopes,
    expiresAt: caller.expiresAt,
    resource: new URL(caller.audience),
    extra: { userId: caller.userId },
  };
  return handler.fetch(request, { authInfo });
}
