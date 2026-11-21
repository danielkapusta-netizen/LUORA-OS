// Erli orders as Luora orders. Erli sends every amount in grosze.
import type { InvoiceRequest, NormalizedOrder } from '../../types';

export interface ErliAddress {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  address?: string;
  street?: string;
  buildingNumber?: string;
  flatNumber?: string;
  city?: string;
  country?: string;
  zip?: string;
  phone?: string;
}

export interface ErliOrder {
  id: string;
  externalOrderId?: string;
  status: 'pending' | 'purchased' | 'cancelled' | 'returned';
  sellerStatus?: string;
  user?: {
    email?: string;
    deliveryAddress?: ErliAddress;
    invoiceAddress?: ErliAddress & { type?: 'company' | 'person'; nip?: string };
  };
  items: {
    id: number;
    externalId: string;
    quantity: number;
    unitPrice: number;
    unitPriceBeforeRebate?: number;
    name: string;
    slug?: string;
    ean?: string;
    sku?: string;
    taxRate?: string;
  }[];
  rebate?: { id: number; name: string; code?: string } | null;
  delivery?: {
    name?: string;
    typeId?: string;
    price?: number;
    cod?: boolean;
    pickupPlace?: { externalId?: string; provider?: string; name?: string; address?: string; city?: string; zip?: string } | null;
  };
  comment?: string;
  totalPrice: number;
  currency?: string;
  deliveryTracking?: { status?: string; trackingNumber?: string; vendor?: string } | null;
  created: string;
  updated?: string;
  purchasedAt?: string;
  cursor?: string;
}

/** Grosze to "49.99". */
export function fromGrosze(value: number | null | undefined): string {
  return ((value ?? 0) / 100).toFixed(2);
}

/** "49.99" to grosze. */
export function toGrosze(price: string | number): number {
  return Math.round(Number(price) * 100);
}

/** Erli's order states that mean the parcel has left (or the order is done). */
const SENT = new Set(['sent', 'readyToPickup', 'received']);

function street(a: ErliAddress | undefined): string {
  if (!a) return '';
  if (a.street) return [a.street, [a.buildingNumber, a.flatNumber].filter(Boolean).join('/')].filter(Boolean).join(' ').trim();
  return a.address ?? '';
}

function name(a: ErliAddress | undefined): string {
  return [a?.firstName, a?.lastName].filter(Boolean).join(' ').trim();
}

export function mapErliOrder(o: ErliOrder): NormalizedOrder {
  const delivery = o.user?.deliveryAddress;
  const currency = o.currency ?? 'PLN';
  const shipping = o.delivery?.price ?? 0;
  // A rebate lowers the unit prices; the difference is the order's discount.
  const discount = o.items.reduce((sum, i) => sum + Math.max(0, (i.unitPriceBeforeRebate ?? i.unitPrice) - i.unitPrice) * i.quantity, 0);
  const invoice = o.user?.invoiceAddress;
  const company = invoice?.type === 'company' && invoice.nip;
  const invoiceRequest: InvoiceRequest | null = invoice
    ? {
        name: company ? invoice.companyName ?? name(invoice) : name(invoice) || name(delivery),
        taxId: company ? invoice.nip!.replace(/\D/g, '') || null : null,
        euPrefix: null,
        street: street(invoice),
        postalCode: invoice.zip ?? '',
        city: invoice.city ?? '',
        countryCode: (invoice.country ?? 'pl').toUpperCase(),
        email: o.user?.email ?? null,
      }
    : null;
  // Erli's provider-specific point id is the locker code for InPost ("KRA010M").
  const point = o.delivery?.pickupPlace?.externalId?.trim() || null;
  const sellerStatus = o.sellerStatus ?? '';
  return {
    externalId: o.id,
    externalNumber: o.id,
    marketplaceStatus: sellerStatus ? `${o.status} / ${sellerStatus}` : o.status,
    readyToShip: o.status === 'purchased',
    cancelled: o.status === 'cancelled' || o.status === 'returned' || sellerStatus === 'canceled',
    fulfilled: SENT.has(sellerStatus) || ['sent', 'readyToPickup', 'delivered'].includes(o.deliveryTracking?.status ?? ''),
    buyer: { name: name(delivery) || 'Erli buyer', email: o.user?.email ?? null, phone: delivery?.phone ?? null },
    shippingAddress: {
      name: name(delivery),
      company: delivery?.companyName || null,
      street: street(delivery),
      city: delivery?.city ?? '',
      postalCode: delivery?.zip ?? '',
      countryCode: (delivery?.country ?? 'pl').toUpperCase(),
      phone: delivery?.phone ?? null,
      email: o.user?.email ?? null,
    },
    deliveryMethodId: o.delivery?.typeId ?? null,
    deliveryMethodName: o.delivery?.name ?? null,
    pickupPointId: point,
    codAmount: o.delivery?.cod ? fromGrosze(o.totalPrice) : null,
    totalAmount: fromGrosze(o.totalPrice),
    shippingAmount: fromGrosze(shipping),
    currency,
    placedAt: new Date(o.created),
    paidAt: o.status === 'purchased' || o.status === 'returned' ? new Date(o.purchasedAt ?? o.created) : null,
    items: o.items.map((i) => ({
      externalLineId: String(i.id),
      sku: i.sku || i.externalId || null,
      name: i.name,
      quantity: i.quantity,
      unitPrice: fromGrosze(i.unitPrice),
      externalProductId: i.externalId,
      imageUrl: null,
    })),
    invoiceRequest,
    discountAmount: discount > 0 ? fromGrosze(discount) : null,
    revision: o.updated ?? null,
    raw: o,
  };
}
