import { z } from 'zod';
import { formatPostalCode } from '../../address';
import { splitTaxId, type InvoiceRequest, type NormalizedFee, type NormalizedOrder, type NormalizedRefund } from '../../types';

export const miraklOrderSchema = z.object({
  order_id: z.string(),
  commercial_id: z.string().nullish(),
  order_state: z.string(),
  created_date: z.string(),
  last_updated_date: z.string(),
  customer_debited_date: z.string().nullish(),
  currency_iso_code: z.string(),
  total_price: z.number(),
  shipping_price: z.number().nullish(),
  shipping_type_code: z.string().nullish(),
  shipping_type_label: z.string().nullish(),
  shipping_pudo_id: z.string().nullish(),
  payment_type: z.string().nullish(),
  customer_notification_email: z.string().nullish(),
  order_additional_fields: z.array(z.object({ code: z.string(), value: z.string().nullish() })).nullish(),
  customer: z.object({
    firstname: z.string().nullish(),
    lastname: z.string().nullish(),
    billing_address: z
      .object({
        firstname: z.string().nullish(),
        lastname: z.string().nullish(),
        company: z.string().nullish(),
        street_1: z.string().nullish(),
        street_2: z.string().nullish(),
        zip_code: z.string().nullish(),
        city: z.string().nullish(),
        country_iso_code: z.string().nullish(),
      })
      .nullish(),
    shipping_address: z
      .object({
        firstname: z.string().nullish(),
        lastname: z.string().nullish(),
        company: z.string().nullish(),
        street_1: z.string().nullish(),
        street_2: z.string().nullish(),
        zip_code: z.string().nullish(),
        city: z.string().nullish(),
        country_iso_code: z.string().nullish(),
        phone: z.string().nullish(),
      })
      .nullish(),
  }),
  order_lines: z.array(
    z.object({
      order_line_id: z.string(),
      offer_id: z.number().nullish(),
      offer_sku: z.string().nullish(),
      product_title: z.string(),
      quantity: z.number().int(),
      /** Line total without shipping. */
      price: z.number(),
      price_unit: z.number().nullish(),
      /** Unit price before promotions. */
      origin_unit_price: z.number().nullish(),
      /** Empik's commission on the line: net, its VAT, and the total. */
      commission_fee: z.number().nullish(),
      commission_vat: z.number().nullish(),
      total_commission: z.number().nullish(),
      refunds: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).transform(String),
            amount: z.number().nullish(),
            shipping_amount: z.number().nullish(),
            quantity: z.number().int().nullish(),
            commission_amount: z.number().nullish(),
            commission_vat: z.number().nullish(),
            commission_total_amount: z.number().nullish(),
            created_date: z.string().nullish(),
            state: z.string().nullish(),
          }),
        )
        .nullish(),
      product_medias: z.array(z.object({ media_url: z.string(), type: z.string().nullish() })).nullish(),
      order_line_state: z.string().nullish(),
    }),
  ),
});

export type MiraklOrder = z.infer<typeof miraklOrderSchema>;

const COD = /pobrani|cash.?on.?delivery|\bcod\b/i;
const SHIPPED_STATES = new Set(['SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED']);
const CANCELLED_STATES = new Set(['CANCELED', 'REFUSED']);

/** Mirakl country codes are ISO alpha-3 ("POL"); carriers want alpha-2. */
const ALPHA3_TO_ALPHA2: Record<string, string> = { POL: 'PL', DEU: 'DE', CZE: 'CZ', SVK: 'SK', LTU: 'LT', UKR: 'UA' };

export function toAlpha2(code: string | null | undefined): string {
  if (!code) return 'PL';
  const upper = code.toUpperCase();
  return upper.length === 3 ? (ALPHA3_TO_ALPHA2[upper] ?? upper.slice(0, 2)) : upper;
}

/** Empik leaves `shipping_pudo_id` empty and sends the buyer's Paczkomat as the "delivery-point-name" order field. */
function pickupPoint(o: MiraklOrder): string | null {
  const field = o.order_additional_fields?.find((f) => f.code === 'delivery-point-name')?.value;
  return o.shipping_pudo_id || field?.trim().toUpperCase() || null;
}

/** Empik signals an invoice request with the "nip" order field; the company is on the billing address. */
function invoiceRequest(o: MiraklOrder, fallbackName: string): InvoiceRequest | null {
  const nip = o.order_additional_fields?.find((f) => f.code === 'nip')?.value?.trim();
  if (!nip) return null;
  const b = o.customer.billing_address ?? o.customer.shipping_address;
  const countryCode = toAlpha2(b?.country_iso_code);
  const { taxId, euPrefix } = splitTaxId(nip);
  return {
    name: b?.company || [b?.firstname, b?.lastname].filter(Boolean).join(' ') || fallbackName,
    taxId,
    euPrefix,
    street: [b?.street_1, b?.street_2].filter(Boolean).join(' '),
    postalCode: formatPostalCode(b?.zip_code ?? '', countryCode),
    city: b?.city ?? '',
    countryCode,
    email: o.customer_notification_email ?? null,
  };
}

function money(value: number): string {
  return value.toFixed(2);
}

/** Empik sends media paths relative to the marketplace, e.g. "/media/product/image/…". */
function absoluteUrl(url: string | null | undefined, base: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base || !url.startsWith('/')) return null;
  return `${base.replace(/\/+$/, '').replace(/\/api$/, '')}${url}`;
}

type MiraklLine = MiraklOrder['order_lines'][number];

function lineDiscount(l: MiraklLine): string | null {
  const unit = l.price_unit ?? (l.quantity > 0 ? l.price / l.quantity : l.price);
  if (l.origin_unit_price == null || l.origin_unit_price <= unit) return null;
  return money((l.origin_unit_price - unit) * l.quantity);
}

/** Empik's refunds take back the money but are not settled until REFUNDED. */
const SETTLED_REFUND = (state: string | null | undefined) => !state || state === 'REFUNDED';

/** Empik's commission per line, and the commission it gives back on refunds. */
function miraklFees(o: MiraklOrder): NormalizedFee[] {
  const occurredAt = new Date(o.customer_debited_date ?? o.created_date);
  const out: NormalizedFee[] = [];
  for (const l of o.order_lines) {
    const total = l.total_commission ?? (l.commission_fee != null ? l.commission_fee + (l.commission_vat ?? 0) : null);
    if (total) {
      out.push({
        externalId: `${o.order_id}:${l.order_line_id}:commission`,
        kind: 'commission',
        label: 'Prowizja Empik',
        externalLineId: l.order_line_id,
        amount: money(total),
        taxAmount: l.commission_vat != null ? money(l.commission_vat) : null,
        currency: o.currency_iso_code,
        occurredAt,
      });
    }
    for (const r of l.refunds ?? []) {
      if (!SETTLED_REFUND(r.state)) continue;
      const back = r.commission_total_amount ?? (r.commission_amount != null ? r.commission_amount + (r.commission_vat ?? 0) : null);
      if (!back) continue;
      out.push({
        externalId: `${o.order_id}:${l.order_line_id}:refund:${r.id}`,
        kind: 'commission',
        label: 'Zwrot prowizji Empik',
        externalLineId: l.order_line_id,
        amount: money(-back),
        taxAmount: r.commission_vat != null ? money(-r.commission_vat) : null,
        currency: o.currency_iso_code,
        occurredAt: new Date(r.created_date ?? o.last_updated_date),
      });
    }
  }
  return out;
}

function miraklRefunds(o: MiraklOrder): NormalizedRefund[] {
  return o.order_lines.flatMap((l) =>
    (l.refunds ?? [])
      .filter((r) => SETTLED_REFUND(r.state) && ((r.amount ?? 0) > 0 || (r.shipping_amount ?? 0) > 0))
      .map((r) => ({
        externalId: `${l.order_line_id}:${r.id}`,
        externalLineId: l.order_line_id,
        amount: money((r.amount ?? 0) + (r.shipping_amount ?? 0)),
        currency: o.currency_iso_code,
        quantity: r.quantity ?? null,
        refundedAt: new Date(r.created_date ?? o.last_updated_date),
      })),
  );
}

/** @param mediaBase the Empik marketplace URL, used to make relative photo paths loadable. */
export function mapMiraklOrder(raw: unknown, mediaBase?: string): NormalizedOrder {
  const o = miraklOrderSchema.parse(raw);
  const a = o.customer.shipping_address;
  const countryCode = toAlpha2(a?.country_iso_code);
  const point = pickupPoint(o);
  const buyerName = [o.customer.firstname, o.customer.lastname].filter(Boolean).join(' ');
  const addressName = [a?.firstname, a?.lastname].filter(Boolean).join(' ');
  // For Paczkomat orders Empik puts the locker code in the recipient's surname; the parcel is for the buyer.
  const recipient = addressName && addressName.toUpperCase() !== point ? addressName : buyerName || addressName;
  const cod = COD.test(o.payment_type ?? '') || COD.test(o.shipping_type_label ?? '');

  return {
    externalId: o.order_id,
    externalNumber: o.commercial_id ?? o.order_id,
    marketplaceStatus: o.order_state,
    // Empik only lets the seller ship once the order is accepted and paid ("SHIPPING").
    readyToShip: o.order_state === 'SHIPPING',
    cancelled: CANCELLED_STATES.has(o.order_state),
    fulfilled: SHIPPED_STATES.has(o.order_state),
    buyer: {
      name: buyerName || recipient,
      email: o.customer_notification_email ?? null,
      phone: a?.phone ?? null,
    },
    shippingAddress: {
      name: recipient || 'Empik buyer',
      company: a?.company ?? null,
      street: [a?.street_1, a?.street_2].filter(Boolean).join(' '),
      city: a?.city ?? '',
      postalCode: formatPostalCode(a?.zip_code ?? '', countryCode),
      countryCode,
      phone: a?.phone ?? null,
      email: o.customer_notification_email ?? null,
    },
    deliveryMethodId: o.shipping_type_code ?? null,
    deliveryMethodName: o.shipping_type_label ?? null,
    pickupPointId: point,
    codAmount: cod ? money(o.total_price) : null,
    totalAmount: money(o.total_price),
    shippingAmount: o.shipping_price != null ? money(o.shipping_price) : null,
    currency: o.currency_iso_code,
    placedAt: new Date(o.created_date),
    paidAt: o.customer_debited_date ? new Date(o.customer_debited_date) : null,
    items: o.order_lines.map((l) => ({
      externalLineId: l.order_line_id,
      sku: l.offer_sku ?? null,
      name: l.product_title,
      quantity: l.quantity,
      unitPrice: money(l.price_unit ?? (l.quantity > 0 ? l.price / l.quantity : l.price)),
      externalProductId: l.offer_id != null ? String(l.offer_id) : null,
      imageUrl: absoluteUrl((l.product_medias?.find((m) => m.type?.toLowerCase() === 'small') ?? l.product_medias?.[0])?.media_url, mediaBase),
      discountAmount: lineDiscount(l),
    })),
    fees: miraklFees(o),
    refunds: miraklRefunds(o),
    invoiceRequest: invoiceRequest(o, buyerName || recipient || 'Empik buyer'),
    revision: o.last_updated_date,
    raw,
  };
}
