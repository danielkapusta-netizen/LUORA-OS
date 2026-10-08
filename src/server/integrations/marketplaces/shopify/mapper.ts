import { z } from 'zod';
import { findLockerCode, formatPostalCode } from '../../address';
import type { NormalizedFee, NormalizedOrder, NormalizedRefund } from '../../types';

const money = z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }) });

const address = z.object({
  name: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  company: z.string().nullish(),
  address1: z.string().nullish(),
  address2: z.string().nullish(),
  city: z.string().nullish(),
  zip: z.string().nullish(),
  countryCodeV2: z.string().nullish(),
  phone: z.string().nullish(),
});

export const shopifyOrderSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  processedAt: z.string().nullish(),
  cancelledAt: z.string().nullish(),
  displayFinancialStatus: z.string().nullish(),
  displayFulfillmentStatus: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  paymentGatewayNames: z.array(z.string()).default([]),
  totalPriceSet: money,
  totalShippingPriceSet: money.nullish(),
  totalDiscountsSet: money.nullish(),
  refunds: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.string(),
        totalRefundedSet: money.nullish(),
        refundLineItems: z
          .object({
            nodes: z.array(
              z.object({
                quantity: z.number().int(),
                restockType: z.string().nullish(),
                lineItem: z.object({ id: z.string() }).nullish(),
                subtotalSet: z.object({ shopMoney: z.object({ amount: z.string() }) }).nullish(),
              }),
            ),
          })
          .nullish(),
      }),
    )
    .nullish(),
  transactions: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string().nullish(),
        status: z.string().nullish(),
        processedAt: z.string().nullish(),
        fees: z
          .array(
            z.object({
              id: z.string(),
              amount: z.object({ amount: z.string(), currencyCode: z.string() }),
              taxAmount: z.object({ amount: z.string(), currencyCode: z.string() }).nullish(),
              type: z.string().nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
  shippingAddress: address.nullish(),
  shippingLine: z.object({ title: z.string().nullish(), code: z.string().nullish(), source: z.string().nullish() }).nullish(),
  customAttributes: z.array(z.object({ key: z.string(), value: z.string().nullish() })).default([]),
  lineItems: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        sku: z.string().nullish(),
        name: z.string(),
        quantity: z.number().int(),
        originalUnitPriceSet: money,
        totalDiscountSet: money.nullish(),
        image: z.object({ url: z.string() }).nullish(),
        variant: z.object({ id: z.string(), inventoryItem: z.object({ id: z.string() }).nullish() }).nullish(),
      }),
    ),
  }),
});

export type ShopifyOrder = z.infer<typeof shopifyOrderSchema>;

export const DEFAULT_PICKUP_POINT_KEYS = ['paczkomat', 'inpost_point', 'inpost-point', 'pickup_point', 'point_id', 'locker'];

const COD_GATEWAY = /cash on delivery|\bcod\b|pobrani/i;
const LOCKER_SHIPPING = /paczkomat|inpost|locker|automat/i;
const PAID = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

export function mapShopifyOrder(raw: unknown, pickupPointKeys = DEFAULT_PICKUP_POINT_KEYS): NormalizedOrder {
  const o = shopifyOrderSchema.parse(raw);
  const a = o.shippingAddress;
  const currency = o.totalPriceSet.shopMoney.currencyCode;
  const cod = o.paymentGatewayNames.some((g) => COD_GATEWAY.test(g));
  const cancelled = Boolean(o.cancelledAt);
  const paid = PAID.has(o.displayFinancialStatus ?? '');
  const name = a?.name || [a?.firstName, a?.lastName].filter(Boolean).join(' ') || 'Unknown buyer';
  const countryCode = a?.countryCodeV2 ?? 'PL';

  return {
    externalId: o.id,
    externalNumber: o.name,
    marketplaceStatus: `${o.displayFinancialStatus ?? 'UNKNOWN'} / ${o.displayFulfillmentStatus}`,
    readyToShip: !cancelled && (paid || cod),
    cancelled,
    fulfilled: o.displayFulfillmentStatus === 'FULFILLED',
    buyer: { name, email: o.email ?? null, phone: a?.phone ?? o.phone ?? null },
    shippingAddress: {
      name,
      company: a?.company ?? null,
      street: [a?.address1, a?.address2].filter(Boolean).join(' '),
      city: a?.city ?? '',
      postalCode: formatPostalCode(a?.zip ?? '', countryCode),
      countryCode,
      phone: a?.phone ?? o.phone ?? null,
      email: o.email ?? null,
    },
    deliveryMethodId: o.shippingLine?.code ?? null,
    deliveryMethodName: o.shippingLine?.title ?? null,
    pickupPointId: extractPickupPoint(o, pickupPointKeys),
    codAmount: cod ? o.totalPriceSet.shopMoney.amount : null,
    totalAmount: o.totalPriceSet.shopMoney.amount,
    shippingAmount: o.totalShippingPriceSet?.shopMoney.amount ?? null,
    currency,
    placedAt: new Date(o.processedAt ?? o.createdAt),
    paidAt: paid ? new Date(o.processedAt ?? o.createdAt) : null,
    items: o.lineItems.nodes.map((li) => ({
      externalLineId: li.id,
      sku: li.sku || null,
      name: li.name,
      quantity: li.quantity,
      unitPrice: li.originalUnitPriceSet.shopMoney.amount,
      externalProductId: li.variant?.id ?? null,
      imageUrl: li.image?.url ?? null,
      discountAmount: nonZero(li.totalDiscountSet?.shopMoney.amount),
    })),
    discountAmount: nonZero(o.totalDiscountsSet?.shopMoney.amount),
    fees: shopifyFees(o),
    refunds: shopifyRefunds(o, currency),
    revision: o.updatedAt,
    raw,
  };
}

function nonZero(amount: string | null | undefined): string | null {
  return amount && Number(amount) !== 0 ? amount : null;
}

/** Shopify Payments processing fees, reported on each successful transaction. */
function shopifyFees(o: ShopifyOrder): NormalizedFee[] {
  const out: NormalizedFee[] = [];
  for (const t of o.transactions ?? []) {
    if (t.status && t.status !== 'SUCCESS') continue;
    for (const f of t.fees ?? []) {
      out.push({
        externalId: f.id,
        kind: 'payment',
        // Shopify reports types like "processing_fee" and "foreign_exchange_fee".
        label: f.type ? `Shopify Payments ${f.type.toLowerCase().replace(/_/g, ' ')}` : 'Shopify Payments fee',
        amount: f.amount.amount,
        taxAmount: f.taxAmount?.amount ?? null,
        currency: f.amount.currencyCode,
        occurredAt: new Date(t.processedAt ?? o.createdAt),
      });
    }
  }
  return out;
}

/** One refund per returned line, plus the rest of the refund (shipping, goodwill) as an order-level one. */
function shopifyRefunds(o: ShopifyOrder, currency: string): NormalizedRefund[] {
  const out: NormalizedRefund[] = [];
  for (const r of o.refunds ?? []) {
    const total = Number(r.totalRefundedSet?.shopMoney.amount ?? 0);
    const refundCurrency = r.totalRefundedSet?.shopMoney.currencyCode ?? currency;
    const refundedAt = new Date(r.createdAt);
    let lines = 0;
    for (const li of r.refundLineItems?.nodes ?? []) {
      const amount = Number(li.subtotalSet?.shopMoney.amount ?? 0);
      if (!li.lineItem) continue;
      lines += amount;
      out.push({
        externalId: `${r.id}:${li.lineItem.id}`,
        externalLineId: li.lineItem.id,
        amount: amount.toFixed(2),
        currency: refundCurrency,
        quantity: li.quantity,
        restocked: Boolean(li.restockType && li.restockType !== 'NO_RESTOCK'),
        refundedAt,
      });
    }
    const rest = Math.round((total - lines) * 100) / 100;
    if (rest > 0) out.push({ externalId: r.id, amount: rest.toFixed(2), currency: refundCurrency, refundedAt });
  }
  return out;
}

/**
 * Shopify has no built-in parcel locker field. Checkout apps usually store the locker
 * in a note attribute; some put it in the shipping line title instead.
 */
function extractPickupPoint(o: ShopifyOrder, keys: string[]): string | null {
  const wanted = keys.map((k) => k.toLowerCase());
  for (const attr of o.customAttributes) {
    if (!attr.value) continue;
    if (wanted.some((k) => attr.key.toLowerCase().includes(k))) {
      return findLockerCode(attr.value) ?? attr.value.trim();
    }
  }
  const title = o.shippingLine?.title;
  if (title && LOCKER_SHIPPING.test(title)) return findLockerCode(title);
  return null;
}
