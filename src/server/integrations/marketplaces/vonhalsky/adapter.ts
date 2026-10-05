import type { MarketplaceSettings } from '../../../db/schema';
import { httpConfig } from '../../../http';
import type { CredentialsStore, Listing, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../../types';
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

interface OffersPage {
  page: Page;
  data: {
    id: string;
    status?: string;
    externalId?: string | null;
    product: { name: string; sku?: string | null; ean?: string | null };
    stock?: { quantity: number } | null;
  }[];
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

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const raw = await this.client.call<unknown>('GET', this.client.org(`/orders/${encodeURIComponent(externalId)}`));
    return raw ? mapVonHalskyOrder(raw) : null;
  }

  /**
   * Nothing to send: the label is made in InPost's shipping system and linked to the order by the
   * buyer's e-mail address; the order list then shows the parcel.
   */
  async pushTracking(_order: OrderRef, _tracking: TrackingInfo): Promise<void> {}

  async *listListings(): AsyncIterable<Listing> {
    let offset = 0;
    for (;;) {
      const page = await this.client.call<OffersPage>('GET', this.client.org('/offers'), { query: { limit: OFFERS_PAGE, offset } });
      for (const offer of page.data) {
        yield {
          externalId: offer.id,
          sku: offer.product.sku || null,
          title: offer.product.name,
          quantity: offer.stock?.quantity ?? null,
          ean: offer.product.ean ?? null,
          ref: { offerId: offer.id, status: offer.status ?? null },
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
      await this.confirm(commands);
    }
  }

  /** Waits briefly for pending commands; a failed one is reported with InPost's reason. */
  private async confirm(commands: CommandDetails[]): Promise<void> {
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
    if (failures.length) throw new Error(`InPost Von Halsky refused the stock update (${failures.slice(0, 5).join(' | ')}${failures.length > 5 ? ` … +${failures.length - 5}` : ''})`);
  }
}
