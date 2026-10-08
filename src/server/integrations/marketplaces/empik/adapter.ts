import type { MarketplaceSettings } from '../../../db/schema';
import type { Listing, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../../types';
import { httpConfig } from '../../../http';
import { invoiceFileName, type CatalogueMatch, type MarketplaceAdapter, type OfferDraft, type OfferPublisher, type SyncResult } from '../types';
import { MiraklClient, type EmpikCredentials, type MiraklCarrier } from './client';
import { mapMiraklOrder } from './mapper';

const PAGE = 100;
const MAX_PAGES_PER_SYNC = 10;
const ALREADY_SHIPPED = new Set(['SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED']);

/**
 * Empik's registered carrier codes (EmpikPlace help: "Kodowanie przewoźników").
 * Empik needs `carrier_code` from this list; a free-text carrier name is not accepted.
 */
export const EMPIK_CARRIER_CODES = {
  inpostLocker: 'paczkomatyinpost',
  inpostCourier: 'inpostpaczkakurierska',
  dpd: 'dpd',
  dhl: 'dhl',
  ups: 'ups',
  gls: 'gls',
  fedex: 'fedex',
  pocztex: 'pocztex',
  orlen: 'ORLEN',
} as const;

/** Carrier ids reported by Allegro Delivery → Empik code. */
const BY_CARRIER_ID: Record<string, string> = {
  DPD: EMPIK_CARRIER_CODES.dpd,
  DHL: EMPIK_CARRIER_CODES.dhl,
  UPS: EMPIK_CARRIER_CODES.ups,
  GLS: EMPIK_CARRIER_CODES.gls,
  FEDEX: EMPIK_CARRIER_CODES.fedex,
  POCZTA_POLSKA: EMPIK_CARRIER_CODES.pocztex,
  POCZTEX: EMPIK_CARRIER_CODES.pocztex,
  ORLEN: EMPIK_CARRIER_CODES.orlen,
  ORLEN_PACZKA: EMPIK_CARRIER_CODES.orlen,
};

const CARRIER_CACHE_MS = 24 * 3600_000;

const squash = (v: string) => v.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Finds the Empik carrier to send, using Empik's own list (SH21).
 * Each candidate may be a code or a label ("PACZKOMATY INPOST"); if none matches,
 * an InPost carrier is picked by label (locker vs courier).
 */
export function resolveEmpikCarrier(
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
  if (kind) {
    const inpost = carriers.filter((c) => /inpost/i.test(`${c.label} ${c.code}`));
    const wantsLocker = kind === 'inpostLocker';
    const match = inpost.find((c) => /paczkomat/i.test(`${c.label} ${c.code}`) === wantsLocker && (wantsLocker || /kurier/i.test(`${c.label} ${c.code}`)));
    if (match) return match;
  }
  return null;
}

/** Picks Empik's carrier code for a shipment; null when Empik has no code for it. */
export function empikCarrierCode(tracking: TrackingInfo): string | null {
  if (tracking.carrier === 'inpost') {
    return tracking.service === 'inpost_courier_standard' ? EMPIK_CARRIER_CODES.inpostCourier : EMPIK_CARRIER_CODES.inpostLocker;
  }
  const id = tracking.carrierCode?.toUpperCase() ?? '';
  if (id === 'INPOST') return tracking.service?.includes('courier') ? EMPIK_CARRIER_CODES.inpostCourier : EMPIK_CARRIER_CODES.inpostLocker;
  return BY_CARRIER_ID[id] ?? null;
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
 * `state` is the marketplace's offer state code (11 = new on Mirakl).
 */
export function buildOfferCsv(draft: OfferDraft, state: string, leadtimeDays: number): string {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ['sku', 'product-id', 'product-id-type', 'price', 'quantity', 'state', 'leadtime-to-ship', 'update-delete'];
  const row = [draft.sku, draft.ean, 'EAN', draft.price, String(Math.max(0, draft.quantity)), state, String(Math.max(0, leadtimeDays)), 'update'];
  return `${header.map(quote).join(';')}\n${row.map(quote).join(';')}\n`;
}

export class EmpikAdapter implements MarketplaceAdapter, OfferPublisher {
  readonly marketplace = 'empik' as const;
  private readonly client: MiraklClient;
  private readonly baseUrl: string;

  constructor(
    creds: EmpikCredentials,
    private settings: MarketplaceSettings = {},
    /** Persists settings changes (the SH21 carrier cache). */
    private readonly saveSettings?: (next: MarketplaceSettings) => Promise<void>,
  ) {
    this.client = new MiraklClient(creds);
    this.baseUrl = creds.baseUrl;
  }

  /** Empik's carriers (SH21), cached in the account settings for a day. */
  async carriers(forceRefresh = false): Promise<MiraklCarrier[]> {
    const cache = this.settings.carrierCache;
    if (!forceRefresh && cache && Date.now() - Date.parse(cache.fetchedAt) < CARRIER_CACHE_MS) return cache.carriers;
    const carriers = await this.client.listCarriers();
    this.settings = { ...this.settings, carrierCache: { fetchedAt: new Date().toISOString(), carriers } };
    await this.saveSettings?.(this.settings);
    return carriers;
  }

  async checkConnection(): Promise<string> {
    const shop = await this.client.call<{ shop_name?: string; shop_id?: number }>('GET', '/account');
    return `Empik: ${shop.shop_name ?? shop.shop_id ?? 'connected'}`;
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
        // STAGING orders are still in Empik's fraud check and may never reach the seller.
        if (raw.order_state === 'STAGING') continue;
        orders.push(mapMiraklOrder(raw, this.baseUrl));
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
        orders.push(mapMiraklOrder(raw, this.baseUrl));
      }
      state.offset += data.orders.length;
      hasMore = data.orders.length > 0 && state.offset < data.total_count;
    }
    return { orders, nextCursor: hasMore ? JSON.stringify(state) : null, hasMore };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const data = await this.client.call<OrdersPage>('GET', '/orders', { query: { order_ids: externalId } });
    return data.orders[0] ? mapMiraklOrder(data.orders[0], this.baseUrl) : null;
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
      throw new Error(`Empik rejected the tracking number (OR23, ${JSON.stringify(body)}): ${err instanceof Error ? err.message : err}`);
    }
    try {
      await this.client.call('PUT', `/orders/${id}/ship`, { responseType: 'none' });
    } catch (err) {
      throw new Error(`Tracking saved, but Empik refused to mark the order shipped (OR24): ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Builds the OR23 body with a carrier code that exists in Empik's carrier list. */
  private async trackingBody(tracking: TrackingInfo) {
    const isInpost = tracking.carrier === 'inpost' || tracking.carrierCode?.toUpperCase() === 'INPOST';
    const courier = tracking.service === 'inpost_courier_standard' || Boolean(tracking.service?.includes('courier'));
    const kind = isInpost ? (courier ? 'inpostCourier' : 'inpostLocker') : null;
    // The code chosen in settings wins; then Empik's documented default.
    const candidates = [kind ? this.settings.carrierCodes?.[kind] : null, empikCarrierCode(tracking)];

    let carriers: MiraklCarrier[] = [];
    try {
      carriers = await this.carriers();
    } catch (err) {
      // Carrier list unavailable: fall back to the documented code rather than blocking the shipment.
      console.warn('[empik] SH21 failed:', err instanceof Error ? err.message : err);
    }
    if (carriers.length) {
      let match = resolveEmpikCarrier(candidates, carriers, kind);
      if (!match) match = resolveEmpikCarrier(candidates, await this.carriers(true), kind);
      if (match) return { carrier_code: match.code, tracking_number: tracking.trackingNumber };
      if (isInpost) {
        throw new Error(`Empik has no carrier matching ${kind === 'inpostCourier' ? 'InPost courier' : 'InPost Paczkomat'}. Codes Empik offers: ${carriers.map((c) => `${c.code} (${c.label})`).join(', ')}`);
      }
    } else if (candidates.some(Boolean)) {
      return { carrier_code: (candidates.find(Boolean) as string).trim(), tracking_number: tracking.trackingNumber };
    }
    // A carrier Empik has no code for: send it as an "unregistered" carrier with the tracking link.
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
      throw new Error(`Empik rejected the invoice (OR74): ${reasons.join('; ') || 'unknown error'}`);
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

  publishSetupProblems(): string[] {
    return [];
  }

  /** P31: which EANs are products in the Empik catalogue. When Empik can't be asked, offers are still tried and its import decides. */
  async checkCatalogue(eans: string[]): Promise<Map<string, CatalogueMatch>> {
    const out = new Map<string, CatalogueMatch>();
    for (let i = 0; i < eans.length; i += 50) {
      const chunk = eans.slice(i, i + 50);
      try {
        const data = await this.client.call<{ products?: { product_title?: string; product_references?: { reference_type?: string; reference?: string }[] }[] }>('GET', '/products', {
          query: { product_references: chunk.map((e) => `EAN|${e}`).join(',') },
        });
        const known = new Map<string, string | undefined>();
        for (const p of data.products ?? []) for (const r of p.product_references ?? []) if (r.reference) known.set(r.reference, p.product_title);
        for (const ean of chunk) out.set(ean, known.has(ean) ? { found: true, name: known.get(ean) } : { found: false });
      } catch {
        for (const ean of chunk) out.set(ean, { found: true, unverified: true });
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
          throw new Error(`Empik refused the offer: ${reason}`);
        }
        return { externalId: draft.sku };
      }
    }
    return { externalId: draft.sku, note: `Empik is still processing import ${importId}` };
  }
}
