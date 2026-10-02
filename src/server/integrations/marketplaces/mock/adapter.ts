// Fake marketplace used when INTEGRATIONS_MODE=mock. Orders are generated
// deterministically from their index, so re-syncing never produces duplicates.
import type { Listing, Marketplace, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../../types';
import type { MarketplaceAdapter, SyncResult } from '../types';

export const MOCK_CATALOG = [
  { sku: 'LUO-MUG-01', name: 'Kubek ceramiczny Luora 350 ml', price: 39.99 },
  { sku: 'LUO-TSH-M', name: 'T-shirt Luora, rozmiar M', price: 79.0 },
  { sku: 'LUO-TSH-L', name: 'T-shirt Luora, rozmiar L', price: 79.0 },
  { sku: 'LUO-BAG-01', name: 'Torba bawełniana Luora', price: 49.5 },
  { sku: 'LUO-CND-01', name: 'Świeca sojowa "Las"', price: 59.0 },
  { sku: 'LUO-NTB-A5', name: 'Notes A5 w kropki', price: 29.9 },
];

/** Placeholder product photo: a soft tile with the product's initials (demo mode only). */
export function mockProductImage(sku: string, name: string): string {
  const hues = [152, 28, 205, 340, 45, 265];
  const hue = hues[[...sku].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÀ-ž]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="16" fill="hsl(${hue} 45% 92%)"/><rect x="30" y="34" width="60" height="52" rx="10" fill="hsl(${hue} 40% 70%)"/><text x="60" y="68" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="hsl(${hue} 45% 25%)">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const FIRST = ['Anna', 'Piotr', 'Katarzyna', 'Tomasz', 'Magdalena', 'Michał', 'Agnieszka', 'Paweł', 'Ewa', 'Jakub'];
const LAST = ['Nowak', 'Kowalska', 'Wiśniewski', 'Wójcik', 'Kamińska', 'Lewandowski', 'Zielińska', 'Szymański'];
const CITIES = [
  { city: 'Warszawa', postalCode: '00-950', street: 'ul. Marszałkowska', point: 'WAW01A' },
  { city: 'Kraków', postalCode: '30-001', street: 'ul. Długa', point: 'KRA010' },
  { city: 'Gdańsk', postalCode: '80-001', street: 'ul. Grunwaldzka', point: 'GDA05M' },
  { city: 'Poznań', postalCode: '60-001', street: 'ul. Półwiejska', point: 'POZ08A' },
  { city: 'Wrocław', postalCode: '50-001', street: 'ul. Świdnicka', point: 'WRO22N' },
  { city: 'Łódź', postalCode: '90-001', street: 'ul. Piotrkowska', point: 'LOD13M' },
];

const DELIVERY: Record<Marketplace, { id: string; name: string; locker: boolean; cod?: boolean }[]> = {
  shopify: [
    { id: 'inpost-locker', name: 'InPost Paczkomat 24/7', locker: true },
    { id: 'inpost-courier', name: 'Kurier InPost', locker: false },
    { id: 'inpost-courier-cod', name: 'Kurier InPost – pobranie', locker: false, cod: true },
  ],
  allegro: [
    { id: '2488f7b7-5d1c-4d65-b85c-4cbcf253fd93', name: 'Allegro Paczkomaty InPost', locker: true },
    { id: '5d9c7838-e05f-4dec-afdd-58e884170ba7', name: 'Allegro One Box, One Kurier', locker: true },
    { id: '758fcd59-fbfa-4453-ae07-4800d72c2ca5', name: 'Allegro Kurier DPD', locker: false },
    { id: '685d8b40-2571-4111-8937-9220b1710d4c', name: 'Allegro Kurier DPD pobranie', locker: false, cod: true },
  ],
  empik: [
    { id: 'PACZKOMAT', name: 'Paczkomaty InPost', locker: true },
    { id: 'KURIER', name: 'Kurier InPost', locker: false },
  ],
};

const INITIAL_ORDERS = 14;
const globalMock = globalThis as unknown as { __luoraMockAccepted?: Set<string> };
const accepted = (globalMock.__luoraMockAccepted ??= new Set<string>());

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class MockMarketplaceAdapter implements MarketplaceAdapter {
  constructor(
    readonly marketplace: Marketplace,
    private readonly accountKey: string,
  ) {}

  async checkConnection(): Promise<string> {
    return `Mock ${this.marketplace} account`;
  }

  externalIdFor(index: number): string {
    switch (this.marketplace) {
      case 'shopify':
        return `gid://shopify/Order/${5_600_000_000 + index}`;
      case 'allegro': {
        const hex = hash(`${this.accountKey}-${index}`).toString(16).padStart(8, '0');
        return `${hex}-0c1e-11f0-9a4b-${String(index).padStart(12, '0')}`;
      }
      case 'empik':
        return `${210_000 + index}-A`;
    }
  }

  private indexOf(externalId: string): number | null {
    for (let i = 0; i < 10_000; i++) if (this.externalIdFor(i) === externalId) return i;
    return null;
  }

  buildOrder(index: number, placedAt: Date): NormalizedOrder {
    const rand = prng(hash(`${this.accountKey}:${index}`));
    const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
    const first = pick(FIRST);
    const last = pick(LAST);
    const place = pick(CITIES);
    const delivery = pick(DELIVERY[this.marketplace]);
    const lineCount = 1 + Math.floor(rand() * 3);
    const products = [...MOCK_CATALOG].sort(() => rand() - 0.5).slice(0, lineCount);
    const items = products.map((p, i) => ({
      externalLineId: `${index}-${i + 1}`,
      sku: p.sku,
      name: p.name,
      quantity: 1 + Math.floor(rand() * 2),
      unitPrice: p.price.toFixed(2),
      externalProductId: `offer-${p.sku}`,
      imageUrl: mockProductImage(p.sku, p.name),
    }));
    const shipping = delivery.locker ? 12.99 : 16.99;
    const total = items.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0) + shipping;
    const externalId = this.externalIdFor(index);

    const waitingAcceptance = this.marketplace === 'empik' && index % 5 === 0 && !accepted.has(externalId);
    const status =
      this.marketplace === 'shopify' ? 'PAID / UNFULFILLED' : this.marketplace === 'allegro' ? 'READY_FOR_PROCESSING / NEW' : waitingAcceptance ? 'WAITING_ACCEPTANCE' : 'SHIPPING';
    const number =
      this.marketplace === 'shopify' ? `#${1001 + index}` : this.marketplace === 'allegro' ? externalId.split('-')[0].toUpperCase() : `${210_000 + index}`;
    const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[^\w.]/g, '') + '@example.com';

    return {
      externalId,
      externalNumber: number,
      marketplaceStatus: status,
      readyToShip: !waitingAcceptance,
      cancelled: false,
      fulfilled: false,
      buyer: { name: `${first} ${last}`, email, phone: `5${String(10_000_000 + Math.floor(rand() * 89_999_999))}` },
      shippingAddress: {
        name: `${first} ${last}`,
        street: `${place.street} ${1 + Math.floor(rand() * 120)}${rand() > 0.5 ? `/${1 + Math.floor(rand() * 40)}` : ''}`,
        city: place.city,
        postalCode: place.postalCode,
        countryCode: 'PL',
        phone: `5${String(10_000_000 + Math.floor(rand() * 89_999_999))}`,
        email,
      },
      deliveryMethodId: delivery.id,
      deliveryMethodName: delivery.name,
      pickupPointId: delivery.locker ? place.point : null,
      codAmount: delivery.cod ? total.toFixed(2) : null,
      totalAmount: total.toFixed(2),
      shippingAmount: shipping.toFixed(2),
      currency: 'PLN',
      placedAt,
      paidAt: delivery.cod ? null : placedAt,
      items,
      revision: String(index),
      raw: { mock: true, index },
    };
  }

  /** Cursor = number of orders generated so far. */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    const start = cursor ? Number(cursor) : 0;
    const now = Date.now();
    const orders: NormalizedOrder[] = [];
    if (start === 0) {
      for (let i = 0; i < INITIAL_ORDERS; i++) {
        orders.push(this.buildOrder(i, new Date(now - (INITIAL_ORDERS - i) * 16 * 3600_000 - hash(`${this.accountKey}${i}`) % 3600_000)));
      }
    } else {
      // Roughly one new order every other sync.
      const count = Math.random() < 0.5 ? 1 : 0;
      for (let i = 0; i < count; i++) orders.push(this.buildOrder(start + i, new Date(now)));
    }
    return { orders, nextCursor: String(start + orders.length), hasMore: false };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const index = this.indexOf(externalId);
    return index === null ? null : this.buildOrder(index, new Date());
  }

  async acceptOrder(order: OrderRef): Promise<void> {
    accepted.add(order.externalId);
  }

  async markProcessing(): Promise<void> {}

  async uploadInvoice(): Promise<void> {}

  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    console.log(`[mock ${this.marketplace}] tracking ${tracking.trackingNumber} added to ${order.externalNumber}`);
  }

  async *listListings(): AsyncIterable<Listing> {
    for (const p of MOCK_CATALOG) {
      yield {
        externalId: `${this.marketplace}-${p.sku}`,
        sku: p.sku,
        title: p.name,
        quantity: 60 + (hash(`${this.marketplace}${p.sku}`) % 60),
        ref: { sku: p.sku },
      };
    }
  }

  async setStock(updates: StockUpdate[]): Promise<void> {
    console.log(`[mock ${this.marketplace}] stock set for ${updates.length} listing(s)`);
  }
}
