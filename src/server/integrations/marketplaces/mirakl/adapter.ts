import type { MarketplaceSettings, MiraklOfferField } from '../../../db/schema';
import type { Listing, NormalizedOrder, OrderRef, PriceFailure, PriceUpdate, StockUpdate, TrackingInfo } from '../../types';
import { httpConfig } from '../../../http';
import { invoiceFileName, type CatalogueMatch, type MarketplaceAdapter, type OfferDraft, type OfferPublisher, type SyncResult } from '../types';
import { MiraklClient, type MiraklCarrier, type MiraklCredentials } from './client';
import { mapMiraklOrder, type MiraklProfile } from './mapper';
import { unsourcedRequiredFields } from './offer-fields';

const PAGE = 100;
const MAX_PAGES_PER_SYNC = 10;
const ALREADY_SHIPPED = new Set(['SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED']);

const CARRIER_CACHE_MS = 24 * 3600_000;

const squash = (v: string) => v.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Finds the carrier to send, using the marketplace's own list (SH21).
 * Each candidate may be a code or a label ("PACZKOMATY INPOST"); if none matches,
 * an InPost carrier is picked by label (locker vs courier).
 */
export function resolveMiraklCarrier(
  candidates: (string | null | undefined)[],
  carriers: MiraklCarrier[],
  kind: 'inpostLocker' | 'inpostCourier' | null,
): MiraklCarrier | null {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const exact = carriers.find((c) => c.code === candidate.trim());
    if (exact) return exact;
    const loose = carriers.find((c) => squash(c.code) === squash(candidate) || squash(c.label) === squash(candidate));
    if (loose) return loose;
  }
  // Last resort for a carrier the marketplace lists with a country suffix: "dpd" finds "dpd-pl". The first listed wins.
  for (const candidate of candidates) {
    if (!candidate?.trim() || squash(candidate).length < 3) continue;
    const prefixed = carriers.find((c) => squash(c.code).startsWith(squash(candidate)) || squash(c.label).startsWith(squash(candidate)));
    if (prefixed) return prefixed;
  }
  if (kind) {
    const inpost = carriers.filter((c) => /inpost/i.test(`${c.label} ${c.code}`));
    const wantsLocker = kind === 'inpostLocker';
    const match = inpost.find((c) => /paczkomat/i.test(`${c.label} ${c.code}`) === wantsLocker && (wantsLocker || /kurier/i.test(`${c.label} ${c.code}`)));
    if (match) return match;
    // A marketplace with one InPost carrier that names neither locker nor courier (HEBE's "inpost-pl") means it for both.
    const [only] = inpost;
    if (inpost.length === 1 && !/paczkomat|locker|kurier|courier/i.test(`${only.label} ${only.code}`)) return only;
  }
  return null;
}

interface OrdersPage {
  orders: { order_id: string; order_state: string; last_updated_date: string }[];
  total_count: number;
}

/** Builds the STO01 stock import CSV: one line per offer, global (not per-warehouse) quantity. */
export function buildStockCsv(updates: StockUpdate[]): string {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['"offer-sku";"quantity";"warehouse-code";"update-delete"'];
  for (const u of updates) {
    const sku = String(u.ref.shopSku ?? u.sku ?? '');
    if (!sku) continue;
    lines.push([quote(sku), quote(String(Math.max(0, u.quantity))), '""', '"update"'].join(';'));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * OF01 offer import for one offer, attached to the catalogue product with the same EAN.
 * `state` is the marketplace's offer state code (11 = new on Mirakl). The marketplace's extra offer fields
 * (e.g. the responsible person) go in columns named by their field code.
 */
export function buildOfferCsv(draft: OfferDraft, state: string, leadtimeDays: number): string {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const extra = Object.entries(draft.extraFields ?? {}).filter(([, value]) => value !== '');
  const header = ['sku', 'product-id', 'product-id-type', 'price', 'quantity', 'state', 'leadtime-to-ship', 'update-delete', ...extra.map(([code]) => code)];
  const row = [
    draft.sku,
    draft.ean,
    'EAN',
    draft.price,
    String(Math.max(0, draft.quantity)),
    state,
    String(Math.max(0, leadtimeDays)),
    'update',
    ...extra.map(([, value]) => value),
  ];
  return `${header.map(quote).join(';')}\n${row.map(quote).join(';')}\n`;
}

/**
 * OF01 import that changes only the price of existing offers (import mode PARTIAL leaves every
 * column that is not in the file alone, so descriptions, stock and lead times stay as they are).
 */
export function buildPriceCsv(updates: PriceUpdate[]): string {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [['sku', 'price', 'update-delete'].map(quote).join(';')];
  for (const u of updates) {
    const sku = String(u.ref.shopSku ?? u.sku ?? '');
    if (!sku) continue;
    lines.push([sku, u.price, 'update'].map(quote).join(';'));
  }
  return `${lines.join('\n')}\n`;
}

/** What one Mirakl marketplace needs on top of the shared Seller API. */
export interface MiraklMarketplace extends MiraklProfile {
  marketplace: 'empik' | 'hebe';
  /** The marketplace's documented carrier code for a shipment, sent even when its carrier list can't be read. */
  documentedCarrierCode(tracking: TrackingInfo): string | null;
  /** Also look the carrier up in the marketplace's list by the name the carrier reported ("DPD"). */
  matchCarrierByName: boolean;
}

/** Marketplaces running on Mirakl (Empik, HEBE): one Seller API, a few names that differ. */
export class MiraklAdapter implements MarketplaceAdapter, OfferPublisher {
  readonly marketplace: MiraklMarketplace['marketplace'];
  private readonly client: MiraklClient;
  private readonly baseUrl: string;
  private readonly label: string;

  constructor(
    private readonly market: MiraklMarketplace,
    creds: MiraklCredentials,
    private settings: MarketplaceSettings = {},
    /** Persists settings changes (the SH21 carrier cache). */
    private readonly saveSettings?: (next: MarketplaceSettings) => Promise<void>,
  ) {
    this.marketplace = market.marketplace;
    this.label = market.label;
    this.client = new MiraklClient(creds, market.label);
    this.baseUrl = creds.baseUrl;
  }

  private map(raw: unknown): NormalizedOrder {
    return mapMiraklOrder(raw, this.baseUrl, this.market);
  }

  /** The marketplace's carriers (SH21), cached in the account settings for a day. */
  async carriers(forceRefresh = false): Promise<MiraklCarrier[]> {
    const cache = this.settings.carrierCache;
    if (!forceRefresh && cache && Date.now() - Date.parse(cache.fetchedAt) < CARRIER_CACHE_MS) return cache.carriers;
    const carriers = await this.client.listCarriers();
    this.settings = { ...this.settings, carrierCache: { fetchedAt: new Date().toISOString(), carriers } };
    await this.saveSettings?.(this.settings);
    return carriers;
  }

  /** The marketplace's extra offer fields (AF01), cached in the account settings for a day. */
  async offerFields(forceRefresh = false): Promise<MiraklOfferField[]> {
    const cache = this.settings.offerFieldCache;
    if (!forceRefresh && cache && Date.now() - Date.parse(cache.fetchedAt) < CARRIER_CACHE_MS) return cache.fields;
    const fields = await this.client.listOfferFields();
    this.settings = { ...this.settings, offerFieldCache: { fetchedAt: new Date().toISOString(), fields } };
    await this.saveSettings?.(this.settings);
    return fields;
  }

  /** A01 */
  async checkConnection(): Promise<string> {
    const shop = await this.client.call<{ shop_name?: string; shop_id?: number }>('GET', '/account');
    return `${this.label}: ${shop.shop_name ?? shop.shop_id ?? 'connected'}`;
  }

  /** OR11. Cursor = newest `last_updated_date` already stored. */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    const since = cursor ?? new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString();
    const orders: NormalizedOrder[] = [];
    let newest = since;
    let hasMore = false;

    for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
      const offset = page * PAGE;
      const data = await this.client.call<OrdersPage>('GET', '/orders', {
        query: { start_update_date: since, max: PAGE, offset, paginate: true },
      });
      for (const raw of data.orders) {
        if (raw.last_updated_date > newest) newest = raw.last_updated_date;
        // STAGING orders are still in the marketplace's fraud check and may never reach the seller.
        if (raw.order_state === 'STAGING') continue;
        orders.push(this.map(raw));
      }
      hasMore = offset + data.orders.length < data.total_count;
      if (!hasMore || data.orders.length === 0) break;
    }
    return { orders, nextCursor: newest, hasMore };
  }

  /** OR11 by creation date, newest first. Cursor = { before, offset } of the window being read. */
  async syncHistory(cursor: string | null): Promise<SyncResult> {
    const state: { before: string; offset: number } = cursor ? JSON.parse(cursor) : { before: new Date().toISOString(), offset: 0 };
    const orders: NormalizedOrder[] = [];
    let hasMore = true;
    for (let page = 0; page < MAX_PAGES_PER_SYNC && hasMore; page++) {
      const data = await this.client.call<OrdersPage>('GET', '/orders', {
        query: { end_date: state.before, sort: 'dateCreated', order: 'desc', max: PAGE, offset: state.offset, paginate: true },
      });
      for (const raw of data.orders) {
        if (raw.order_state === 'STAGING') continue;
        orders.push(this.map(raw));
      }
      state.offset += data.orders.length;
      hasMore = data.orders.length > 0 && state.offset < data.total_count;
    }
    return { orders, nextCursor: hasMore ? JSON.stringify(state) : null, hasMore };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const data = await this.client.call<OrdersPage>('GET', '/orders', { query: { order_ids: externalId } });
    return data.orders[0] ? this.map(data.orders[0]) : null;
  }

  /** OR21: accept every line of an order waiting for acceptance. */
  async acceptOrder(order: OrderRef): Promise<void> {
    await this.client.call('PUT', `/orders/${encodeURIComponent(order.externalId)}/accept`, {
      body: { order_lines: order.items.map((i) => ({ accepted: true, id: i.externalLineId })) },
      responseType: 'none',
    });
  }

  /** OR23 tracking, then OR24 to confirm shipment. */
  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    const id = encodeURIComponent(order.externalId);
    const current = await this.client.call<OrdersPage>('GET', '/orders', { query: { order_ids: order.externalId } });
    if (ALREADY_SHIPPED.has(current.orders[0]?.order_state ?? '')) return;

    const body = await this.trackingBody(tracking);
    try {
      await this.client.call('PUT', `/orders/${id}/tracking`, { body, responseType: 'none' });
    } catch (err) {
      throw new Error(`${this.label} rejected the tracking number (OR23, ${JSON.stringify(body)}): ${err instanceof Error ? err.message : err}`);
    }
    try {
      await this.client.call('PUT', `/orders/${id}/ship`, { responseType: 'none' });
    } catch (err) {
      throw new Error(`Tracking saved, but ${this.label} refused to mark the order shipped (OR24): ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Builds the OR23 body with a carrier code that exists in the marketplace's carrier list. */
  private async trackingBody(tracking: TrackingInfo) {
    const isInpost = tracking.carrier === 'inpost' || tracking.carrierCode?.toUpperCase() === 'INPOST';
    const courier = tracking.service === 'inpost_courier_standard' || Boolean(tracking.service?.includes('courier'));
    const kind = isInpost ? (courier ? 'inpostCourier' : 'inpostLocker') : null;
    // The code chosen in settings wins; then the marketplace's documented default.
    const candidates = [kind ? this.settings.carrierCodes?.[kind] : null, this.market.documentedCarrierCode(tracking)];
    // Names are only looked up in the list, never sent as a code. InPost is told apart by locker vs courier below instead.
    const names = this.market.matchCarrierByName && !isInpost ? [tracking.carrierCode, tracking.carrierName] : [];

    let carriers: MiraklCarrier[] = [];
    try {
      carriers = await this.carriers();
    } catch (err) {
      // Carrier list unavailable: fall back to the documented code rather than blocking the shipment.
      console.warn(`[${this.marketplace}] SH21 failed:`, err instanceof Error ? err.message : err);
    }
    if (carriers.length) {
      let match = resolveMiraklCarrier([...candidates, ...names], carriers, kind);
      if (!match) match = resolveMiraklCarrier([...candidates, ...names], await this.carriers(true), kind);
      if (match) return { carrier_code: match.code, tracking_number: tracking.trackingNumber };
      if (isInpost) {
        throw new Error(
          `${this.label} has no carrier matching ${kind === 'inpostCourier' ? 'InPost courier' : 'InPost Paczkomat'}. Codes ${this.label} offers: ${carriers.map((c) => `${c.code} (${c.label})`).join(', ')}`,
        );
      }
    } else if (candidates.some(Boolean)) {
      return { carrier_code: (candidates.find(Boolean) as string).trim(), tracking_number: tracking.trackingNumber };
    }
    // A carrier the marketplace has no code for: send it as an "unregistered" carrier with the tracking link.
    return { carrier_name: tracking.carrierName, carrier_url: tracking.trackingUrl ?? undefined, tracking_number: tracking.trackingNumber };
  }

  /** OR74: attaches the invoice to the order as a CUSTOMER_INVOICE document; skipped if OR72 already lists it. */
  async uploadInvoice(order: OrderRef, invoice: { number: string; pdf: Buffer }): Promise<void> {
    const fileName = invoiceFileName(invoice.number);
    const listed = await this.client.call<{ order_documents?: { file_name: string }[] }>('GET', '/orders/documents', {
      query: { order_ids: order.externalId },
    });
    if (listed.order_documents?.some((d) => d.file_name === fileName)) return;

    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(invoice.pdf)], { type: 'application/pdf' }), fileName);
    form.append(
      'order_documents',
      new Blob([JSON.stringify({ order_documents: [{ file_name: fileName, type_code: 'CUSTOMER_INVOICE' }] })], { type: 'application/json' }),
    );
    const result = await this.client.call<{ errors_count?: number; order_documents?: { errors?: { message?: string }[] }[] }>(
      'POST',
      `/orders/${encodeURIComponent(order.externalId)}/documents`,
      { body: form },
    );
    if (result?.errors_count) {
      const reasons = (result.order_documents ?? []).flatMap((d) => d.errors ?? []).map((e) => e.message).filter(Boolean);
      throw new Error(`${this.label} rejected the invoice (OR74): ${reasons.join('; ') || 'unknown error'}`);
    }
  }

  /** OF21 */
  async *listListings(): AsyncIterable<Listing> {
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.client.call<{
        offers: {
          offer_id: number;
          shop_sku: string;
          product_title: string;
          quantity: number;
          price?: number | string | null;
          currency_iso_code?: string | null;
          active?: boolean;
          product_references?: { reference: string; reference_type: string }[];
        }[];
        total_count: number;
      }>('GET', '/offers', { query: { max: PAGE, offset } });
      for (const offer of page.offers) {
        yield {
          externalId: String(offer.offer_id),
          sku: offer.shop_sku || null,
          title: offer.product_title,
          quantity: offer.quantity,
          active: offer.active,
          status: offer.active === undefined ? null : offer.active ? 'active' : 'inactive',
          ean: offer.product_references?.find((r) => /^(EAN|GTIN|EAN13)$/i.test(r.reference_type))?.reference ?? null,
          ref: { shopSku: offer.shop_sku },
          price: offer.price != null && offer.price !== '' ? Number(offer.price).toFixed(2) : null,
          currency: offer.currency_iso_code ?? null,
        };
      }
      if (page.offers.length < PAGE || offset + PAGE >= page.total_count) return;
    }
  }

  /**
   * STO01 stock import. OF24 is not used on purpose: it resets every offer field that
   * is not sent, which would wipe prices and descriptions.
   */
  async setStock(updates: StockUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const form = new FormData();
    form.append('file', new Blob([buildStockCsv(updates)], { type: 'text/csv' }), 'stock.csv');
    await this.client.call('POST', '/offers/stock/imports', { body: form });
  }

  // ------------------------------------------------------------ creating offers

  /** Required offer fields (read from the marketplace) that have nowhere to take their value from. */
  publishSetupProblems(): string[] {
    return unsourcedRequiredFields(this.settings).map((f) => `choose where "${f.label}" comes from`);
  }

  /**
   * P31: which EANs are products in the marketplace catalogue. Mirakl answers with the products it found,
   * each carrying its own reference as `product_id` + `product_id_type` (not a list of references), and
   * the shape has varied between versions. So a product counts as found when its answer mentions the
   * EAN anywhere; an EAN the batch answer doesn't mention is asked about alone, where any product
   * returned is the match. When the marketplace can't be asked, offers are still tried and its import decides.
   */
  async checkCatalogue(eans: string[]): Promise<Map<string, CatalogueMatch>> {
    type P31 = { products?: Record<string, unknown>[] };
    const ask = async (list: string[]) => (await this.client.call<P31>('GET', '/products', { query: { product_references: list.map((e) => `EAN|${e}`).join(',') } })).products ?? [];
    const titleOf = (p: Record<string, unknown>) => (typeof p.product_title === 'string' ? p.product_title : typeof p.title === 'string' ? p.title : undefined);
    const out = new Map<string, CatalogueMatch>();
    for (let i = 0; i < eans.length; i += 50) {
      const chunk = eans.slice(i, i + 50);
      try {
        const answered = (await ask(chunk)).map((p) => ({ p, text: JSON.stringify(p) }));
        for (const ean of chunk) {
          const hit = answered.find((a) => a.text.includes(`"${ean}"`));
          if (hit) out.set(ean, { found: true, name: titleOf(hit.p) });
        }
        const rest = chunk.filter((e) => !out.has(e));
        for (let j = 0; j < rest.length; j += 5) {
          await Promise.all(
            rest.slice(j, j + 5).map(async (ean) => {
              const one = await ask([ean]);
              out.set(ean, one.length ? { found: true, name: titleOf(one[0]) } : { found: false });
            }),
          );
        }
      } catch {
        for (const ean of chunk) if (!out.has(ean)) out.set(ean, { found: true, unverified: true });
      }
    }
    return out;
  }

  /** OF01 import of one offer; waits briefly for the import's verdict and reports line errors. */
  async createOffer(draft: OfferDraft): Promise<{ externalId?: string; note?: string }> {
    const form = new FormData();
    form.append('file', new Blob([buildOfferCsv(draft, this.settings.empikOfferState ?? '11', this.settings.offerHandlingDays ?? 1)], { type: 'text/csv' }), 'offer.csv');
    form.append('import_mode', 'NORMAL');
    const { import_id: importId } = await this.client.call<{ import_id: number | string }>('POST', '/offers/imports', { body: form });
    const outcome = await this.awaitImport(importId, 'the offer');
    return outcome.done ? { externalId: draft.sku } : { externalId: draft.sku, note: `${this.label} is still processing import ${importId}` };
  }

  /** Waits briefly for an offer import's verdict. Throws with the marketplace's reasons when it refuses; `done: false` when it is still running. */
  private async awaitImport(importId: number | string, what: string): Promise<{ done: boolean }> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await httpConfig.sleep(1000);
      const status = await this.client.call<{ status?: string; lines_in_error?: number; has_error_report?: boolean }>('GET', `/offers/imports/${importId}`);
      if (status.status === 'COMPLETE' || status.status === 'FAILED' || status.status === 'CANCELLED') {
        if (status.status !== 'COMPLETE' || (status.lines_in_error ?? 0) > 0 || status.has_error_report) {
          let reason = `import ${status.status?.toLowerCase()}`;
          try {
            const report = await this.client.call<string>('GET', `/offers/imports/${importId}/error_report`, { responseType: 'text' });
            const lines = report.trim().split('\n').slice(1).filter(Boolean);
            if (lines.length) reason = lines.join(' | ').replace(/"/g, '').slice(0, 400);
          } catch {
            // The report is optional; the status already says it failed.
          }
          throw new Error(`${this.label} refused ${what}: ${reason}`);
        }
        return { done: true };
      }
    }
    return { done: false };
  }

  /**
   * Changes prices with a partial OF01 import. Mirakl answers per file, not per offer, so a refused
   * import is reported on every offer in it; one that is still processing counts as sent.
   */
  async setPrices(updates: PriceUpdate[]): Promise<PriceFailure[]> {
    const sendable = updates.filter((u) => u.ref.shopSku ?? u.sku);
    const failures: PriceFailure[] = updates
      .filter((u) => !sendable.includes(u))
      .map((u) => ({ externalId: u.externalId, message: `The ${this.label} offer has no SKU, so it cannot be updated` }));
    if (sendable.length === 0) return failures;
    const form = new FormData();
    form.append('file', new Blob([buildPriceCsv(sendable)], { type: 'text/csv' }), 'prices.csv');
    form.append('import_mode', 'PARTIAL');
    const { import_id: importId } = await this.client.call<{ import_id: number | string }>('POST', '/offers/imports', { body: form });
    try {
      await this.awaitImport(importId, 'the price update');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const u of sendable) failures.push({ externalId: u.externalId, message });
    }
    return failures;
  }
}
