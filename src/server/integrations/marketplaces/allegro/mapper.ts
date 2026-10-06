import { z } from 'zod';
import { formatPostalCode } from '../../address';
import { splitTaxId, type InvoiceRequest, type NormalizedOrder } from '../../types';

const amount = z.object({ amount: z.string(), currency: z.string() });

const deliveryAddress = z.object({
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  companyName: z.string().nullish(),
  street: z.string().nullish(),
  city: z.string().nullish(),
  zipCode: z.string().nullish(),
  countryCode: z.string().nullish(),
  phoneNumber: z.string().nullish(),
});

export const checkoutFormSchema = z.object({
  id: z.string(),
  status: z.string(),
  revision: z.string().nullish(),
  updatedAt: z.string().nullish(),
  buyer: z.object({
    email: z.string().nullish(),
    login: z.string().nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    companyName: z.string().nullish(),
    phoneNumber: z.string().nullish(),
  }),
  payment: z
    .object({
      type: z.string().nullish(),
      finishedAt: z.string().nullish(),
      paidAmount: amount.nullish(),
    })
    .nullish(),
  fulfillment: z.object({ status: z.string().nullish() }).nullish(),
  invoice: z
    .object({
      required: z.boolean().nullish(),
      address: z
        .object({
          street: z.string().nullish(),
          city: z.string().nullish(),
          zipCode: z.string().nullish(),
          countryCode: z.string().nullish(),
          company: z.object({ name: z.string().nullish(), taxId: z.string().nullish() }).nullish(),
          naturalPerson: z.object({ firstName: z.string().nullish(), lastName: z.string().nullish() }).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  delivery: z
    .object({
      address: deliveryAddress.nullish(),
      method: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
      pickupPoint: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
      cost: amount.nullish(),
    })
    .nullish(),
  lineItems: z.array(
    z.object({
      id: z.string(),
      quantity: z.number().int(),
      price: amount,
      /** Price before Allegro or seller discounts; `price` is what the buyer paid per unit. */
      originalPrice: amount.nullish(),
      boughtAt: z.string().nullish(),
      offer: z.object({
        id: z.string(),
        name: z.string(),
        external: z.object({ id: z.string().nullish() }).nullish(),
      }),
    }),
  ),
  summary: z.object({ totalToPay: amount }),
});

export type CheckoutForm = z.infer<typeof checkoutFormSchema>;

const SHIPPED_FULFILLMENT = new Set(['SENT', 'PICKED_UP', 'READY_FOR_PICKUP']);

function invoiceRequest(f: CheckoutForm, fallbackName: string): InvoiceRequest | null {
  const inv = f.invoice;
  if (!inv?.required || !inv.address) return null;
  const a = inv.address;
  const countryCode = (a.countryCode ?? 'PL').toUpperCase();
  const person = [a.naturalPerson?.firstName, a.naturalPerson?.lastName].filter(Boolean).join(' ');
  const { taxId, euPrefix } = splitTaxId(a.company?.taxId);
  return {
    name: a.company?.name || person || fallbackName,
    taxId,
    euPrefix,
    street: a.street ?? '',
    postalCode: formatPostalCode(a.zipCode ?? '', countryCode),
    city: a.city ?? '',
    countryCode,
    email: f.buyer.email ?? null,
  };
}

/** Allegro prices are already discounted; the discount is what the lines lost against their original price. */
function discountOf(f: CheckoutForm): string | null {
  const total = f.lineItems.reduce((sum, li) => {
    const original = Number(li.originalPrice?.amount ?? li.price.amount);
    return sum + Math.max(0, original - Number(li.price.amount)) * li.quantity;
  }, 0);
  return total > 0.004 ? total.toFixed(2) : null;
}

export function mapAllegroCheckoutForm(raw: unknown): NormalizedOrder {
  const f = checkoutFormSchema.parse(raw);
  const a = f.delivery?.address;
  const buyerName = [f.buyer.firstName, f.buyer.lastName].filter(Boolean).join(' ') || f.buyer.login || 'Allegro buyer';
  const recipientName = [a?.firstName, a?.lastName].filter(Boolean).join(' ') || buyerName;
  const countryCode = a?.countryCode ?? 'PL';
  const cod = f.payment?.type === 'CASH_ON_DELIVERY';
  const boughtAt = f.lineItems.map((li) => li.boughtAt).filter(Boolean).sort()[0];
  const fulfilmentCancelled = f.fulfillment?.status === 'CANCELLED';

  return {
    externalId: f.id,
    // Allegro has no short order number; the first block of the UUID is what sellers quote.
    externalNumber: f.id.split('-')[0].toUpperCase(),
    marketplaceStatus: `${f.status} / ${f.fulfillment?.status ?? 'NEW'}`,
    // A paid order that is cancelled afterwards keeps the payment status READY_FOR_PROCESSING; only
    // its fulfilment status says CANCELLED.
    readyToShip: f.status === 'READY_FOR_PROCESSING' && !fulfilmentCancelled,
    cancelled: f.status === 'CANCELLED' || fulfilmentCancelled,
    fulfilled: SHIPPED_FULFILLMENT.has(f.fulfillment?.status ?? ''),
    buyer: {
      name: buyerName,
      email: f.buyer.email ?? null,
      phone: f.buyer.phoneNumber ?? null,
      login: f.buyer.login ?? null,
    },
    shippingAddress: {
      name: recipientName,
      company: a?.companyName ?? null,
      street: a?.street ?? '',
      city: a?.city ?? '',
      postalCode: formatPostalCode(a?.zipCode ?? '', countryCode),
      countryCode,
      phone: a?.phoneNumber ?? f.buyer.phoneNumber ?? null,
      email: f.buyer.email ?? null,
    },
    deliveryMethodId: f.delivery?.method?.id ?? null,
    deliveryMethodName: f.delivery?.method?.name ?? null,
    pickupPointId: f.delivery?.pickupPoint?.id ?? null,
    codAmount: cod ? f.summary.totalToPay.amount : null,
    totalAmount: f.summary.totalToPay.amount,
    shippingAmount: f.delivery?.cost?.amount ?? null,
    currency: f.summary.totalToPay.currency,
    placedAt: new Date(boughtAt ?? f.updatedAt ?? Date.now()),
    paidAt: f.payment?.finishedAt ? new Date(f.payment.finishedAt) : null,
    items: f.lineItems.map((li) => ({
      externalLineId: li.id,
      sku: li.offer.external?.id || null,
      name: li.offer.name,
      quantity: li.quantity,
      unitPrice: li.price.amount,
      externalProductId: li.offer.id,
    })),
    discountAmount: discountOf(f),
    invoiceRequest: invoiceRequest(f, buyerName),
    revision: f.revision ?? null,
    raw,
  };
}
