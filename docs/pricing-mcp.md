# Pricing research over MCP (ChatGPT Work)

Luora OS exposes the pricing research API as a **Model Context Protocol (MCP) server**, so a custom MCP plugin in ChatGPT Work (including its scheduled tasks) can read the pricing catalogue and import researched recommendations without any credential in a chat message or task prompt.

- **Endpoint:** `https://<APP_URL host>/mcp`, for example `https://luora-os.danielkapusta.workers.dev/mcp`. It is part of the existing Worker; there is no new service.
- **Transport:** MCP Streamable HTTP, stateless (every request is independent). `GET /mcp` answers 405, which is normal for a stateless server.
- **Sign-in:** OAuth 2.1 with PKCE (details below). The sign-in step is the app's own login.
- **The REST API is unchanged.** `GET /api/pricing/recommendations/catalog`, `POST /api/pricing/recommendations` and `PRICING_RESEARCH_API_TOKEN` keep working exactly as described in [pricing-research.md](pricing-research.md). Use REST for your own scripts; use MCP for ChatGPT.

## Why OAuth, and not the existing token

OpenAI's authentication guide for custom MCP servers says ChatGPT cannot present a custom API key or a static bearer token, and does not support machine-to-machine grants (client credentials, service accounts). The supported choices are no authentication, or OAuth 2.1 authorization code with PKCE (S256) per the MCP authorization spec. An unauthenticated endpoint is not acceptable for price data and write access, so MCP uses OAuth.

The OAuth authorization server is Cloudflare's [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) running **inside the same Worker**. It handles tokens, PKCE, client registration and refresh rotation. The only custom part is the screen where a signed-in person approves the connection.

## What it exposes

| Tool | Scope | What it does |
| --- | --- | --- |
| `get_pricing_catalog` | `pricing:read` | Same data and pagination as the REST catalogue: marketplace accounts, products linked to Shopify variants with stock, and each Shopify/Empik/HEBE/Allegro offer with its current price. 50 products per call; pass `nextCursor` as `after` until it is `null`. |
| `import_pricing_recommendations` | `pricing:write` | Same validation, limits and atomicity as the REST import: 1 to 100 unique records per call, at most 512 KiB, the whole batch refused if any record is invalid, and only a strictly newer `researchedAt` replaces a stored recommendation (equal or older observations are ignored, so a replay is safe). |

Both tools call the same service functions as the REST endpoints (`researchCatalog`, `importPricingResearch`), directly and not over HTTP. Tool annotations: `get_pricing_catalog` is read-only and idempotent; `import_pricing_recommendations` is idempotent and deliberately **not** marked destructive (it only upserts research rows), so it should not need a confirmation per call. All tools are closed-world (`openWorldHint: false`).

**Recommendations never publish prices.** The MCP code imports nothing about marketplace adapters, orders or customers (a test enforces it), and importing writes only the `pricing_recommendations` table. A person still reads the recommendation on the Pricing page and presses Update to publish.

## Security model

- **Every MCP request needs a valid access token**, including `initialize` and tool discovery. Without one the answer is `401` with `WWW-Authenticate: Bearer resource_metadata=…` pointing at the protected resource metadata.
- **Tokens are bound to the `/mcp` resource** (RFC 8707): a token issued for another audience is refused. PKCE (S256 only) is mandatory. The authorization response carries `iss` (RFC 9207).
- **Who can connect:** a signed-in Luora user whose role has the pricing capability (admin and marketing). Others get a refusal page and no code.
- **The role is re-checked on every tool call.** The token only carries the person's id. Demoting or deleting the user cuts MCP access immediately, without waiting for the token to expire.
- **Scopes:** `pricing:read` and `pricing:write`. The consent screen shows both, ticked; unticking write gives a read-only connection that cannot import.
- **Storage:** the library keeps grants and tokens in the `OAUTH_KV` namespace, tokens and codes only as hashes. Nothing secret is logged or committed, and no new secret is needed.
- **Host and Origin are validated** (DNS-rebinding guard): requests whose `Host` is not the app's host, or that carry another site's `Origin`, are refused. ChatGPT's server-to-server calls send no `Origin`.
- **Client registration is open by protocol design** (dynamic client registration, the fallback when a client has no metadata document): anyone can register a client, but a client gets no token without a signed-in pricing user approving it on the consent screen. Registered clients expire after 90 days. ChatGPT prefers a Client ID Metadata Document, which needs no registration at all.
- **Fails closed:** if the deployment has no `OAUTH_KV` binding or no `APP_URL`, `/mcp` and `/oauth/*` answer 503 and the rest of the app is unaffected.
- **Consent screen and connections page** send no-store, no-framing and a strict CSP; consent uses the library's one-time, browser-bound form handle (CSRF-safe) and the connections page checks the request origin and uses a `SameSite=Lax` session cookie.

### Token lifetimes, refresh and revocation

| | |
| --- | --- |
| Access token | 1 hour |
| Refresh token | Rotates on every use. A grant that is not used for **90 days** expires. |
| Registered clients (DCR) | 90 days (Cloudflare's default) |

- **Refresh** is automatic: a client that holds the refresh token gets a new access token (and a new refresh token) when it asks. A scheduled task that runs at least every 90 days keeps its grant alive.
- **Disconnect** an app at `https://<APP_URL host>/oauth/connections` (sign in first). It lists your connected apps and revokes the grant, which ends its access token and refresh token.
- **Cut access for a person:** change their role or delete them (takes effect on the next call).
- **Cut MCP entirely:** remove the `OAUTH_KV` binding (or the namespace). `/mcp` then answers 503. REST is unaffected.
- **Rotate everything:** delete the KV namespace and create a new one; every client must connect again.

## Deployment and configuration

1. **Nothing to put in secrets.** `PRICING_RESEARCH_API_TOKEN` is only for the REST API.
2. **`APP_URL`** (already in `wrangler.jsonc` `vars`) must be the public `https` origin of the app. The OAuth issuer and the `/mcp` resource are derived from it, so if the address changes, ChatGPT must connect again.
3. **KV namespace.** `wrangler.jsonc` declares the binding `OAUTH_KV` without an id, so Cloudflare creates the namespace on the first `wrangler deploy`. If your build or deploy does not create it automatically, create it once and paste the id into the binding:
   ```sh
   npx wrangler kv namespace create OAUTH_KV
   ```
   ```jsonc
   "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "<the id printed above>" }]
   ```
4. **Compatibility flag** `global_fetch_strictly_public` (needed so ChatGPT can register through a Client ID Metadata Document) is already set.
5. Deploy as usual, then check the discovery documents (they need no sign-in):
   ```sh
   curl https://<host>/.well-known/oauth-authorization-server   # issuer, S256, registration_endpoint, client_id_metadata_document_supported
   curl https://<host>/.well-known/oauth-protected-resource      # resource = https://<host>/mcp
   curl -i -X POST https://<host>/mcp -H 'content-type: application/json' -d '{}'   # 401 with WWW-Authenticate
   ```

## Connect ChatGPT Work

Prerequisites: a ChatGPT workspace where custom MCP plugins/connectors are allowed (developer mode, and on Business or Enterprise an admin may need to allow custom connectors), and a Luora login with the admin or marketing role.

1. In ChatGPT Work, create a **custom MCP plugin** (connector).
2. Enter the server URL: `https://<APP_URL host>/mcp`.
3. Choose **OAuth** as the authentication. Leave client registration on the default (ChatGPT prefers a Client ID Metadata Document); if the builder asks you to choose, **dynamic client registration (DCR)** also works.
4. Save/connect. A browser window opens on Luora: sign in with your normal email and password if asked, check the app name and the two permissions, and press **Allow**.
5. The plugin now lists `get_pricing_catalog` and `import_pricing_recommendations`.

The exact button names in ChatGPT may differ from the steps above (they follow OpenAI's current plugin builder, which this repository cannot test). The redirect URIs ChatGPT uses are `https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/{callback_id}`; they are registered by ChatGPT itself, so you do not enter them in Luora.

## Scheduled tasks and other limitations

- **A person must approve once**, in a browser. There is no unattended way to create the first connection, by design.
- OpenAI's documentation does **not** say whether scheduled or background ChatGPT tasks can renew an expired grant without a person. Luora issues rotating refresh tokens with a 90-day idle lifetime so a daily task has what it needs, but **unattended imports have not been tested inside ChatGPT and are not promised**. Test one scheduled run, then check on the Pricing page that fresh "Last researched" times appear. If a task starts failing with 401, reconnect the plugin.
- ChatGPT applies its own approval policy to tools that write data. `import_pricing_recommendations` is not marked destructive, but whether ChatGPT still asks for a confirmation on a scheduled run is something to observe on the first run.
- Importing never changes a marketplace price. Recommendations older than 48 hours, or made against a price that has since changed, still need a re-check before "Use price" is offered (existing behaviour).

## Verification status

Verified **locally** in this repository (no deployment):

- 21 automated tests (`tests/pricing-mcp.db.test.ts`, `tests/pricing-mcp-oauth.db.test.ts`) with the real MCP SDK client and the real OAuth library, local D1 and simulated KV, dummy values only: initialize, tool discovery, both tools, catalogue pagination over 120 products, atomic rejection of an invalid batch, older/equal observations not overwriting newer ones, no price or account change on import, 401 without a token (discovery and calls), wrong audience/resource refused, read-only grant refused on import, role re-check, consent only for signed-in pricing users, PKCE and code reuse, CIMD and DCR registration, refresh rotation, revocation, and the app passing through untouched.
- A Worker-compatible build (`opennextjs-cloudflare build`) and `wrangler deploy --dry-run`; Worker script about 5.6 MB gzipped.
- The same flow end to end against the Worker running in the real Workers runtime (`wrangler dev`, local D1 and KV): registration, consent, PKCE, MCP initialize, tools/list, both tools, refresh rotation, revocation, plus the scheduled and queue handlers still running.

**Not verified** (needs the deployed app and ChatGPT): automatic KV creation under your Cloudflare build pipeline, the connection from ChatGPT itself (CIMD or DCR as ChatGPT actually performs it), tool confirmations in ChatGPT, and unattended scheduled imports.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `503 The MCP endpoint is not configured` | No `OAUTH_KV` binding or `APP_URL` on this deployment. |
| `401 invalid_token` | Expired, revoked or wrong-audience token; reconnect the plugin. |
| Tool error "no longer has access to pricing" | The person's role lost the pricing capability. |
| 403 `insufficient_scope` on import | The connection was approved without write access; disconnect and connect again. |
| "This request did not come from Luora" on the consent screen or the connections page | The post was refused as cross-site. Fixed for browsers that send `Origin: null` after the first release; if it still appears, check that the browser address matches `APP_URL`. |
| Consent page says the app "could not be verified" | ChatGPT's client metadata document could not be fetched; check `global_fetch_strictly_public` and the Worker's outbound access. |
| "Failed to resolve OAuth client" in ChatGPT | Registration failed: check the discovery documents above; try DCR in the plugin builder. |

## Code map

- `src/server/mcp/pricing-tools.ts`: the two tools (reuse `src/server/services/pricing-research.ts`).
- `src/server/mcp/handler.ts`: the stateless MCP handler, Host/Origin guard.
- `src/server/mcp/oauth-app.ts`: OAuth provider configuration and the wrapper placed in front of the app.
- `src/server/mcp/consent.ts`: consent and connections pages.
- `src/server/session.ts`: session lookup shared with the app's login.
- `src/worker/cloudflare.ts`: Worker entry (the app's `fetch` now goes through the wrapper; `queue` and `scheduled` are unchanged).
