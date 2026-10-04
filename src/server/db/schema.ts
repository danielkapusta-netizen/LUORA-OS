import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Address, Buyer, InvoiceRequest, ParcelSpec, SenderSettings } from '../integrations/types';

// SQLite on D1: ids are UUID text, timestamps are integer milliseconds, JSON is text.
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const createdAt = () => ts('created_at').notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

export const userRoleValues = ['admin', 'staff'] as const;
export const marketplaceTypeValues = ['shopify', 'allegro', 'empik'] as const;
export const carrierTypeValues = ['inpost', 'allegro_shipping'] as const;
export const orderStatusValues = [
  'new',
  'processing',
  'label_created',
  'shipped',
  'delivered',
  'on_hold',
  'cancelled',
] as const;
export const shipmentStateValues = ['pending', 'created', 'failed', 'cancelled'] as const;
export const labelFormatValues = ['pdf', 'zpl'] as const;
export const labelSizeValues = ['A4', 'A6'] as const;
// 'external' = invoiced outside Luora (marked by hand), so the order leaves "To issue".
export const invoiceStateValues = ['pending', 'issued', 'failed', 'manual', 'external'] as const;
export const invoiceKindValues = ['domestic', 'oss'] as const;

// ---------------------------------------------------------------- users

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: userRoleValues }).notNull().default('staff'),
  createdAt: createdAt(),
});

export const sessions = sqliteTable('sessions', {
  /** SHA-256 of the session token; the raw token only lives in the cookie. */
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- accounts

export interface MarketplaceSettings {
  /** Created by the demo-mode seed; removable from Settings → Integrations. */
  demo?: boolean;
  /** Days of history to import on the first sync. */
  initialSyncDays?: number;
  /** Shopify: note-attribute keys that may hold a parcel locker code. */
  pickupPointKeys?: string[];
  /** Shopify: location whose inventory is kept in sync. */
  locationId?: string;
  /** Shopify: API version, e.g. "2026-07". */
  apiVersion?: string;
  /** Shopify: email the buyer when tracking is added. */
  notifyCustomer?: boolean;
  /** Empik: accept orders automatically when stock covers every line. */
  autoAccept?: boolean;
  /** Empik: carrier codes registered on the marketplace, keyed by our carrier. */
  carrierCodes?: Record<string, string>;
  /** Empik: carriers from SH21, refreshed at most daily. */
  carrierCache?: { fetchedAt: string; carriers: { code: string; label: string; tracking_url?: string | null }[] };
}

export const marketplaceAccounts = sqliteTable('marketplace_accounts', {
  id: id(),
  type: text('type', { enum: marketplaceTypeValues }).notNull(),
  name: text('name').notNull(),
  /** AES-256-GCM encrypted JSON; see src/server/crypto.ts. */
  credentials: text('credentials'),
  settings: json<MarketplaceSettings>('settings').notNull().$defaultFn(() => ({})),
  enabled: bool('enabled').notNull().default(true),
  syncCursor: text('sync_cursor'),
  lastSyncedAt: ts('last_synced_at'),
  lastError: text('last_error'),
  stockSyncEnabled: bool('stock_sync_enabled').notNull().default(false),
  /** When true, stock pushes are only logged, never sent. */
  stockDryRun: bool('stock_dry_run').notNull().default(true),
  createdAt: createdAt(),
});

export interface CarrierSettings {
  /** Created by the demo-mode seed; removable from Settings → Integrations. */
  demo?: boolean;
  labelFormat?: 'pdf' | 'zpl';
  labelSize?: 'A4' | 'A6';
  /** Add the product names to the label reference after the order number (default on). */
  productsInReference?: boolean;
  /** InPost: "dispatch_order" (courier pickup) or "parcel_locker" (you drop parcels at a locker). */
  sendingMethod?: string;
  /** InPost: Paczkomat or point where you drop parcels off (e.g. "ZOF01M"); required by ShipX for parcel_locker, pok and courier_pok. */
  dropoffPoint?: string;
  /** Allegro: bank account for cash on delivery payouts. */
  codIban?: string;
  codOwnerName?: string;
  /** Allegro Delivery: delivery methods that refused a label without insurance (learned automatically). */
  insuranceMethods?: string[];
}

export const carrierAccounts = sqliteTable('carrier_accounts', {
  id: id(),
  type: text('type', { enum: carrierTypeValues }).notNull(),
  name: text('name').notNull(),
  credentials: text('credentials'),
  /** Allegro Delivery reuses the OAuth tokens of an Allegro marketplace account. */
  marketplaceAccountId: text('marketplace_account_id').references(() => marketplaceAccounts.id, {
    onDelete: 'set null',
  }),
  sender: json<SenderSettings>('sender'),
  settings: json<CarrierSettings>('settings').notNull().$defaultFn(() => ({})),
  enabled: bool('enabled').notNull().default(true),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- orders

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    marketplace: text('marketplace', { enum: marketplaceTypeValues }).notNull(),
    externalId: text('external_id').notNull(),
    externalNumber: text('external_number').notNull(),
    marketplaceStatus: text('marketplace_status').notNull(),
    readyToShip: bool('ready_to_ship').notNull().default(true),
    status: text('status', { enum: orderStatusValues }).notNull().default('new'),
    buyer: json<Buyer>('buyer').notNull(),
    shippingAddress: json<Address>('shipping_address').notNull(),
    deliveryMethodId: text('delivery_method_id'),
    deliveryMethodName: text('delivery_method_name'),
    pickupPointId: text('pickup_point_id'),
    codAmount: text('cod_amount'),
    totalAmount: text('total_amount').notNull(),
    shippingAmount: text('shipping_amount'),
    currency: text('currency').notNull(),
    placedAt: ts('placed_at').notNull(),
    paidAt: ts('paid_at'),
    shippedAt: ts('shipped_at'),
    assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    tags: json<string[]>('tags').notNull().$defaultFn(() => []),
    revision: text('revision'),
    /** Stock was decremented for this order (and must be returned if it is cancelled). */
    stockApplied: bool('stock_applied').notNull().default(false),
    /** Who the invoice is made out to, when the buyer asked for one. */
    invoiceRequest: json<InvoiceRequest>('invoice_request'),
    raw: json<unknown>('raw'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_account_external_idx').on(t.accountId, t.externalId),
    index('orders_status_idx').on(t.status),
    index('orders_placed_at_idx').on(t.placedAt),
  ],
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    externalLineId: text('external_line_id').notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: text('unit_price').notNull(),
    externalProductId: text('external_product_id'),
    /** Product photo from the marketplace. */
    imageUrl: text('image_url'),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), index('order_items_sku_idx').on(t.sku)],
);

export const orderEvents = sqliteTable(
  'order_events',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** status | note | sync | label | tracking | stock | error */
    type: text('type').notNull(),
    message: text('message').notNull(),
    data: json<unknown>('data'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------- shipping

export const packagePresets = sqliteTable('package_presets', {
  id: id(),
  name: text('name').notNull(),
  lengthCm: integer('length_cm').notNull(),
  widthCm: integer('width_cm').notNull(),
  heightCm: integer('height_cm').notNull(),
  weightKg: text('weight_kg').notNull(),
  inpostTemplate: text('inpost_template'),
  isDefault: bool('is_default').notNull().default(false),
  createdAt: createdAt(),
});

export interface RuleConditions {
  marketplaces?: ('shopify' | 'allegro' | 'empik')[];
  /** Case-insensitive substring of the buyer's delivery method name. */
  deliveryMethodContains?: string;
  hasPickupPoint?: boolean;
  cod?: boolean;
}

export const shippingRules = sqliteTable('shipping_rules', {
  id: id(),
  name: text('name').notNull(),
  /** Lower number wins. */
  priority: integer('priority').notNull().default(100),
  enabled: bool('enabled').notNull().default(true),
  conditions: json<RuleConditions>('conditions').notNull().$defaultFn(() => ({})),
  carrierAccountId: text('carrier_account_id')
    .notNull()
    .references(() => carrierAccounts.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  packagePresetId: text('package_preset_id').references(() => packagePresets.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const shipmentBatches = sqliteTable('shipment_batches', {
  id: id(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  total: integer('total').notNull(),
  /** Orders that could not be queued, with the reason. */
  skipped: json<{ orderId: string; reason: string }[]>('skipped').notNull().$defaultFn(() => []),
  createdAt: createdAt(),
});

export interface ShipmentOptions {
  codAmount?: string | null;
  insuranceAmount?: string | null;
  pickupPointId?: string | null;
  reference?: string | null;
}

export const shipments = sqliteTable(
  'shipments',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrierAccountId: text('carrier_account_id')
      .notNull()
      .references(() => carrierAccounts.id),
    carrier: text('carrier', { enum: carrierTypeValues }).notNull(),
    service: text('service').notNull(),
    state: text('state', { enum: shipmentStateValues }).notNull().default('pending'),
    /** Carrier's shipment id (InPost shipment id, Allegro shipmentId). */
    externalId: text('external_id'),
    /** Allegro create-command id, kept so a retry polls instead of creating twice. */
    commandId: text('command_id'),
    carrierCode: text('carrier_code'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    parcel: json<ParcelSpec>('parcel').notNull(),
    options: json<ShipmentOptions>('options').notNull().$defaultFn(() => ({})),
    labelFormat: text('label_format', { enum: labelFormatValues }).notNull().default('pdf'),
    labelSize: text('label_size', { enum: labelSizeValues }).notNull().default('A6'),
    error: text('error'),
    pollAttempts: integer('poll_attempts').notNull().default(0),
    trackingPushedAt: ts('tracking_pushed_at'),
    trackingPushError: text('tracking_push_error'),
    deliveryStatus: text('delivery_status'),
    deliveredAt: ts('delivered_at'),
    batchId: text('batch_id').references(() => shipmentBatches.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Set when staff tick "Packed" on the Shipments page. */
    packedAt: ts('packed_at'),
    packedBy: text('packed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one live shipment per order: a double click can't buy two labels.
    uniqueIndex('shipments_one_active_per_order')
      .on(t.orderId)
      .where(sql`state in ('pending', 'created')`),
    index('shipments_batch_idx').on(t.batchId),
    index('shipments_state_idx').on(t.state),
  ],
);

export const labelFiles = sqliteTable('label_files', {
  shipmentId: text('shipment_id')
    .primaryKey()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  format: text('format', { enum: labelFormatValues }).notNull(),
  size: text('size', { enum: labelSizeValues }).notNull(),
  /** R2 object key; the file itself lives in the LABELS bucket. */
  r2Key: text('r2_key').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- inventory

export const products = sqliteTable('products', {
  id: id(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  /** Master stock; every marketplace listing is set to this number. */
  stock: integer('stock').notNull().default(0),
  /** Photo pulled from a marketplace listing (Shopify first), used to fill in order items with no photo of their own. */
  imageUrl: text('image_url'),
  /** Set for products that come from Shopify (the product list's source of truth). */
  shopifyVariantId: text('shopify_variant_id').unique(),
  /** Barcode from Shopify, used to match Empik offers automatically. */
  ean: text('ean'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productListings = sqliteTable(
  'product_listings',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    externalId: text('external_id').notNull(),
    sku: text('sku'),
    title: text('title').notNull(),
    ean: text('ean'),
    ref: json<Record<string, string | number | null>>('ref').notNull().$defaultFn(() => ({})),
    /** Quantity the marketplace reported at the last import. */
    lastSeenQty: integer('last_seen_qty'),
    lastSeenAt: ts('last_seen_at'),
    lastPushedQty: integer('last_pushed_qty'),
    lastPushedAt: ts('last_pushed_at'),
    lastPushError: text('last_push_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_listings_account_external_idx').on(t.accountId, t.externalId),
    index('product_listings_product_idx').on(t.productId),
  ],
);

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    /** order | cancel | manual | import */
    reason: text('reason').notNull(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_product_idx').on(t.productId, t.createdAt)],
);

export const stockSyncLog = sqliteTable(
  'stock_sync_log',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    listingId: text('listing_id').references(() => productListings.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    dryRun: bool('dry_run').notNull(),
    ok: bool('ok').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_sync_log_created_idx').on(t.createdAt)],
);

// ---------------------------------------------------------------- accounting

export interface AccountingSettings {
  /** Create the invoice automatically once a requested order is shipped. */
  autoOnShipped?: boolean;
  uploadAllegro?: boolean;
  uploadEmpik?: boolean;
  /** Send invoices for companies (with a NIP) to KSeF through ifirma. */
  sendB2bToKsef?: boolean;
  /** ifirma numbering series name; empty = the account's default. */
  numberingSeries?: string;
  placeOfIssue?: string;
  issuerSignature?: string;
  /** Polish VAT rate for products and shipping, as a fraction (0.23). */
  defaultVatRate?: number;
  /** OSS: destination-country VAT rates overriding the built-in standard rates, e.g. { CZ: 0.21 }. */
  ossRates?: Record<string, number>;
}

/** Single row: the ifirma connection and invoicing options. */
export const accountingSettings = sqliteTable('accounting_settings', {
  id: text('id').primaryKey().$defaultFn(() => 'main'),
  enabled: bool('enabled').notNull().default(false),
  /** AES-256-GCM encrypted JSON { login, invoiceKey }; see src/server/crypto.ts. */
  credentials: text('credentials'),
  settings: json<AccountingSettings>('settings').notNull().$defaultFn(() => ({})),
  updatedAt: updatedAt(),
});

export const invoices = sqliteTable(
  'invoices',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: invoiceKindValues }).notNull(),
    state: text('state', { enum: invoiceStateValues }).notNull().default('pending'),
    /** ifirma's invoice id. */
    externalId: text('external_id'),
    /** Full invoice number, e.g. "12/10/2026". */
    number: text('number'),
    grossAmount: text('gross_amount').notNull(),
    currency: text('currency').notNull(),
    /** R2 key of the PDF in the LABELS bucket. */
    r2Key: text('r2_key'),
    error: text('error'),
    uploadedAt: ts('uploaded_at'),
    uploadError: text('upload_error'),
    ksefSentAt: ts('ksef_sent_at'),
    ksefStatus: text('ksef_status'),
    ksefError: text('ksef_error'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invoices_order_idx').on(t.orderId),
    // At most one live invoice per order; failed ones can be retried.
    uniqueIndex('invoices_one_live_per_order')
      .on(t.orderId)
      .where(sql`state in ('pending', 'issued')`),
  ],
);

/** Singleton/debounce keys for queued jobs (Cloudflare Queues has no built-in dedupe). */
export const jobLocks = sqliteTable('job_locks', {
  key: text('key').primaryKey(),
  until: ts('until').notNull(),
});

export type User = typeof users.$inferSelect;
export type MarketplaceAccount = typeof marketplaceAccounts.$inferSelect;
export type CarrierAccount = typeof carrierAccounts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderStatus = (typeof orderStatusValues)[number];
export type Shipment = typeof shipments.$inferSelect;
export type ShippingRule = typeof shippingRules.$inferSelect;
export type PackagePreset = typeof packagePresets.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductListing = typeof productListings.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type AccountingSettingsRow = typeof accountingSettings.$inferSelect;
