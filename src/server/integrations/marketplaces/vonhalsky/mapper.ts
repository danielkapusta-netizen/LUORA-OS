import { z } from 'zod';
import { formatPostalCode } from '../../address';
import { splitTaxId, type Address, type InvoiceRequest, type NormalizedOrder } from '../../types';

const money = z.object({ amount: z.number(), currency: z.string() });

const address = z.object({
  street: z.string().nullish(),
  building: z.string().nullish(),
  flat: z.string().nullish(),
  city: z.string().nullish(),
  postCode: z.string().nullish(),
  countryCode: z.string().nullish(),
});

export const vonHalskyOrderSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullish(),
  status: z.string(),
  customer: z
    .object({
      email: z.string().nullish(),
      firstName: z.string().nullish(),
      lastName: z.string().nullish(),
      phoneNumber: z.string().nullish(),
      address: address.nullish(),
    })
    .nullish(),
  invoice: z
    .object({
      email: z.string().nullish(),
      legalForm: z.string().nullish(),
      companyName: z.string().nullish(),
      firstName: z.string().nullish(),
      lastName: z.string().nullish(),
      taxIdPrefix: z.string().nullish(),
      taxId: z.string().nullish(),
      address: address.nullish(),
    })
    .nullish(),
  delivery: z.object({
    deliveryType: z.string().nullish(),
    parcels: z.array(z.object({ trackingNumber: z.string().nullish(), status: z.string().nullish() })).default([]),
    name: z.string().nullish(),
    deliveryPoint: z.string().nullish(),
    address: address.nullish(),
    email: z.string().nullish(),
    phoneNumber: z.string().nullish(),
    price: money.nullish(),
  }),
  // One entry per unit bought: the API has no quantity field.
  orderLines: z.array(
    z.object({
      offer: z.object({
        offerId: z.string(),
        product: z.object({ productId: z.string().nullish(), name: z.string(), ean: z.string().nullish(), sku: z.string().nullish() }),
        finalPrice: money,
        basePrice: money.nullish(),
      }),
    }),
  ),
  finalPrice: money,
  paymentDetails: z
    .object({
      selectedPaymentType: z.string().nullish(),
      payments: z.array(z.object({ paymentDate: z.string().nullish() })).default([]),
    })
    .nullish(),
});

export type VonHalskyOrder = z.infer<typeof vonHalskyOrderSchema>;

const CANCELLED = new Set(['CANCELED', 'CANCELLED', 'REFUSED', 'REJECTED']);
const SHIPPED_PARCEL = new Set(['SENT', 'RECEIVED']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

const fixed = (n: number) => n.toFixed(2);

function street(a: z.infer<typeof address> | null | undefined): string {
  if (!a) return '';
  const number = [a.building, a.flat].filter(Boolean).join('/');
  return [a.street, number].filter(Boolean).join(' ').trim();
}

/** Paid by card / BLIK / …: at least one payment is booked. Cash on delivery is paid to the courier. */
export function isPaid(o: VonHalskyOrder): boolean {
  return (o.paymentDetails?.payments.length ?? 0) > 0;
}

/**
 * Orders worth importing. Unpaid ones (CREATED, or REJECTED after 12 hours) never reach staff; a
 * cancelled order is kept only if it was paid, so it can be returned to stock.
 */
export function isImportable(o: VonHalskyOrder): boolean {
  if (o.status === 'ACCEPTED') return true;
  return (o.status === 'CANCELED' || o.status === 'REFUSED') && isPaid(o);
}

function invoiceRequest(o: VonHalskyOrder): InvoiceRequest | null {
  const inv = o.invoice;
  if (!inv) return null;
  const addr = inv.address ?? o.customer?.address;
  const person = [inv.firstName, inv.lastName].filter(Boolean).join(' ');
  const name = inv.companyName?.trim() || person || [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ');
  if (!name || !addr) return null;
  const countryCode = (addr.countryCode ?? 'PL').toUpperCase();
  const company = inv.legalForm === 'COMPANY' || Boolean(inv.taxId);
  const tax = company ? splitTaxId(`${inv.taxIdPrefix ?? ''}${inv.taxId ?? ''}`) : { taxId: null, euPrefix: null };
  return {
    name,
    taxId: tax.taxId,
    euPrefix: tax.euPrefix,
    street: street(addr),
    postalCode: formatPostalCode(addr.postCode ?? '', countryCode),
    city: addr.city ?? '',
    countryCode,
    email: inv.email ?? o.customer?.email ?? undefined,
  };
}

export function mapVonHalskyOrder(raw: unknown): NormalizedOrder {
  const o = vonHalskyOrderSchema.parse(raw);
  const c = o.customer;
  const d = o.delivery;
  const buyerName = [c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Von Halsky buyer';
  const home = d.address ?? c?.address;
  const countryCode = (home?.countryCode ?? c?.address?.countryCode ?? 'PL').toUpperCase();
  const locker = d.deliveryType === 'APM' ? (d.deliveryPoint ?? null) : null;
  const cod = o.paymentDetails?.selectedPaymentType === 'CASH_ON_DELIVERY';
  const paid = isPaid(o);

  // The same offer bought n times comes as n lines.
  const lines = new Map<string, { name: string; sku: string | null; unit: number; quantity: number; discount: number }>();
  for (const l of o.orderLines) {
    const key = l.offer.offerId;
    // basePrice is the offer price before InPost's promotions; finalPrice is what the buyer paid.
    const discount = Math.max(0, (l.offer.basePrice?.amount ?? l.offer.finalPrice.amount) - l.offer.finalPrice.amount);
    const entry = lines.get(key);
    if (entry) {
      entry.quantity += 1;
      entry.discount += discount;
    } else lines.set(key, { name: l.offer.product.name, sku: l.offer.product.sku ?? null, unit: l.offer.finalPrice.amount, quantity: 1, discount });
  }

  const shippingAddress: Address = {
    name: buyerName,
    street: street(home),
    city: home?.city ?? '',
    postalCode: formatPostalCode(home?.postCode ?? '', countryCode),
    countryCode,
    phone: d.phoneNumber ?? c?.phoneNumber ?? null,
    email: d.email ?? c?.email ?? null,
  };

  const payments = (o.paymentDetails?.payments ?? []).map((p) => p.paymentDate).filter((x): x is string => Boolean(x)).sort();

  return {
    externalId: o.id,
    // The id is the only number InPost shows; the first block keeps UUIDs short.
    externalNumber: UUID.test(o.id) ? o.id.split('-')[0].toUpperCase() : o.id,
    marketplaceStatus: `${o.status} / ${cod ? 'COD' : paid ? 'PAID' : 'NOT_PAID'}`,
    readyToShip: o.status === 'ACCEPTED' && (paid || cod),
    cancelled: CANCELLED.has(o.status),
    fulfilled: d.parcels.some((p) => SHIPPED_PARCEL.has(p.status ?? '')),
    buyer: { name: buyerName, email: c?.email ?? null, phone: c?.phoneNumber ?? null },
    shippingAddress,
    deliveryMethodId: d.deliveryType ?? null,
    deliveryMethodName: d.name ?? (d.deliveryType === 'APM' ? 'InPost parcel locker' : d.deliveryType) ?? null,
    pickupPointId: locker,
    codAmount: cod ? fixed(o.finalPrice.amount) : null,
    totalAmount: fixed(o.finalPrice.amount),
    shippingAmount: d.price ? fixed(d.price.amount) : null,
    currency: o.finalPrice.currency,
    placedAt: new Date(o.createdAt),
    paidAt: payments[0] ? new Date(payments[0]) : null,
    items: [...lines].map(([offerId, l]) => ({
      externalLineId: offerId,
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unitPrice: fixed(l.unit),
      externalProductId: offerId,
      discountAmount: l.discount > 0.004 ? fixed(l.discount) : null,
    })),
    invoiceRequest: invoiceRequest(o),
    revision: o.updatedAt ?? null,
    raw: raw,
  };
}
