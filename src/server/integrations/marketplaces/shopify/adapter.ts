import type { MarketplaceSettings } from '../../../db/schema';
import type { CredentialsStore, Listing, OrderRef, StockUpdate, TrackingInfo } from '../../types';
import type { MarketplaceAdapter, SyncResult } from '../types';
import { DEFAULT_SHOPIFY_API_VERSION, ShopifyClient, type ShopifyCredentials } from './client';
import { DEFAULT_PICKUP_POINT_KEYS, mapShopifyOrder } from './mapper';

const ORDER_FIELDS = `
  id name createdAt updatedAt processedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus
  email phone paymentGatewayNames
  totalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { name firstName lastName company address1 address2 city zip countryCodeV2 phone }
  shippingLine { title code source }
  customAttributes { key value }
  lineItems(first: 100) {
    nodes {
      id sku name quantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
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
      id sku barcode displayName inventoryQuantity inventoryItem { id }
      image { url(transform: { maxWidth: 240 }) }
      product { featuredImage { url(transform: { maxWidth: 240 }) } }
    }
  }
}`;

const SET_QUANTITIES = `mutation SetQty($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
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
            displayName: string;
            inventoryQuantity: number | null;
            inventoryItem: { id: string };
            image: { url: string } | null;
            product: { featuredImage: { url: string } | null } | null;
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
          ref: { inventoryItemId: v.inventoryItem.id },
          imageUrl: v.image?.url ?? v.product?.featuredImage?.url ?? null,
        };
      }
      if (!data.productVariants.pageInfo.hasNextPage) return;
      after = data.productVariants.pageInfo.endCursor;
    }
  }

  async setStock(updates: StockUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const locationId = this.settings.locationId ?? (await this.primaryLocationId());
    // inventorySetQuantities accepts up to 250 quantities per call.
    for (let i = 0; i < updates.length; i += 250) {
      const chunk = updates.slice(i, i + 250);
      const result = await this.client.graphql<{
        inventorySetQuantities: { userErrors: { message: string }[] };
      }>(SET_QUANTITIES, {
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
      if (errors.length) throw new Error(`Shopify stock update failed: ${errors.map((e) => e.message).join('; ')}`);
    }
  }

  private async primaryLocationId(): Promise<string> {
    const data = await this.client.graphql<{ locations: { nodes: { id: string; isActive: boolean }[] } }>(SHOP_QUERY);
    const location = data.locations.nodes.find((l) => l.isActive);
    if (!location) throw new Error('Shopify store has no active location; set locationId in the account settings');
    return location.id;
  }
}
