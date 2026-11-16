import { McpServer, requireScopes, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { can } from '@/lib/permissions';
import { researchImportSchema } from '@/lib/pricing-research';
import { importPricingResearch, researchCatalog, ResearchInputError } from '../services/pricing-research';
import { userById } from '../session';

// The MCP face of the pricing research API. It calls the same service functions as the REST endpoints, so the
// validation, batch limits, atomic write and "only a strictly newer observation replaces an older one" rules are
// shared. It deliberately imports nothing about marketplace adapters, orders or customers: research is stored in
// its own table and never publishes a price.

export const PRICING_SCOPES = { read: 'pricing:read', write: 'pricing:write' } as const;
export const MAX_IMPORT_BYTES = 512 * 1024;

const catalogOutput = z.object({
  accounts: z.array(z.object({ id: z.string(), marketplace: z.string(), name: z.string() })),
  products: z.array(
    z.object({
      id: z.string(),
      shopifyVariantId: z.string().nullable(),
      sku: z.string(),
      ean: z.string().nullable(),
      name: z.string(),
      stock: z.number(),
      listings: z.array(
        z.object({
          id: z.string(),
          accountId: z.string(),
          marketplace: z.string(),
          externalId: z.string(),
          price: z.string().nullable(),
          currency: z.string().nullable(),
          active: z.boolean(),
        }),
      ),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const importOutput = z.object({ received: z.number().int(), applied: z.number().int(), ignoredOlderOrEqual: z.number().int() });

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

type Caller = { extra?: Record<string, unknown> } | undefined;

/**
 * The token was issued to a person, but their role is read again on every call: a user who lost the pricing role,
 * or was deleted, loses MCP access immediately, without waiting for the token to expire.
 */
async function checkCaller(authInfo: Caller): Promise<CallToolResult | null> {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== 'string') return toolError('Not signed in to Luora.');
  const user = await userById(userId);
  if (!user || !can(user.role, 'pricing')) return toolError('This Luora account no longer has access to pricing.');
  return null;
}

export function buildPricingMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'luora-os-pricing', version: '1.0.0' },
    {
      instructions:
        'Luora OS pricing research. Read the catalogue with get_pricing_catalog (follow nextCursor until it is null), research prices on the marketplaces, then upload findings with import_pricing_recommendations. Uploads are stored as recommendations for a person to review; they never change a price on any marketplace.',
    },
  );

  server.registerTool(
    'get_pricing_catalog',
    {
      title: 'Read the Luora pricing catalogue',
      description:
        'Reads Luora products that are linked to Shopify variants, with their stock and each marketplace offer (Shopify, Empik, HEBE, Allegro): offer id, account, current gross price, currency and whether it is active. Also lists the marketplace accounts to use as accountId when importing. Returns 50 products per call; pass nextCursor as `after` to read the next page until nextCursor is null. This is a mapping of imported Shopify variants, not proof that a product is currently sold; match products by exact shopifyVariantId, never by name alone. Contains no credentials, orders or customer data.',
      inputSchema: z.object({
        after: z.string().max(100).optional().describe('The nextCursor from the previous page. Omit for the first page.'),
      }),
      outputSchema: catalogOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireScopes(PRICING_SCOPES.read),
    },
    async ({ after }, ctx) => {
      const denied = await checkCaller(ctx.http?.authInfo);
      if (denied) return denied;
      const catalog = await researchCatalog(after);
      return { content: [{ type: 'text', text: JSON.stringify(catalog) }], structuredContent: catalog };
    },
  );

  server.registerTool(
    'import_pricing_recommendations',
    {
      title: 'Import researched pricing recommendations',
      description:
        'Stores verified pricing research as recommendations that a person reviews on the Luora pricing screen. It never publishes or changes a price on any marketplace. Send 1 to 100 records per call (unique per product and marketplace account, at most 512 KiB). A record with a newer researchedAt replaces the stored one; an equal or older observation is ignored, so repeating a batch is safe. The whole batch is rejected, with nothing saved, if any record is invalid. Use status change_price only with an exact listingId, observedLuoraPrice, a gross PLN recommendedPrice with two decimals and HTTPS source links on the researched marketplace (empik.com/empik.pl, allegro.pl or hebe.pl). keep_price, fix_placement, add_listing and needs_review carry a null recommendedPrice. researchedAt must be the real observation time with a timezone. If a page could not be checked, record needs_review and say why; never invent a price.',
      inputSchema: researchImportSchema,
      outputSchema: importOutput,
      // Not destructive: it only upserts research rows, and only a strictly newer observation replaces an older one.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireScopes(PRICING_SCOPES.write),
    },
    async (args, ctx) => {
      const denied = await checkCaller(ctx.http?.authInfo);
      if (denied) return denied;
      if (new TextEncoder().encode(JSON.stringify(args)).length > MAX_IMPORT_BYTES) return toolError('The batch is larger than 512 KiB; send fewer records per call.');
      try {
        const result = await importPricingResearch(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        if (error instanceof ResearchInputError) return toolError(error.message);
        console.error('Pricing research import via MCP failed');
        return toolError('Could not save pricing research; retry the same batch.');
      }
    },
  );

  return server;
}
