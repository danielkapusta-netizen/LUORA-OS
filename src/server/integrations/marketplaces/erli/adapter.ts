// Erli.pl marketplace: orders (through Erli's change feed), stock and prices, tracking, fees and new offers.
// API: https://erli.pl/svc/shop-api/doc/ . Amounts are in grosze; products are keyed by our own externalId.
import type { MarketplaceSettings } from '../../../db/schema';
import type { FeeKind, Listing, NormalizedOrder, OrderRef, PriceFailure, PriceUpdate, StockFailure, StockUpdate, TrackingInfo } from '../../types';
import type { CatalogueMatch, ExternalFee, FeeFeed, MarketplaceAdapter, OfferDraft, OfferPublisher, SyncResult } from '../types';
import { allegroDescriptionBlocks, allegroTitle } from '../allegro/offer-content';
import { ErliApiError, ErliClient, type ErliCredentials } from './client';
import { fromGrosze, mapErliOrder, toGrosze, type ErliOrder } from './mapper';

/** Orders read per page (Erli allows up to 200). */
const PAGE = 100;
/** Pages read per sync call; the rest follows in the next call. */
const MAX_PAGES = 5;
/** Products changed per batch call. */
const BATCH = 100;

type SyncCursor =
  /** The first import: orders created since `since`, continuing after `after`. */
  | { mode: 'initial'; since: string; after?: string }
  /** Erli's change feed; `ack` holds the messages to mark read before reading more (they were stored by then). */
  | { mode: 'changes'; ack?: { lastMessageId: string; ids: string[] } };

interface ChangeMessage {
  id: string;
  created: string;
  type: string;
  payload?: { id?: string } | null;
}

interface ErliProduct {
  externalId: string;
  name?: string;
  ean?: string;
  sku?: string;
  stock?: number;
  price?: number;
  currency?: string;
  status?: 'active' | 'inactive';
  archived?: boolean;
  images?: { url: string }[];
  buyableProblems?: unknown[];
  updated?: string;
}

/** The carrier name Erli knows for a shipment of ours. */
export function erliVendor(tracking: TrackingInfo): string {
  const text = `${tracking.carrier} ${tracking.carrierCode ?? ''} ${tracking.carrierName}`.toLowerCase();
  if (tracking.carrier === 'inpost' || text.includes('inpost')) return 'inpost';
  if (text.includes('dpd')) return 'dpd';
  if (text.includes('dhl')) return 'dhl';
  if (text.includes('orlen') || text.includes('ruch')) return 'orlen';
  if (text.includes('gls')) return 'gls';
  if (text.includes('ups')) return 'ups';
  if (text.includes('fedex')) return 'fedex';
  if (text.includes('pocztex')) return 'pocztex24';
  if (text.includes('poczta')) return 'pocztaPolska';
  return 'inpost';
}

/** Sorts an Erli billing entry into a fee kind by its type and description. */
export function erliFeeKind(type: string, description: string): FeeKind {
  const text = `${type} ${description}`.toLowerCase();
  if (/commission|prowizj/.test(text)) return 'commission';
  if (/deliver|dostaw|przesył|shipping|parcel|paczk/.test(text)) return 'delivery';
  if (/campaign|kampan|promo|reklam|ads/.test(text)) return 'promotion';
  if (/payment|płatno|payu/.test(text)) return 'payment';
  return 'other';
}

/** Erli's VAT rate code for a fraction (0.23 → "TAX_23"). */
export function erliTaxRate(rate: number): string {
  const percent = Math.round(rate * 100);
  return [0, 5, 8, 23].includes(percent) ? `TAX_${percent}` : 'TAX_23';
}

/** Allegro's data reused for an Erli product: category, filled parameters and the catalogue product. */
export interface ErliProductData {
  /** Allegro category id, or the Shopify product type when there is no Allegro category. */
  category: { source: 'allegro'; id: string } | { source: 'shop'; name: string } | null;
  attributes: { source: 'allegro'; id: string; type: 'dictionary' | 'string' | 'number'; values: (string | number | { id: string })[] }[];
  allegroProductId?: string;
}

export class ErliAdapter implements MarketplaceAdapter, OfferPublisher {
  readonly marketplace = 'erli' as const;
  readonly client: ErliClient;

  constructor(
    creds: ErliCredentials,
    private readonly settings: MarketplaceSettings = {},
  ) {
    this.client = new ErliClient(creds);
  }

  async checkConnection(): Promise<string> {
    const me = await this.client.call<{ name: string; active: boolean; scopes?: string[] }>('GET', '/me');
    const missing = me.scopes ? ['product', 'order'].filter((s) => !me.scopes!.includes(s)) : [];
    const notes = [!me.active ? 'shop is not active yet' : null, missing.length ? `the API key lacks: ${missing.join(', ')}` : null].filter(Boolean);
    return `Erli: ${me.name}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  }

  private async searchOrders(order: 'ASC' | 'DESC', after: string | undefined, filter?: unknown): Promise<ErliOrder[]> {
    return this.client.call<ErliOrder[]>('POST', '/orders/_search', {
      body: { pagination: { sortField: 'created', order, limit: PAGE, ...(after ? { after } : {}) }, ...(filter ? { filter } : {}) },
    });
  }

  /**
   * First: the orders created in the last `initialSyncDays`. Then Erli's change feed: each changed order is read
   * again, and the messages are marked read at the start of the next call, once the orders have been stored.
   */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    let state: SyncCursor = cursor ? (JSON.parse(cursor) as SyncCursor) : { mode: 'initial', since: new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString() };

    if (state.mode === 'initial') {
      const orders: NormalizedOrder[] = [];
      let after = state.after;
      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = await this.searchOrders('ASC', after, { field: 'created', operator: '>=', value: state.since });
        orders.push(...batch.map(mapErliOrder));
        if (batch.length < PAGE) {
          // Done: changes from now on come from the feed (it also holds these orders' messages; storing again is harmless).
          return { orders, nextCursor: JSON.stringify({ mode: 'changes' } satisfies SyncCursor), hasMore: false };
        }
        after = batch.at(-1)!.cursor ?? batch.at(-1)!.created;
      }
      return { orders, nextCursor: JSON.stringify({ ...state, after } satisfies SyncCursor), hasMore: true };
    }

    if (state.ack) {
      await this.client.call('POST', '/orders/changes/mark-read', { body: state.ack, responseType: 'none' });
      state = { mode: 'changes' };
    }
    const messages = await this.client.call<ChangeMessage[]>('POST', '/orders/changes/_search', { body: {} });
    const ids = [...new Set(messages.map((m) => m.payload?.id).filter((id): id is string => Boolean(id)))];
    const orders: NormalizedOrder[] = [];
    for (const id of ids) {
      const order = await this.getOrder(id);
      if (order) orders.push(order);
    }
    const last = messages.at(-1);
    return {
      orders,
      nextCursor: JSON.stringify((last ? { mode: 'changes', ack: { lastMessageId: last.id, ids: messages.map((m) => m.id) } } : { mode: 'changes' }) satisfies SyncCursor),
      hasMore: messages.length >= 500,
    };
  }

  /** Past orders, newest first. Cursor = Erli's pagination cursor of the last order read. */
  async syncHistory(cursor: string | null): Promise<SyncResult> {
    const orders: NormalizedOrder[] = [];
    let after = cursor ?? undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.searchOrders('DESC', after);
      orders.push(...batch.map(mapErliOrder));
      if (batch.length < PAGE) return { orders, nextCursor: null, hasMore: false };
      after = batch.at(-1)!.cursor ?? batch.at(-1)!.created;
    }
    return { orders, nextCursor: after ?? null, hasMore: true };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    try {
      return mapErliOrder(await this.client.call<ErliOrder>('GET', `/orders/${encodeURIComponent(externalId)}`));
    } catch (err) {
      if (err instanceof ErliApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Tells Erli the order is being prepared. */
  async markProcessing(order: OrderRef): Promise<void> {
    await this.client.call('PATCH', `/orders/${encodeURIComponent(order.externalId)}/status`, { body: { status: 'inProgress' }, responseType: 'none' });
  }

  /** Reports our parcel (an "external parcel" in Erli) with its tracking number, then marks the order sent. Safe to repeat. */
  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    const id = encodeURIComponent(order.externalId);
    const current = await this.client.call<ErliOrder>('GET', `/orders/${id}`);
    const known = current.deliveryTracking?.trackingNumber === tracking.trackingNumber;
    if (!known) {
      try {
        await this.client.call('POST', '/shipping/external', { body: [{ orderId: order.externalId, vendor: erliVendor(tracking), trackingNumber: tracking.trackingNumber }] });
      } catch (err) {
        throw new Error(`Erli refused the tracking number: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!['sent', 'readyToPickup', 'received'].includes(current.sellerStatus ?? '')) {
      await this.client.call('PATCH', `/orders/${id}/status`, { body: { status: 'sent' }, responseType: 'none' });
    }
  }

  async *listListings(): AsyncIterable<Listing> {
    let after: string | undefined;
    for (;;) {
      const page = await this.client.call<ErliProduct[]>('POST', '/products/_search', {
        body: {
          pagination: { sortField: 'externalId', order: 'ASC', limit: 200, ...(after ? { after } : {}) },
          // Erli returns only the fields asked for, the product's own id included.
          fields: ['externalId', 'name', 'ean', 'sku', 'stock', 'price', 'currency', 'status', 'archived', 'images'],
        },
      });
      for (const p of page) {
        if (!p.externalId || p.archived) continue;
        const active = p.status !== 'inactive';
        yield {
          externalId: p.externalId,
          sku: p.sku || p.externalId,
          title: p.name ?? p.externalId,
          quantity: p.stock ?? null,
          active,
          status: p.status ?? null,
          ean: p.ean || null,
          ref: { externalId: p.externalId },
          imageUrl: p.images?.[0]?.url ?? null,
          price: p.price !== undefined ? fromGrosze(p.price) : null,
          currency: p.currency ?? 'PLN',
        };
      }
      const last = page.at(-1)?.externalId;
      // Without the last id the next page can't be asked for; stop rather than read the first page again.
      if (page.length < 200 || !last || last === after) return;
      after = last;
    }
  }

  /** One batch call per 100 products; Erli answers per product, so a refused one fails alone. */
  private async batchUpdate(updates: { externalId: string; [field: string]: unknown }[]): Promise<Map<string, { message: string; gone: boolean }>> {
    const failed = new Map<string, { message: string; gone: boolean }>();
    for (let i = 0; i < updates.length; i += BATCH) {
      const chunk = updates.slice(i, i + BATCH);
      const results = await this.client.call<{ externalId: string; status: number; error?: { message?: string; polishMessage?: string } }[]>('PATCH', '/products/batch-update', { body: chunk });
      for (const r of results ?? []) {
        if (r.status >= 200 && r.status < 300) continue;
        failed.set(r.externalId, { message: `Erli (HTTP ${r.status}): ${r.error?.polishMessage || r.error?.message || 'refused'}`, gone: r.status === 404 });
      }
    }
    return failed;
  }

  async setStock(updates: StockUpdate[]): Promise<StockFailure[]> {
    const failed = await this.batchUpdate(updates.map((u) => ({ externalId: u.externalId, stock: Math.max(0, u.quantity) })));
    return [...failed].map(([externalId, f]) => ({ externalId, message: f.message, gone: f.gone }));
  }

  async setPrices(updates: PriceUpdate[]): Promise<PriceFailure[]> {
    const failed = await this.batchUpdate(updates.map((u) => ({ externalId: u.externalId, price: toGrosze(u.price) })));
    return [...failed].map(([externalId, f]) => ({ externalId, message: f.message }));
  }

  /** Erli's billing entries (commission, delivery, campaigns) for orders, between two times. */
  async syncFees(from: Date, to: Date): Promise<FeeFeed> {
    type Entry = { id: number; occurredAt: string; type: string; description: string; amount: number; orderId?: string; currency: string };
    const fees: ExternalFee[] = [];
    let unattached = 0;
    let after: number | undefined;
    for (let page = 0; page < 50; page++) {
      const entries = await this.client.call<Entry[]>('POST', '/billing/company/entries', {
        body: {
          pagination: { sortField: 'id', order: 'DESC', limit: 200, ...(after !== undefined ? { after } : {}) },
          simpleFilter: { fromOccurredAt: from.toISOString(), toOccurredAt: to.toISOString() },
        },
      });
      for (const e of entries) {
        const kind = erliFeeKind(e.type, e.description);
        // Erli books a charge as a negative amount; positive entries are payouts or rebates, counted only for known fee kinds.
        if (!e.orderId || (e.amount > 0 && kind === 'other')) {
          unattached++;
          continue;
        }
        const amount = -e.amount / 100;
        if (!amount) continue;
        fees.push({
          orderExternalId: e.orderId,
          externalId: String(e.id),
          kind,
          label: e.description || e.type,
          amount: amount.toFixed(2),
          taxAmount: ((amount * 23) / 123).toFixed(2),
          currency: e.currency,
          occurredAt: new Date(e.occurredAt),
        });
      }
      if (entries.length < 200) break;
      after = entries.at(-1)!.id;
    }
    return { fees, refunds: [], unattached };
  }

  // ------------------------------------------------------------ creating offers

  publishSetupProblems(): string[] {
    return [];
  }

  /** Erli has no catalogue to look a barcode up in: every product is created as a new Erli product. */
  async checkCatalogue(eans: string[]): Promise<Map<string, CatalogueMatch>> {
    return new Map(eans.map((e) => [e, { found: false }]));
  }

  /** Creates the product on Erli (asynchronous: Erli checks it within minutes). An existing one counts as done. */
  async createOffer(draft: OfferDraft): Promise<{ externalId?: string; note?: string }> {
    const s = this.settings;
    const title = allegroTitle(draft.name);
    if (!title.ok) throw new Error(title.problem);
    if (!draft.imageUrls.length) throw new Error('Erli needs at least one photo');
    const blocks = allegroDescriptionBlocks(draft.descriptionHtml);
    const data = draft.erli;
    const body = {
      name: title.title,
      ean: draft.ean,
      ...(draft.sku !== draft.ean ? { sku: draft.sku } : {}),
      ...(blocks.length ? { description: { sections: chunkSections(blocks) } } : {}),
      images: draft.imageUrls.slice(0, 16).map((url) => ({ url })),
      price: toGrosze(draft.price),
      stock: Math.max(0, draft.quantity),
      status: s.erliCreateInactive ? 'inactive' : 'active',
      dispatchTime: { period: Math.max(1, s.offerHandlingDays ?? 1) },
      ...(s.erliPriceList ? { deliveryPriceList: s.erliPriceList } : {}),
      ...(draft.weightGrams ? { weight: draft.weightGrams } : {}),
      ...(s.erliTaxRate ? { taxRate: s.erliTaxRate } : {}),
      ...(data?.category
        ? {
            externalCategories: [
              data.category.source === 'allegro'
                ? { source: 'allegro', breadcrumb: [{ id: data.category.id }] }
                : { source: 'shop', breadcrumb: [{ id: data.category.name, name: data.category.name }] },
            ],
          }
        : {}),
      ...(data?.attributes.length ? { externalAttributes: data.attributes } : {}),
      ...(data?.allegroProductId ? { externalReferences: [{ id: data.allegroProductId, kind: 'allegro' }] } : {}),
      // Erli's own dictionary ids of the GPSR responsible person and producer.
      ...(draft.responsiblePersonId ? { responsiblePersonId: Number(draft.responsiblePersonId) } : {}),
      ...(draft.responsibleProducerId ? { producerId: Number(draft.responsibleProducerId) } : {}),
    };
    try {
      await this.client.call('POST', `/products/${encodeURIComponent(draft.sku)}`, { body, responseType: 'none' });
    } catch (err) {
      if (err instanceof ErliApiError && err.status === 409) return { externalId: draft.sku, note: 'already on Erli, linked' };
      throw err;
    }
    return { externalId: draft.sku, note: 'Erli is processing the product (up to 20 minutes)' };
  }

  /** Erli's lists for the settings page: delivery price lists and the GPSR responsible persons and producers. */
  async publishOptions(): Promise<{ priceLists: { id: string; name: string }[]; responsiblePersons: { id: string; name: string }[]; responsibleProducers: { id: string; name: string }[] }> {
    type Named = { id: number; name: string };
    const [lists, persons, producers] = await Promise.all([
      this.client.call<Named[]>('GET', '/delivery/priceLists'),
      this.client.call<Named[]>('GET', '/dictionaries/responsiblePersons'),
      this.client.call<Named[]>('GET', '/dictionaries/responsibleProducers'),
    ]);
    const pick = (items: Named[] | undefined) => (items ?? []).map((i) => ({ id: String(i.id), name: i.name }));
    return {
      // The default price list is called "*"; products name a price list by its name.
      priceLists: (lists ?? []).map((l) => ({ id: l.name, name: l.name === '*' ? 'default (*)' : l.name })),
      responsiblePersons: pick(persons),
      responsibleProducers: pick(producers),
    };
  }
}

/** Erli's description sections: one TEXT item each, kept small. */
function chunkSections(blocks: string[]): { items: { type: 'TEXT'; content: string }[] }[] {
  const sections: { items: { type: 'TEXT'; content: string }[] }[] = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length > 8000) {
      sections.push({ items: [{ type: 'TEXT', content: current }] });
      current = '';
    }
    current += block;
  }
  if (current) sections.push({ items: [{ type: 'TEXT', content: current }] });
  return sections.slice(0, 50);
}
