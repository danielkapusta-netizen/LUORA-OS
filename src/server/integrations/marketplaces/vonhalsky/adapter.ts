import type { MarketplaceSettings } from '../../../db/schema';
import { httpConfig } from '../../../http';
import type { CredentialsStore, Listing, NormalizedOrder, StockUpdate } from '../../types';
import type { MarketplaceAdapter, SyncResult } from '../types';
import { VonHalskyApiError, VonHalskyClient, type VonHalskyCredentials } from './client';
import { isImportable, mapVonHalskyOrder, vonHalskyOrderSchema } from './mapper';

const ORDERS_PAGE = 30;
const OFFERS_PAGE = 30;
const MAX_PAGES_PER_SYNC = 10;
/** Stock updates per request. */
const STOCK_BATCH = 100;
const COMMAND_POLLS = 3;

interface Page {
  limit: number;
  offset: number;
  total: number;
}

interface Offer {
  id: string;
  status?: string;
  externalId?: string | null;
  product: { name: string; sku?: string | null; ean?: string | null };
  stock?: { quantity: number } | null;
  price?: { grossPrice?: { amount: number } | null } | null;
}

/** The list wraps each offer as { metadata, offer }; a bare offer is accepted too. */
interface OffersPage {
  page: Page;
  data: (Offer | { metadata?: unknown; offer: Offer })[];
}

const offerOf = (item: Offer | { offer: Offer }): Offer => ('offer' in item ? item.offer : item);

/** What a new offer needs; the caller reads these from Shopify and the account settings. */
export interface VonHalskyOfferInput {
  externalId: string;
  name: string;
  descriptionHtml: string;
  brand: string;
  categoryId: string;
  sku: string | null;
  ean: string;
  /** cm and grams. */
  dimension: { width: number; height: number; length: number; weight: number };
  quantity: number;
  price: string;
  currency: string;
  daysToShip: number;
  imageUrls: string[];
}

/** InPost wants a file name per image: the last part of the URL without its query, unique within the offer. */
export function imageFileNames(urls: string[]): { fileName: string; fileUrl: string }[] {
  const used = new Set<string>();
  return urls.map((fileUrl, i) => {
    let name = '';
    try {
      name = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop() ?? '');
    } catch {
      name = '';
    }
    name = name.replace(/[^\w.-]+/g, '_').slice(-100) || `image-${i + 1}`;
    if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) name += '.jpg';
    let unique = name;
    for (let n = 2; used.has(unique); n++) unique = name.replace(/(\.[^.]+)$/, `-${n}$1`);
    used.add(unique);
    return { fileName: unique, fileUrl };
  });
}

/** A write answers with one command or a list of them; a plain object without a command id is ignored. */
function asCommands(result: unknown): CommandDetails[] {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  return list.filter((c): c is CommandDetails => typeof c === 'object' && c !== null && typeof (c as CommandDetails).commandId === 'string');
}

interface CommandDetails {
  commandId: string;
  offerId?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILURE';
}

interface CommandStatus {
  commandId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILURE';
  errors?: { fieldName?: string; message: string }[];
}

export class VonHalskyAdapter implements MarketplaceAdapter {
  readonly marketplace = 'vonhalsky' as const;
  readonly client: VonHalskyClient;

  constructor(
    creds: CredentialsStore<VonHalskyCredentials>,
    private readonly settings: MarketplaceSettings = {},
  ) {
    this.client = new VonHalskyClient(creds);
  }

  /** Children of a category (the tree is loaded one level at a time). */
  async categoryChildren(id: string): Promise<{ id: string; name: string; leaf: boolean }[]> {
    const category = await this.client.call<{ children?: { id: string; name: string; leaf: boolean }[] }>('GET', `/v1/categories/${encodeURIComponent(id)}`);
    return (category.children ?? []).map((c) => ({ id: c.id, name: c.name, leaf: c.leaf }));
  }

  /**
   * All categories below the top-level category named `rootName`, as selectable leaves with their
   * path ("Uroda › Pielęgnacja › Pielęgnacja twarzy › Kremy do twarzy"). Reads the tree level by level.
   */
  async categoryLeaves(rootName: string, maxCalls = 120): Promise<{ id: string; path: string }[]> {
    const roots = await this.client.call<{ id: string; name: string; leaf: boolean; children?: { id: string; name: string; leaf: boolean }[] }[]>('GET', '/v1/categories');
    const root = roots.find((r) => r.name.toLowerCase() === rootName.toLowerCase());
    if (!root) throw new Error(`InPost has no top-level category "${rootName}"`);
    const leaves: { id: string; path: string }[] = [];
    let calls = 0;
    const queue = (root.children ?? []).map((c) => ({ ...c, path: `${root.name} › ${c.name}` }));
    while (queue.length) {
      const node = queue.shift()!;
      if (node.leaf) {
        leaves.push({ id: node.id, path: node.path });
        continue;
      }
      if (++calls > maxCalls) throw new Error('InPost category tree is too large to read in one go');
      for (const child of await this.categoryChildren(node.id)) queue.push({ ...child, path: `${node.path} › ${child.name}` });
    }
    return leaves.sort((x, y) => x.path.localeCompare(y.path));
  }

  /** Creates one offer; InPost checks it asynchronously, and its verdict is read back. */
  async createOffer(offer: VonHalskyOfferInput): Promise<void> {
    const body = {
      externalId: offer.externalId,
      product: {
        name: offer.name,
        description: offer.descriptionHtml,
        brand: offer.brand,
        categoryId: offer.categoryId,
        attributes: [],
        sku: offer.sku,
        ean: offer.ean,
        dimension: offer.dimension,
      },
      stock: { quantity: Math.max(0, Math.floor(offer.quantity)), unit: 'UNIT' },
      price: { grossPrice: { amount: Number(offer.price), currency: offer.currency }, taxRateInfo: '23.00' },
      gpsr: { manuals: [], doesNotRequireGpsrInfo: true },
      shippingTime: { daysToShip: offer.daysToShip },
      images: imageFileNames(offer.imageUrls).map(({ fileName, fileUrl }, i) => ({ fileName, fileUrl, priority: i + 1 })),
      features: { refundable: true },
    };
    const result = await this.client.call<unknown>('POST', this.client.org('/offers'), { body });
    await this.confirm(asCommands(result), 'the new offer');
    const errors = await this.validationErrors(offer.ean);
    if (errors.length) throw new Error(`InPost accepted the offer but reports: ${errors.join('; ')}`);
  }

  /** Validation problems InPost lists on the offer with this EAN (empty when fine or not found yet). */
  private async validationErrors(ean: string): Promise<string[]> {
    const page = await this.client.call<{ data: { metadata?: { validationErrors?: unknown[] }; offer?: Offer }[] }>('GET', this.client.org('/offers'), {
      query: { ean, limit: 30 },
    });
    // The filter may be ignored, so keep only this product's offer.
    return (page.data ?? [])
      .filter((o) => o.offer?.product.ean === ean)
      .flatMap((o) => (o.metadata?.validationErrors ?? []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e))));
  }

  /** Sets gross prices; falls back to one request per offer when the batch endpoint is missing. */
  async updatePrices(updates: { offerId: string; price: string; currency: string }[]): Promise<void> {
    for (let i = 0; i < updates.length; i += STOCK_BATCH) {
      const batch = updates.slice(i, i + STOCK_BATCH);
      const price = (u: { price: string; currency: string }) => ({ grossPrice: { amount: Number(u.price), currency: u.currency } });
      let commands: CommandDetails[];
      try {
        commands = asCommands(await this.client.call<unknown>('PATCH', this.client.org('/offers/prices'), { body: batch.map((u) => ({ offerId: u.offerId, price: price(u) })) }));
      } catch (err) {
        if (!(err instanceof VonHalskyApiError) || ![404, 405, 501].includes(err.status)) throw err;
        commands = [];
        for (const u of batch) {
          await this.client.call('PATCH', this.client.org(`/offers/${encodeURIComponent(u.offerId)}`), {
            headers: { 'Content-Type': 'application/merge-patch+json' },
            body: JSON.stringify({ price: price(u) }),
          });
        }
      }
      await this.confirm(commands, 'the price update');
    }
  }

  async checkConnection(): Promise<string> {
    const page = await this.client.call<OffersPage>('GET', this.client.org('/offers'), { query: { limit: 1 } });
    return `InPost Von Halsky: ${page.page.total} offer(s) in organisation ${this.client.organizationId.slice(0, 8)}…`;
  }

  /**
   * Orders changed since the cursor (an ISO time). The first sync reads the last N days. The order
   * list is used instead of the event feed, which only keeps 72 hours.
   */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    const since = cursor ?? new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString();
    const orders: NormalizedOrder[] = [];
    let newest = cursor;
    let hasMore = false;
    let offset = 0;
    for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
      const result = await this.client.call<{ page: Page; data: unknown[] }>('GET', this.client.org('/orders'), {
        query: { updatedAtGte: since, sort: 'updatedAt', limit: ORDERS_PAGE, offset },
      });
      for (const raw of result.data) {
        const parsed = vonHalskyOrderSchema.parse(raw);
        if (parsed.updatedAt && (!newest || parsed.updatedAt > newest)) newest = parsed.updatedAt;
        if (isImportable(parsed)) orders.push(mapVonHalskyOrder(raw));
      }
      // Move on by what the page really held, whatever page size the API applied.
      offset += result.data.length;
      if (result.data.length === 0 || offset >= result.page.total) break;
      hasMore = page === MAX_PAGES_PER_SYNC - 1;
    }
    return { orders, nextCursor: newest ?? since, hasMore };
  }

  /** Every order the organisation has, oldest change first. Cursor = offset into that list. */
  async syncHistory(cursor: string | null): Promise<SyncResult> {
    let offset = cursor ? Number(cursor) : 0;
    const orders: NormalizedOrder[] = [];
    let hasMore = true;
    for (let page = 0; page < MAX_PAGES_PER_SYNC && hasMore; page++) {
      const result = await this.client.call<{ page: Page; data: unknown[] }>('GET', this.client.org('/orders'), {
        query: { updatedAtGte: '2000-01-01T00:00:00.000Z', sort: 'updatedAt', limit: ORDERS_PAGE, offset },
      });
      for (const raw of result.data) if (isImportable(vonHalskyOrderSchema.parse(raw))) orders.push(mapVonHalskyOrder(raw));
      offset += result.data.length;
      hasMore = result.data.length > 0 && offset < result.page.total;
    }
    return { orders, nextCursor: hasMore ? String(offset) : null, hasMore };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const raw = await this.client.call<unknown>('GET', this.client.org(`/orders/${encodeURIComponent(externalId)}`));
    return raw ? mapVonHalskyOrder(raw) : null;
  }

  /**
   * Nothing to send: the label is made in InPost's shipping system and linked to the order by the
   * buyer's e-mail address; the order list then shows the parcel.
   */
  async pushTracking(): Promise<void> {}

  async *listListings(): AsyncIterable<Listing> {
    let offset = 0;
    for (;;) {
      const page = await this.client.call<OffersPage>('GET', this.client.org('/offers'), { query: { limit: OFFERS_PAGE, offset } });
      for (const offer of page.data.map(offerOf)) {
        yield {
          externalId: offer.id,
          sku: offer.product.sku || null,
          title: offer.product.name,
          quantity: offer.stock?.quantity ?? null,
          // SOLDOUT is a live offer with no stock; PENDING and the rest are not on sale.
          active: offer.status ? ['PUBLISHED', 'SOLDOUT'].includes(offer.status) : undefined,
          status: offer.status ?? null,
          ean: offer.product.ean ?? null,
          ref: { offerId: offer.id, status: offer.status ?? null, externalId: offer.externalId ?? null, price: offer.price?.grossPrice?.amount ?? null },
        };
      }
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.page.total) return;
    }
  }

  /** Sets absolute stock. InPost runs each update as a command, whose result is checked here. */
  async setStock(updates: StockUpdate[]): Promise<void> {
    for (let i = 0; i < updates.length; i += STOCK_BATCH) {
      const batch = updates.slice(i, i + STOCK_BATCH);
      const stock = (u: StockUpdate) => ({ quantity: Math.max(0, Math.floor(u.quantity)), unit: 'UNIT' });
      let commands: CommandDetails[];
      try {
        commands = await this.client.call<CommandDetails[]>('PATCH', this.client.org('/offers/stocks'), {
          body: batch.map((u) => ({ offerId: u.externalId, stock: stock(u) })),
        });
      } catch (err) {
        // The guide calls the batch endpoint "not implemented yet"; update the offers one by one then.
        if (!(err instanceof VonHalskyApiError) || ![404, 405, 501].includes(err.status)) throw err;
        commands = [];
        for (const u of batch) {
          await this.client.call('PATCH', this.client.org(`/offers/${encodeURIComponent(u.externalId)}`), {
            headers: { 'Content-Type': 'application/merge-patch+json' },
            body: JSON.stringify({ stock: stock(u) }),
          });
        }
      }
      await this.confirm(commands, 'the stock update');
    }
  }

  /** Waits briefly for pending commands; a failed one is reported with InPost's reason. */
  private async confirm(commands: CommandDetails[], what: string): Promise<void> {
    let pending = commands.filter((c) => c.status === 'PENDING');
    const failures: string[] = commands.filter((c) => c.status === 'FAILURE').map((c) => `offer ${c.offerId ?? c.commandId}: rejected`);
    for (let poll = 0; pending.length > 0 && poll < COMMAND_POLLS; poll++) {
      await httpConfig.sleep(800);
      const next: CommandDetails[] = [];
      for (const c of pending) {
        const status = await this.client.call<CommandStatus>('GET', this.client.org(`/offers/commands/${c.commandId}`));
        if (status.status === 'PENDING') next.push(c);
        else if (status.status === 'FAILURE') {
          failures.push(`offer ${c.offerId ?? c.commandId}: ${(status.errors ?? []).map((e) => e.message).join('; ') || 'rejected'}`);
        }
      }
      pending = next;
    }
    if (failures.length) throw new Error(`InPost Von Halsky refused ${what} (${failures.slice(0, 5).join(' | ')}${failures.length > 5 ? ` … +${failures.length - 5}` : ''})`);
  }
}
