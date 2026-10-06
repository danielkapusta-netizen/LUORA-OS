import type { MarketplaceSettings } from '../../../db/schema';
import type { CredentialsStore, FeeKind, Listing, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../../types';
import { invoiceFileName, type ExternalFee, type ExternalRefund, type FeeFeed, type MarketplaceAdapter, type SyncResult } from '../types';
import { AllegroApiError, AllegroClient, type AllegroCredentials } from './client';
import { mapAllegroCheckoutForm } from './mapper';

interface OrderEvent {
  id: string;
  type: string;
  order: { checkoutForm: { id: string } };
}

const RELEVANT_EVENTS = new Set([
  'READY_FOR_PROCESSING',
  'BUYER_CANCELLED',
  'AUTO_CANCELLED',
  'FULFILLMENT_STATUS_CHANGED',
  'BUYER_MODIFIED',
]);
const IMPORTABLE_STATUSES = new Set(['READY_FOR_PROCESSING', 'CANCELLED']);
const EVENTS_LIMIT = 1000;
/** Pages of 100 checkout forms read per history step. */
const HISTORY_PAGES = 5;
/** Cursor used when the account has no order events yet. */
const NO_EVENTS = 'none';

interface BillingEntry {
  id: string;
  occurredAt: string;
  type: { id: string; name: string };
  value: { amount: string; currency: string };
  tax?: { percentage?: string | null } | null;
  order?: { id: string } | null;
}

interface PaymentRefund {
  id: string;
  status?: string | null;
  createdAt: string;
  order?: { id: string } | null;
  lineItems?: { id: string; type?: string | null; quantity?: number | null; value?: { amount: string; currency: string } | null }[] | null;
  delivery?: { value?: { amount: string; currency: string } | null } | null;
  totalValue?: { amount: string; currency: string } | null;
}

/** Sorts an Allegro billing type into a fee kind, by its id where known and otherwise by its Polish name. */
export function allegroFeeKind(typeId: string, name: string): FeeKind {
  const text = `${typeId} ${name}`.toLowerCase();
  if (/\bsuc\b|prowizj|commission/.test(text)) return 'commission';
  if (/dostaw|przesył|wysył|kurier|paczk|smart|delivery|shipping|etykiet/.test(text)) return 'delivery';
  if (/wyróżn|promow|reklam|kampan|\bads\b|podbic|pakiet|baner|strona działu/.test(text)) return 'promotion';
  if (/płatno|transakc|payment/.test(text)) return 'payment';
  return 'other';
}

const BILLING_PAGE = 100;

/** Allegro's catalogue parameter "EAN (GTIN)". */
const EAN_PARAMETER_ID = '225693';

export class AllegroAdapter implements MarketplaceAdapter {
  readonly marketplace = 'allegro' as const;
  readonly client: AllegroClient;

  constructor(
    creds: CredentialsStore<AllegroCredentials>,
    private readonly settings: MarketplaceSettings = {},
  ) {
    this.client = new AllegroClient(creds);
  }

  async checkConnection(): Promise<string> {
    const me = await this.client.call<{ login: string; email?: string }>('GET', '/me');
    return `Allegro: ${me.login}`;
  }

  /**
   * First sync: imports paid, unshipped orders from the last N days, then remembers the
   * newest event id. Later syncs read the order event journal from that id.
   */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    if (cursor === null) return this.initialImport();

    const { events } = await this.client.call<{ events: OrderEvent[] }>('GET', '/order/events', {
      query: { from: cursor === NO_EVENTS ? undefined : cursor, limit: EVENTS_LIMIT },
    });
    const ids = [...new Set(events.filter((e) => RELEVANT_EVENTS.has(e.type)).map((e) => e.order.checkoutForm.id))];
    const orders: NormalizedOrder[] = [];
    for (const id of ids) {
      const form = await this.client.call<{ status: string }>('GET', `/order/checkout-forms/${id}`);
      if (IMPORTABLE_STATUSES.has(form.status)) orders.push(mapAllegroCheckoutForm(form));
    }
    await this.addImages(orders);
    return {
      orders,
      nextCursor: events.at(-1)?.id ?? cursor,
      hasMore: events.length === EVENTS_LIMIT,
    };
  }

  private async initialImport(): Promise<SyncResult> {
    const since = new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString();
    // Read the journal position first so events that arrive during the import are not missed.
    const stats = await this.client.call<{ latestEvent?: { id: string } | null }>('GET', '/order/event-stats');
    const orders: NormalizedOrder[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.client.call<{ checkoutForms: unknown[]; totalCount: number }>('GET', '/order/checkout-forms', {
        query: {
          status: 'READY_FOR_PROCESSING',
          'fulfillment.status': ['NEW', 'PROCESSING'],
          'lineItems.boughtAt.gte': since,
          limit: 100,
          offset,
        },
      });
      orders.push(...page.checkoutForms.map(mapAllegroCheckoutForm));
      if (page.checkoutForms.length < 100 || offset + 100 >= page.totalCount) break;
    }
    await this.addImages(orders);
    return { orders, nextCursor: stats.latestEvent?.id ?? NO_EVENTS, hasMore: false };
  }

  /**
   * Past checkout forms, newest first, in windows by purchase date (Allegro caps offset paging).
   * Photos are not looked up here: past orders take their photo from the product.
   */
  async syncHistory(cursor: string | null): Promise<SyncResult> {
    const before = cursor ?? new Date().toISOString();
    const orders: NormalizedOrder[] = [];
    let oldest = before;
    let hasMore = false;
    for (let offset = 0; offset < HISTORY_PAGES * 100; offset += 100) {
      const page = await this.client.call<{ checkoutForms: { status: string; lineItems?: { boughtAt?: string | null }[] }[]; totalCount: number }>(
        'GET',
        '/order/checkout-forms',
        { query: { 'lineItems.boughtAt.lte': before, sort: '-lineItems.boughtAt', limit: 100, offset } },
      );
      for (const form of page.checkoutForms) {
        for (const li of form.lineItems ?? []) if (li.boughtAt && li.boughtAt < oldest) oldest = li.boughtAt;
        // Unpaid forms (BOUGHT, FILLED_IN) never became orders.
        if (IMPORTABLE_STATUSES.has(form.status)) orders.push(mapAllegroCheckoutForm(form));
      }
      hasMore = page.checkoutForms.length === 100 && offset + 100 < page.totalCount;
      if (!hasMore) break;
    }
    if (!hasMore) return { orders, nextCursor: null, hasMore: false };
    // Continue from the oldest purchase seen; never stand still if a whole window shares one timestamp.
    const next = oldest < before ? oldest : new Date(Date.parse(before) - 1000).toISOString();
    return { orders, nextCursor: next, hasMore: true };
  }

  /**
   * Billing entries (commission, Smart delivery, promotion fees…) and payment refunds booked in a
   * time window. Needs the "billing: read" and "payments: read" permissions of the Allegro app.
   */
  async syncFees(from: Date, to: Date): Promise<FeeFeed> {
    const window = { 'occurredAt.gte': from.toISOString(), 'occurredAt.lte': to.toISOString() };
    const fees: ExternalFee[] = [];
    let unattached = 0;
    for (let offset = 0; ; offset += BILLING_PAGE) {
      const page = await this.client.call<{ billingEntries: BillingEntry[] }>('GET', '/billing/billing-entries', {
        query: { ...window, limit: BILLING_PAGE, offset },
      });
      for (const e of page.billingEntries) {
        if (!e.order?.id) {
          unattached++;
          continue;
        }
        // Allegro books a charge as a negative value and a refund of a charge as a positive one.
        const amount = -Number(e.value.amount);
        if (!amount) continue;
        const percent = Number(e.tax?.percentage ?? NaN);
        fees.push({
          orderExternalId: e.order.id,
          externalId: e.id,
          kind: allegroFeeKind(e.type.id, e.type.name),
          label: e.type.name,
          amount: amount.toFixed(2),
          taxAmount: Number.isFinite(percent) ? ((amount * percent) / (100 + percent)).toFixed(2) : null,
          currency: e.value.currency,
          occurredAt: new Date(e.occurredAt),
        });
      }
      if (page.billingEntries.length < BILLING_PAGE) break;
    }

    const refunds: ExternalRefund[] = [];
    for (let offset = 0; ; offset += BILLING_PAGE) {
      const page = await this.client.call<{ refunds: PaymentRefund[] }>('GET', '/payments/refunds', {
        query: { ...window, limit: BILLING_PAGE, offset },
      });
      for (const r of page.refunds) {
        if (!r.order?.id || (r.status && r.status !== 'SUCCESS')) continue;
        const refundedAt = new Date(r.createdAt);
        const currency = r.totalValue?.currency ?? r.lineItems?.find((l) => l.value)?.value?.currency ?? 'PLN';
        let lines = 0;
        for (const li of r.lineItems ?? []) {
          const value = li.value ? Number(li.value.amount) : null;
          if (value !== null) lines += value;
          refunds.push({
            orderExternalId: r.order.id,
            externalId: `${r.id}:${li.id}`,
            externalLineId: li.id,
            amount: value !== null ? value.toFixed(2) : null,
            currency,
            quantity: li.type === 'QUANTITY' ? (li.quantity ?? null) : null,
            refundedAt,
          });
        }
        // Delivery and anything not split by line (only when every line had a value, so nothing is counted twice).
        const known = (r.lineItems ?? []).every((l) => l.value);
        const rest = r.totalValue && known ? Math.round((Number(r.totalValue.amount) - lines) * 100) / 100 : 0;
        if (rest > 0) refunds.push({ orderExternalId: r.order.id, externalId: r.id, amount: rest.toFixed(2), currency, refundedAt });
      }
      if (page.refunds.length < BILLING_PAGE) break;
    }
    return { fees, refunds, unattached };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const form = await this.client.call<unknown>('GET', `/order/checkout-forms/${externalId}`);
    if (!form) return null;
    const order = mapAllegroCheckoutForm(form);
    await this.addImages([order]);
    return order;
  }

  private imageCache = new Map<string, string | null>();

  /** Checkout forms carry no photos, so each offer's first image is looked up once. */
  private async addImages(orders: NormalizedOrder[]): Promise<void> {
    for (const item of orders.flatMap((o) => o.items)) {
      const offerId = item.externalProductId;
      if (!offerId || item.imageUrl) continue;
      if (!this.imageCache.has(offerId)) {
        try {
          const offer = await this.client.call<{ images?: (string | { url?: string })[] }>('GET', `/sale/product-offers/${offerId}`);
          const first = offer.images?.[0];
          this.imageCache.set(offerId, typeof first === 'string' ? first : (first?.url ?? null));
        } catch {
          // Ended or foreign offers can't be read; the item just has no photo.
          this.imageCache.set(offerId, null);
        }
      }
      item.imageUrl = this.imageCache.get(offerId) ?? null;
    }
  }

  async markProcessing(order: OrderRef): Promise<void> {
    await this.client.call('PUT', `/order/checkout-forms/${order.externalId}/fulfillment`, {
      body: { status: 'PROCESSING' },
      responseType: 'none',
    });
  }

  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    const path = `/order/checkout-forms/${order.externalId}/shipments`;
    const existing = await this.client.call<{ shipments: { waybill: string }[] }>('GET', path);
    // Labels bought through "Wysyłam z Allegro" are attached to the order automatically.
    if (!existing.shipments.some((s) => s.waybill === tracking.trackingNumber)) {
      const carrierId = tracking.carrierCode ?? (tracking.carrier === 'inpost' ? 'INPOST' : 'ALLEGRO');
      await this.client.call('POST', path, {
        body: {
          carrierId,
          waybill: tracking.trackingNumber,
          ...(carrierId === 'OTHER' ? { carrierName: tracking.carrierName } : {}),
          lineItems: order.items.map((i) => ({ id: i.externalLineId })),
        },
      });
    }
    await this.client.call('PUT', `/order/checkout-forms/${order.externalId}/fulfillment`, {
      body: { status: 'SENT' },
      responseType: 'none',
    });
  }

  /** Two steps: create the invoice entry, then upload its PDF. An entry already holding the file is left alone. */
  async uploadInvoice(order: OrderRef, invoice: { number: string; pdf: Buffer }): Promise<void> {
    const path = `/order/checkout-forms/${order.externalId}/invoices`;
    const existing = await this.client.call<{ invoices: { id: string; invoiceNumber?: string | null; file?: { uploadedAt?: string | null } | null }[] }>('GET', path);
    const same = existing.invoices.find((i) => i.invoiceNumber === invoice.number);
    if (same?.file?.uploadedAt) return;
    const id =
      same?.id ??
      (await this.client.call<{ id: string }>('POST', path, { body: { file: { name: invoiceFileName(invoice.number) }, invoiceNumber: invoice.number } })).id;
    await this.client.call('PUT', `${path}/${id}/file`, {
      body: invoice.pdf,
      headers: { 'Content-Type': 'application/pdf' },
      responseType: 'none',
    });
  }

  async *listListings(): AsyncIterable<Listing> {
    for (let offset = 0; ; offset += 1000) {
      const page = await this.client.call<{
        offers: { id: string; name: string; external?: { id?: string | null } | null; stock?: { available?: number } | null }[];
        totalCount: number;
      }>('GET', '/sale/offers', { query: { limit: 1000, offset } });
      for (const offer of page.offers) {
        yield {
          externalId: offer.id,
          sku: offer.external?.id || null,
          title: offer.name,
          quantity: offer.stock?.available ?? null,
          ref: { offerId: offer.id },
        };
      }
      if (page.offers.length < 1000 || offset + 1000 >= page.totalCount) return;
    }
  }

  async listingEans(offerIds: string[]): Promise<Map<string, string | null>> {
    type Parameter = { id?: string; name?: string; values?: string[] };
    type Offer = { productSet?: { product?: { id?: string; parameters?: Parameter[] } }[]; parameters?: Parameter[] };
    const eanOf = (params: Parameter[] | undefined) =>
      params?.find((p) => p.id === EAN_PARAMETER_ID || /\b(ean|gtin)\b/i.test(p.name ?? ''))?.values?.[0] ?? null;
    const readOffer = async (offerId: string): Promise<string | null> => {
      let offer: Offer;
      try {
        offer = await this.client.call<Offer>('GET', `/sale/product-offers/${offerId}`);
      } catch (err) {
        // Offers created without a catalogue product 404 here; the older endpoint still knows them.
        if (!(err instanceof AllegroApiError) || err.status !== 404) throw err;
        offer = await this.client.call<Offer>('GET', `/sale/offers/${offerId}`);
      }
      const product = offer.productSet?.[0]?.product;
      let ean = eanOf(product?.parameters) ?? eanOf(offer.parameters);
      if (!ean && product?.id) {
        try {
          ean = eanOf((await this.client.call<{ parameters?: Parameter[] }>('GET', `/sale/products/${product.id}`)).parameters);
        } catch (err) {
          console.error(`[allegro] catalogue product ${product.id} of offer ${offerId}: ${err instanceof Error ? err.message : err}`);
        }
      }
      return ean;
    };
    const out = new Map<string, string | null>();
    for (const offerId of offerIds) {
      // One offer failing must not stop the others.
      try {
        out.set(offerId, await readOffer(offerId));
      } catch (err) {
        console.error(`[allegro] barcode of offer ${offerId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  async setStock(updates: StockUpdate[]): Promise<void> {
    for (const u of updates) {
      await this.client.call('PATCH', `/sale/product-offers/${u.externalId}`, {
        body: { stock: { available: u.quantity } },
        responseType: 'none',
      });
    }
  }
}
