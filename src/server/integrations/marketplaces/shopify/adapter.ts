import type { MarketplaceSettings } from '../../../db/schema';
import type { CredentialsStore, Listing, OrderRef, PriceFailure, PriceUpdate, StockFailure, StockUpdate, TrackingInfo } from '../../types';
import type { MarketplaceAdapter, SyncResult } from '../types';
import { DEFAULT_SHOPIFY_API_VERSION, ShopifyClient, type ShopifyCredentials } from './client';
import { DEFAULT_PICKUP_POINT_KEYS, mapShopifyOrder } from './mapper';
import { msg } from '@/lib/i18n/msg';

const ORDER_FIELDS = `
  id name createdAt updatedAt processedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus
  email phone paymentGatewayNames
  totalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  totalDiscountsSet { shopMoney { amount currencyCode } }
  refunds(first: 20) {
    id createdAt
    totalRefundedSet { shopMoney { amount currencyCode } }
    refundLineItems(first: 100) { nodes { quantity restockType lineItem { id } subtotalSet { shopMoney { amount } } } }
  }
  transactions(first: 20) {
    id kind status processedAt
    fees { id amount { amount currencyCode } taxAmount { amount currencyCode } type }
  }
  shippingAddress { name firstName lastName company address1 address2 city zip countryCodeV2 phone }
  shippingLine { title code source }
  customAttributes { key value }
  lineItems(first: 100) {
    nodes {
      id sku name quantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      totalDiscountSet { shopMoney { amount currencyCode } }
      image { url(transform: { maxWidth: 240 }) }
      variant { id inventoryItem { id } }
    }
  }`;

export const ORDERS_QUERY = `query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ORDER_FIELDS} }
  }
}`;

export const HISTORY_QUERY = `query History($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ORDER_FIELDS} }
  }
}`;

const ORDER_QUERY = `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;

const SHOP_QUERY = `query Shop { shop { name myshopifyDomain } locations(first: 5) { nodes { id name isActive } } }`;

const FULFILLMENT_ORDERS_QUERY = `query FulfillmentOrders($id: ID!) {
  order(id: $id) { id fulfillmentOrders(first: 20) { nodes { id status } } }
}`;

const FULFILLMENT_CREATE = `mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment { id status }
    userErrors { field message }
  }
}`;

const VARIANTS_QUERY = `query Variants($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sku barcode price displayName inventoryQuantity requiresComponents inventoryItem { id tracked }
      image { url(transform: { maxWidth: 240 }) }
      product { id status vendor productType featuredImage { url(transform: { maxWidth: 240 }) } }
    }
  }
}`;

const VARIANT_DETAILS = `query Details($ids: [ID!]!, $keys: [String!] = [], $withMeta: Boolean = false) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id sku barcode price displayName
      image { url }
      inventoryItem { measurement { weight { value unit } } }
      product {
        title descriptionHtml vendor productType images(first: 10) { nodes { url } }
        metafields(first: 25, keys: $keys) @include(if: $withMeta) { nodes { namespace key value } }
      }
    }
  }
}`;

/** What Von Halsky needs to create an offer, read live from Shopify. */
export interface ShopifyVariantDetails {
  variantId: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  price: string;
  ean: string | null;
  sku: string | null;
  imageUrls: string[];
  /** Grams, when Shopify knows it. */
  weightGrams: number | null;
  /** The product metafields asked for, by "namespace.key"; only those that are filled in. */
  metafields: Record<string, string>;
}

/**
 * "namespace.key" of a metafield. Asked for by `keys`, Shopify returns `key` already in that form
 * ("custom.responsible_person"); a plain key ("responsible_person") gets its namespace put in front.
 */
function metafieldId(m: { namespace: string; key: string }): string {
  return m.key.includes('.') ? m.key : `${m.namespace}.${m.key}`;
}

const GRAMS_PER_UNIT: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 };

const VARIANT_COSTS = `query Costs($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id inventoryItem { unitCost { amount currencyCode } } }
  }
}`;

const FIND_CUSTOMER = `query FindCustomer($query: String!) {
  customers(first: 1, query: $query) { nodes { id tags defaultEmailAddress { emailAddress marketingState } } }
}`;

const TAGS_ADD = `mutation TagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
const TAGS_REMOVE = `mutation TagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;

// Since API 2026-04 inventory mutations must carry an idempotency key.
const SET_QUANTITIES = `mutation SetQty($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { id }
    userErrors { field message code }
  }
}`;

interface SetQuantitiesError {
  field: string[] | null;
  message: string;
  code?: string | null;
}

/** Errors about the call itself (the location, the reason…): every item would fail the same way, so the push stops. */
const WHOLE_CALL_ERRORS = new Set(['INVALID_LOCATION', 'INVALID_NAME', 'INVALID_REASON', 'INVALID_REFERENCE_DOCUMENT']);

/** Which of the quantities sent an error is about: Shopify names it as ["input", "quantities", "3", "inventoryItemId"]. */
export function refusedQuantityIndex(field: string[] | null | undefined): number | null {
  const at = field?.indexOf('quantities') ?? -1;
  if (at < 0) return null;
  const index = Number(field![at + 1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

const VARIANT_PRODUCTS = `query VariantProducts($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id product { id } } }
}`;

const SET_PRICES = `mutation SetPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    userErrors { field message code }
  }
}`;

const PAGE_SIZE = 50;
const MAX_PAGES_PER_SYNC = 10;
const OPEN_FULFILLMENT_STATUSES = new Set(['OPEN', 'IN_PROGRESS']);

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export class ShopifyAdapter implements MarketplaceAdapter {
  readonly marketplace = 'shopify' as const;
  private readonly client: ShopifyClient;

  constructor(
    creds: CredentialsStore<ShopifyCredentials>,
    private readonly settings: MarketplaceSettings = {},
  ) {
    this.client = new ShopifyClient(creds, settings.apiVersion ?? DEFAULT_SHOPIFY_API_VERSION);
  }

  async checkConnection(): Promise<string> {
    const data = await this.client.graphql<{ shop: { name: string; myshopifyDomain: string } }>(SHOP_QUERY);
    return `${data.shop.name} (${data.shop.myshopifyDomain})`;
  }

  /** Cursor = ISO timestamp of the newest `updatedAt` already stored. */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    const since = cursor ?? new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString();
    const orders = [];
    let after: string | null = null;
    let newest = since;
    let hasMore = false;

    for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
      const data: { orders: { pageInfo: PageInfo; nodes: { updatedAt: string }[] } } = await this.client.graphql(
        ORDERS_QUERY,
        { first: PAGE_SIZE, after, query: `updated_at:>='${since}'` },
      );
      for (const node of data.orders.nodes) {
        orders.push(mapShopifyOrder(node, this.settings.pickupPointKeys ?? DEFAULT_PICKUP_POINT_KEYS));
        if (node.updatedAt > newest) newest = node.updatedAt;
      }
      hasMore = data.orders.pageInfo.hasNextPage;
      after = data.orders.pageInfo.endCursor;
      if (!hasMore) break;
    }
    return { orders, nextCursor: newest, hasMore };
  }

  /**
   * Past orders, newest first. Orders older than 60 days need the read_all_orders scope; without it
   * Shopify simply returns fewer.
   */
  async syncHistory(cursor: string | null): Promise<SyncResult> {
    const state: { before: string; after: string | null } = cursor ? JSON.parse(cursor) : { before: new Date().toISOString(), after: null };
    const orders = [];
    let hasMore = true;
    for (let page = 0; page < MAX_PAGES_PER_SYNC && hasMore; page++) {
      const data: { orders: { pageInfo: PageInfo; nodes: unknown[] } } = await this.client.graphql(HISTORY_QUERY, {
        first: PAGE_SIZE,
        after: state.after,
        query: `created_at:<='${state.before}'`,
      });
      for (const node of data.orders.nodes) orders.push(mapShopifyOrder(node, this.settings.pickupPointKeys ?? DEFAULT_PICKUP_POINT_KEYS));
      hasMore = data.orders.pageInfo.hasNextPage;
      state.after = data.orders.pageInfo.endCursor;
    }
    return { orders, nextCursor: hasMore ? JSON.stringify(state) : null, hasMore };
  }

  async getOrder(externalId: string) {
    const data = await this.client.graphql<{ order: unknown | null }>(ORDER_QUERY, { id: externalId });
    return data.order ? mapShopifyOrder(data.order, this.settings.pickupPointKeys ?? DEFAULT_PICKUP_POINT_KEYS) : null;
  }

  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    const data = await this.client.graphql<{
      order: { fulfillmentOrders: { nodes: { id: string; status: string }[] } } | null;
    }>(FULFILLMENT_ORDERS_QUERY, { id: order.externalId });
    if (!data.order) throw new Error(`Shopify order ${order.externalNumber} not found`);

    const open = data.order.fulfillmentOrders.nodes.filter((fo) => OPEN_FULFILLMENT_STATUSES.has(fo.status));
    // Nothing left to fulfil: the tracking was pushed before, or the order was fulfilled in Shopify.
    if (open.length === 0) return;

    const result = await this.client.graphql<{
      fulfillmentCreate: { userErrors: { field: string[] | null; message: string }[] };
    }>(FULFILLMENT_CREATE, {
      fulfillment: {
        lineItemsByFulfillmentOrder: open.map((fo) => ({ fulfillmentOrderId: fo.id })),
        trackingInfo: {
          company: tracking.carrier === 'inpost' ? 'InPost' : tracking.carrierName,
          number: tracking.trackingNumber,
          url: tracking.trackingUrl ?? undefined,
        },
        notifyCustomer: this.settings.notifyCustomer ?? true,
      },
    });
    const errors = result.fulfillmentCreate.userErrors;
    if (errors.length) throw new Error(`Shopify fulfillment failed: ${errors.map((e) => e.message).join('; ')}`);
  }

  async *listListings(): AsyncIterable<Listing> {
    let after: string | null = null;
    for (;;) {
      const data: {
        productVariants: {
          pageInfo: PageInfo;
          nodes: {
            id: string;
            sku: string | null;
            barcode?: string | null;
            price?: string | null;
            displayName: string;
            inventoryQuantity: number | null;
            requiresComponents?: boolean | null;
            inventoryItem: { id: string; tracked?: boolean | null };
            image: { url: string } | null;
            product: { id?: string; status?: string | null; vendor?: string | null; productType?: string | null; featuredImage: { url: string } | null } | null;
          }[];
        };
      } = await this.client.graphql(VARIANTS_QUERY, { first: 100, after });
      for (const v of data.productVariants.nodes) {
        yield {
          externalId: v.id,
          sku: v.sku || null,
          title: v.displayName,
          quantity: v.inventoryQuantity,
          ean: v.barcode?.trim() || null,
          // A draft or archived product still holds stock, so it stays a listing stock is sent to; the status is only shown.
          status: v.product?.status ?? null,
          // A bundle's quantity is counted by Shopify from its components; Shopify refuses to have it set.
          stockLocked: v.requiresComponents ? 'bundle' : null,
          // tracked 0 = Shopify does not track this product's stock: it sells there whatever the number says.
          ref: { inventoryItemId: v.inventoryItem.id, productId: v.product?.id ?? null, tracked: v.inventoryItem.tracked === false ? 0 : 1 },
          price: v.price ? Number(v.price).toFixed(2) : null,
          imageUrl: v.image?.url ?? v.product?.featuredImage?.url ?? null,
          brand: v.product?.vendor?.trim() || null,
          category: v.product?.productType?.trim() || null,
        };
      }
      if (!data.productVariants.pageInfo.hasNextPage) return;
      after = data.productVariants.pageInfo.endCursor;
    }
  }

  /**
   * Title, description, brand, photos, price and weight of Shopify variants (by variant id), plus the product
   * metafields named in `metafieldKeys` ("namespace.key", e.g. "custom.responsible_person").
   */
  async variantDetails(variantIds: string[], metafieldKeys: string[] = []): Promise<Map<string, ShopifyVariantDetails>> {
    const out = new Map<string, ShopifyVariantDetails>();
    for (let i = 0; i < variantIds.length; i += 50) {
      const data: {
        nodes: ({
          id: string;
          sku: string | null;
          barcode: string | null;
          price: string;
          displayName: string;
          image: { url: string } | null;
          inventoryItem: { measurement: { weight: { value: number; unit: string } | null } | null } | null;
          product: {
            title: string;
            descriptionHtml: string;
            vendor: string;
            productType: string;
            images: { nodes: { url: string }[] };
            metafields?: { nodes: { namespace: string; key: string; value: string | null }[] };
          };
        } | null)[];
      } = await this.client.graphql(VARIANT_DETAILS, { ids: variantIds.slice(i, i + 50), keys: metafieldKeys, withMeta: metafieldKeys.length > 0 });
      for (const v of data.nodes) {
        if (!v?.product) continue;
        const weight = v.inventoryItem?.measurement?.weight;
        const urls = [v.image?.url, ...v.product.images.nodes.map((n) => n.url)].filter((u): u is string => Boolean(u));
        out.set(v.id, {
          variantId: v.id,
          title: v.displayName || v.product.title,
          descriptionHtml: v.product.descriptionHtml,
          vendor: v.product.vendor,
          productType: v.product.productType,
          price: v.price,
          ean: v.barcode?.trim() || null,
          sku: v.sku || null,
          imageUrls: [...new Set(urls)],
          weightGrams: weight && weight.value > 0 ? Math.round(weight.value * (GRAMS_PER_UNIT[weight.unit] ?? 1)) : null,
          metafields: Object.fromEntries((v.product.metafields?.nodes ?? []).filter((m) => m.value?.trim()).map((m) => [metafieldId(m), m.value!.trim()])),
        });
      }
    }
    return out;
  }

  /** The Shopify customer with this e-mail (needs read_customers), with their marketing consent. */
  async findCustomer(email: string): Promise<{ id: string; tags: string[]; subscribed: boolean } | null> {
    const data = await this.client.graphql<{
      customers: { nodes: { id: string; tags: string[]; defaultEmailAddress: { marketingState: string | null } | null }[] };
    }>(FIND_CUSTOMER, { query: `email:"${email.replace(/"/g, '')}"` });
    const c = data.customers.nodes[0];
    return c ? { id: c.id, tags: c.tags, subscribed: c.defaultEmailAddress?.marketingState === 'SUBSCRIBED' } : null;
  }

  /** Adds and removes customer tags (needs write_customers). */
  async updateCustomerTags(customerId: string, add: string[], remove: string[]): Promise<void> {
    for (const [query, tags, name] of [
      [TAGS_ADD, add, 'tagsAdd'],
      [TAGS_REMOVE, remove, 'tagsRemove'],
    ] as const) {
      if (!tags.length) continue;
      const result = await this.client.graphql<Record<string, { userErrors: { message: string }[] }>>(query, { id: customerId, tags });
      const errors = result[name].userErrors;
      if (errors.length) throw new Error(`Shopify ${name} failed: ${errors.map((e) => e.message).join('; ')}`);
    }
  }

  /** "Cost per item" of every variant that has one, keyed by variant id. */
  async variantCosts(): Promise<Map<string, { amount: string; currency: string }>> {
    const out = new Map<string, { amount: string; currency: string }>();
    let after: string | null = null;
    for (;;) {
      const data: {
        productVariants: { pageInfo: PageInfo; nodes: { id: string; inventoryItem: { unitCost: { amount: string; currencyCode: string } | null } | null }[] };
      } = await this.client.graphql(VARIANT_COSTS, { first: 100, after });
      for (const v of data.productVariants.nodes) {
        const cost = v.inventoryItem?.unitCost;
        if (cost && Number(cost.amount) > 0) out.set(v.id, { amount: cost.amount, currency: cost.currencyCode });
      }
      if (!data.productVariants.pageInfo.hasNextPage) return out;
      after = data.productVariants.pageInfo.endCursor;
    }
  }

  /**
   * Sets the available quantity at the shop's location. Shopify takes up to 250 quantities per call and applies
   * a call in full or not at all, so one item it refuses (a bundle, a deleted variant) is taken out and reported,
   * and the rest are sent again.
   */
  async setStock(updates: StockUpdate[]): Promise<StockFailure[]> {
    if (updates.length === 0) return [];
    const failures: StockFailure[] = [];
    const sendable: StockUpdate[] = [];
    for (const u of updates) {
      if (typeof u.ref.inventoryItemId === 'string' && u.ref.inventoryItemId) sendable.push(u);
      else failures.push({ externalId: u.externalId, message: 'Shopify inventory item unknown; read the listings again' });
    }
    if (sendable.length === 0) return failures;
    const locationId = this.settings.locationId ?? (await this.primaryLocationId());
    for (let i = 0; i < sendable.length; i += 250) failures.push(...(await this.setQuantities(sendable.slice(i, i + 250), locationId)));
    return failures;
  }

  private async setQuantities(chunk: StockUpdate[], locationId: string): Promise<StockFailure[]> {
    if (chunk.length === 0) return [];
    const result = await this.client.graphql<{ inventorySetQuantities: { userErrors: SetQuantitiesError[] } }>(SET_QUANTITIES, {
      // A new key per call: each call is a new instruction, never a repeat of an earlier one.
      key: crypto.randomUUID(),
      input: {
        name: 'available',
        reason: 'correction',
        referenceDocumentUri: 'gid://luora-os/StockSync/master',
        quantities: chunk.map((u) => ({
          inventoryItemId: String(u.ref.inventoryItemId),
          locationId,
          quantity: u.quantity,
          // This app is the source of truth, so skip Shopify's compare-and-swap check.
          changeFromQuantity: null,
        })),
      },
    });
    const errors = result.inventorySetQuantities.userErrors;
    if (errors.length === 0) return [];

    const refused = new Map<number, SetQuantitiesError>();
    for (const e of errors) {
      const index = refusedQuantityIndex(e.field);
      if (index !== null && index < chunk.length && !refused.has(index)) refused.set(index, e);
    }
    const describe = (e: SetQuantitiesError) => `Shopify: ${e.message}`;
    const failure = (u: StockUpdate, e: SetQuantitiesError): StockFailure => ({ externalId: u.externalId, message: describe(e), gone: e.code === 'INVALID_INVENTORY_ITEM' });
    if (refused.size > 0) {
      // Nothing was applied: report the items Shopify named and send the others again.
      const rest = chunk.filter((_, i) => !refused.has(i));
      return [...[...refused].map(([i, e]) => failure(chunk[i], e)), ...(await this.setQuantities(rest, locationId))];
    }
    if (errors.some((e) => WHOLE_CALL_ERRORS.has(e.code ?? ''))) throw new Error(`Shopify stock update failed: ${errors.map((e) => e.message).join('; ')}`);
    if (chunk.length === 1) return [failure(chunk[0], errors[0])];
    // Shopify did not say which item it refuses: halve the batch until that item stands alone.
    const half = Math.ceil(chunk.length / 2);
    return [...(await this.setQuantities(chunk.slice(0, half), locationId)), ...(await this.setQuantities(chunk.slice(half), locationId))];
  }

  /** Sets variant prices. Shopify changes variants one product at a time, so a product Shopify refuses fails alone. */
  async setPrices(updates: PriceUpdate[]): Promise<PriceFailure[]> {
    const failures: PriceFailure[] = [];
    // Listings imported before the product id was kept don't have it; ask Shopify for those.
    const productOf = new Map(updates.flatMap((u) => (typeof u.ref.productId === 'string' ? [[u.externalId, u.ref.productId] as const] : [])));
    const unknown = updates.filter((u) => !productOf.has(u.externalId)).map((u) => u.externalId);
    for (let i = 0; i < unknown.length; i += 50) {
      const data = await this.client.graphql<{ nodes: ({ id: string; product: { id: string } } | null)[] }>(VARIANT_PRODUCTS, { ids: unknown.slice(i, i + 50) });
      for (const node of data.nodes) if (node?.product) productOf.set(node.id, node.product.id);
    }
    const byProduct = new Map<string, PriceUpdate[]>();
    for (const u of updates) {
      const productId = productOf.get(u.externalId);
      if (!productId) failures.push({ externalId: u.externalId, message: 'Shopify has no such variant any more' });
      else byProduct.set(productId, [...(byProduct.get(productId) ?? []), u]);
    }
    for (const [productId, group] of byProduct) {
      const result = await this.client.graphql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(SET_PRICES, {
        productId,
        variants: group.map((u) => ({ id: u.externalId, price: u.price })),
      });
      const errors = result.productVariantsBulkUpdate.userErrors;
      if (errors.length) for (const u of group) failures.push({ externalId: u.externalId, message: `Shopify: ${errors.map((e) => e.message).join('; ')}` });
    }
    return failures;
  }

  private async primaryLocationId(): Promise<string> {
    const data = await this.client.graphql<{ locations: { nodes: { id: string; isActive: boolean }[] } }>(SHOP_QUERY);
    const location = data.locations.nodes.find((l) => l.isActive);
    if (!location) throw new Error(msg('Shopify store has no active location; set locationId in the account settings'));
    return location.id;
  }
}
