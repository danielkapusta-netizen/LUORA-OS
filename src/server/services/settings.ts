import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getCfEnv } from '../cf';
import { encryptJson, hashPassword } from '../crypto';
import { chunk, getDb } from '../db/client';
import {
  carrierAccounts,
  labelFiles,
  marketplaceAccounts,
  orders,
  packagePresets,
  shipments,
  shippingRules,
  users,
  type CarrierSettings,
  type MarketplaceSettings,
  type RuleConditions,
} from '../db/schema';
import type { SenderSettings } from '../integrations/types';
import { BUYER_CHOICE } from '../integrations/carriers/allegro-shipping/adapter';
import { EmpikAdapter } from '../integrations/marketplaces/empik/adapter';
import { MOCK_CATALOG } from '../integrations/marketplaces/mock/adapter';
import { getCarrierAdapter, getMarketplaceAdapter, loadCarrierAccount, loadMarketplaceAccount, readCredentials, withConfigured } from './accounts';

export const DEFAULT_PRESETS = [
  { name: 'Paczkomat A (small)', lengthCm: 64, widthCm: 38, heightCm: 8, weightKg: '5', inpostTemplate: 'small', isDefault: false },
  { name: 'Paczkomat B (medium)', lengthCm: 64, widthCm: 38, heightCm: 19, weightKg: '10', inpostTemplate: 'medium', isDefault: false },
  { name: 'Paczkomat C (large)', lengthCm: 64, widthCm: 38, heightCm: 41, weightKg: '25', inpostTemplate: 'large', isDefault: false },
  { name: 'Box 30×20×10 cm, 1 kg', lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: '1', inpostTemplate: 'small', isDefault: true },
];

export async function ensureDefaultPresets(): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: packagePresets.id }).from(packagePresets).limit(1);
  if (existing.length === 0) await db.insert(packagePresets).values(DEFAULT_PRESETS);
}

/**
 * Default routing: Allegro orders use the Allegro Delivery account linked to the
 * same Allegro account (buyer's method), orders with a pickup point go to an InPost
 * locker, the rest by InPost courier. Only carriers with working credentials are used.
 */
export async function createDefaultRules(): Promise<number> {
  const db = getDb();
  await ensureDefaultPresets();
  const carriers = (await withConfigured(await db.select().from(carrierAccounts).orderBy(asc(carrierAccounts.createdAt)))).filter(
    (c) => c.enabled && c.configured,
  );
  const presets = await db.select().from(packagePresets);
  const inpost = carriers.find((c) => c.type === 'inpost');
  const lockerPreset = presets.find((p) => p.inpostTemplate === 'small' && !p.isDefault) ?? presets[0];
  const defaultPreset = presets.find((p) => p.isDefault) ?? presets[0];

  const rules: (typeof shippingRules.$inferInsert)[] = [];
  // Routing matches each one to orders from its own Allegro account.
  for (const allegro of carriers.filter((c) => c.type === 'allegro_shipping')) {
    rules.push({ name: `Allegro orders → ${allegro.name}`, priority: 10, conditions: { marketplaces: ['allegro'] }, carrierAccountId: allegro.id, service: BUYER_CHOICE, packagePresetId: defaultPreset?.id });
  }
  if (inpost) {
    rules.push({ name: 'Pickup point → InPost Paczkomat', priority: 20, conditions: { hasPickupPoint: true }, carrierAccountId: inpost.id, service: 'inpost_locker_standard', packagePresetId: lockerPreset?.id });
    rules.push({ name: 'Everything else → InPost courier', priority: 30, conditions: {}, carrierAccountId: inpost.id, service: 'inpost_courier_standard', packagePresetId: defaultPreset?.id });
  }
  if (rules.length) await db.insert(shippingRules).values(rules);
  return rules.length;
}

// ---------------------------------------------------------------- demo data

const isDemo = (a: { name: string; settings: { demo?: boolean } }) => a.settings.demo === true || a.name.endsWith('(demo)');

export async function demoAccountCount(): Promise<number> {
  const db = getDb();
  const [markets, carriers] = await Promise.all([db.select().from(marketplaceAccounts), db.select().from(carrierAccounts)]);
  return markets.filter(isDemo).length + carriers.filter(isDemo).length;
}

/**
 * Deletes the accounts created by the demo-mode seed with everything hanging off them:
 * orders (with items, events, shipments and label files in R2), listings, carriers
 * and their shipping rules, and demo products nothing else uses.
 */
export async function removeDemoData(): Promise<{ accounts: number; carriers: number; orders: number }> {
  const db = getDb();
  const markets = (await db.select().from(marketplaceAccounts)).filter(isDemo);
  const carriers = (await db.select().from(carrierAccounts)).filter(isDemo);
  const marketIds = markets.map((m) => m.id);
  const carrierIds = carriers.map((c) => c.id);

  const affected = [];
  for (const ids of chunk(marketIds)) {
    affected.push(...(await db.select({ id: orders.id }).from(orders).where(inArray(orders.accountId, ids))));
  }
  const orderIds = affected.map((o) => o.id);

  // Shipments of demo orders or bought through demo carriers, and their label files.
  const shipmentRows = [];
  for (const ids of chunk(orderIds)) shipmentRows.push(...(await db.select({ id: shipments.id }).from(shipments).where(inArray(shipments.orderId, ids))));
  for (const ids of chunk(carrierIds)) shipmentRows.push(...(await db.select({ id: shipments.id }).from(shipments).where(inArray(shipments.carrierAccountId, ids))));
  const shipmentIds = [...new Set(shipmentRows.map((s) => s.id))];
  for (const ids of chunk(shipmentIds)) {
    const files = await db.select({ key: labelFiles.r2Key }).from(labelFiles).where(inArray(labelFiles.shipmentId, ids));
    if (files.length) await getCfEnv().LABELS.delete(files.map((f) => f.key));
    await db.delete(shipments).where(inArray(shipments.id, ids));
  }

  // Carriers first (their rules cascade), then accounts (orders, items, events and listings cascade).
  for (const ids of chunk(carrierIds)) await db.delete(carrierAccounts).where(inArray(carrierAccounts.id, ids));
  for (const ids of chunk(marketIds)) await db.delete(marketplaceAccounts).where(inArray(marketplaceAccounts.id, ids));

  // Demo products that no longer have listings or order lines.
  const demoSkus = MOCK_CATALOG.map((p) => p.sku);
  await db.run(sql`
    delete from products where sku in (${sql.join(demoSkus.map((s) => sql`${s}`), sql`, `)})
      and not exists (select 1 from product_listings l where l.product_id = products.id)
      and not exists (select 1 from order_items i where i.product_id = products.id)`);

  return { accounts: markets.length, carriers: carriers.length, orders: orderIds.length };
}

// ---------------------------------------------------------------- marketplace accounts

export async function listMarketplaceAccounts() {
  return getDb().select().from(marketplaceAccounts).orderBy(asc(marketplaceAccounts.createdAt));
}

export async function saveMarketplaceAccount(input: {
  id?: string;
  type: 'shopify' | 'allegro' | 'empik' | 'vonhalsky';
  name: string;
  /** Only fields that were filled in; blank secrets keep their stored value. */
  credentials: Record<string, unknown>;
  settings: MarketplaceSettings;
  enabled: boolean;
  stockSyncEnabled: boolean;
  stockDryRun: boolean;
}): Promise<string> {
  const db = getDb();
  if (input.id) {
    const existing = await loadMarketplaceAccount(input.id);
    const merged = { ...(readCredentials<Record<string, unknown>>(existing.credentials) ?? {}), ...input.credentials };
    await db
      .update(marketplaceAccounts)
      .set({
        name: input.name,
        credentials: Object.keys(merged).length ? encryptJson(merged) : null,
        settings: { ...existing.settings, ...input.settings },
        enabled: input.enabled,
        stockSyncEnabled: input.stockSyncEnabled,
        stockDryRun: input.stockDryRun,
      })
      .where(eq(marketplaceAccounts.id, input.id));
    return input.id;
  }
  const [row] = await db
    .insert(marketplaceAccounts)
    .values({
      type: input.type,
      name: input.name,
      credentials: Object.keys(input.credentials).length ? encryptJson(input.credentials) : null,
      settings: input.settings,
      enabled: input.enabled,
      stockSyncEnabled: input.stockSyncEnabled,
      stockDryRun: input.stockDryRun,
    })
    .returning({ id: marketplaceAccounts.id });
  return row.id;
}

export async function deleteMarketplaceAccount(id: string): Promise<void> {
  await getDb().delete(marketplaceAccounts).where(eq(marketplaceAccounts.id, id));
}

/** Which credential fields are stored (never their values), for the settings form. */
export function storedCredentialKeys(encrypted: string | null): string[] {
  const creds = readCredentials<Record<string, unknown>>(encrypted);
  return creds ? Object.keys(creds).filter((k) => creds[k] !== undefined && creds[k] !== '') : [];
}

/** Non-secret credential fields that are safe to show in forms. */
export function publicCredentialFields(encrypted: string | null): Record<string, string | boolean> {
  const creds = readCredentials<Record<string, unknown>>(encrypted) ?? {};
  const out: Record<string, string | boolean> = {};
  for (const key of ['shopDomain', 'clientId', 'baseUrl', 'shopId', 'organizationId', 'sandbox']) {
    const value = creds[key];
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export async function testMarketplaceConnection(id: string): Promise<string> {
  return getMarketplaceAdapter(await loadMarketplaceAccount(id)).checkConnection();
}

// ---------------------------------------------------------------- carrier accounts

export async function listCarrierAccounts() {
  return getDb().select().from(carrierAccounts).orderBy(asc(carrierAccounts.createdAt));
}

export async function saveCarrierAccount(input: {
  id?: string;
  type: 'inpost' | 'allegro_shipping';
  name: string;
  credentials: Record<string, unknown>;
  marketplaceAccountId: string | null;
  sender: SenderSettings;
  settings: CarrierSettings;
  enabled: boolean;
}): Promise<string> {
  const db = getDb();
  if (input.id) {
    const existing = await loadCarrierAccount(input.id);
    const merged = { ...(readCredentials<Record<string, unknown>>(existing.credentials) ?? {}), ...input.credentials };
    await db
      .update(carrierAccounts)
      .set({
        name: input.name,
        credentials: Object.keys(merged).length ? encryptJson(merged) : null,
        marketplaceAccountId: input.marketplaceAccountId,
        sender: input.sender,
        settings: { ...existing.settings, ...input.settings },
        enabled: input.enabled,
      })
      .where(eq(carrierAccounts.id, input.id));
    return input.id;
  }
  const [row] = await db
    .insert(carrierAccounts)
    .values({
      type: input.type,
      name: input.name,
      credentials: Object.keys(input.credentials).length ? encryptJson(input.credentials) : null,
      marketplaceAccountId: input.marketplaceAccountId,
      sender: input.sender,
      settings: input.settings,
      enabled: input.enabled,
    })
    .returning({ id: carrierAccounts.id });
  return row.id;
}

export async function deleteCarrierAccount(id: string): Promise<void> {
  await getDb().delete(carrierAccounts).where(eq(carrierAccounts.id, id));
}

export async function testCarrierConnection(id: string): Promise<string> {
  const services = await (await getCarrierAdapter(await loadCarrierAccount(id))).services();
  return `${services.length} service(s) available`;
}

// ---------------------------------------------------------------- rules & presets

export async function saveRule(input: {
  id?: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  carrierAccountId: string;
  service: string;
  packagePresetId: string | null;
}): Promise<void> {
  const db = getDb();
  const { id, ...values } = input;
  if (id) await db.update(shippingRules).set(values).where(eq(shippingRules.id, id));
  else await db.insert(shippingRules).values(values);
}

export async function deleteRule(id: string): Promise<void> {
  await getDb().delete(shippingRules).where(eq(shippingRules.id, id));
}

export async function savePreset(input: {
  id?: string;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: string;
  inpostTemplate: string | null;
  isDefault: boolean;
}): Promise<void> {
  const db = getDb();
  const { id, ...values } = input;
  const save = id ? db.update(packagePresets).set(values).where(eq(packagePresets.id, id)) : db.insert(packagePresets).values(values);
  if (input.isDefault) await db.batch([db.update(packagePresets).set({ isDefault: false }), save]);
  else await save;
}

export async function deletePreset(id: string): Promise<void> {
  await getDb().delete(packagePresets).where(eq(packagePresets.id, id));
}

// ---------------------------------------------------------------- users

export async function listUsers() {
  return getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function createUser(input: { email: string; name: string; password: string; role: 'admin' | 'staff' }): Promise<void> {
  if (input.password.length < 8) throw new Error('Password must have at least 8 characters');
  await getDb()
    .insert(users)
    .values({ email: input.email.trim().toLowerCase(), name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) });
}

export async function deleteUser(id: string): Promise<void> {
  await getDb().delete(users).where(eq(users.id, id));
}

export async function resetPassword(id: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error('Password must have at least 8 characters');
  await getDb().update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
}

/** Empik carriers (SH21) for the settings dropdowns; empty in demo mode or when Empik can't be reached. */
export async function empikCarriers(accountId: string, refresh = false): Promise<{ code: string; label: string }[]> {
  const adapter = getMarketplaceAdapter(await loadMarketplaceAccount(accountId));
  if (!(adapter instanceof EmpikAdapter)) return [];
  return adapter.carriers(refresh);
}
