// Creates the first admin user and default package presets. In mock mode it also
// adds demo marketplace and carrier accounts plus the default shipping rules.
import { eq, inArray } from 'drizzle-orm';
import type { Role } from '../../lib/permissions';
import { hashPassword } from '../crypto';
import { isMockMode } from '../env';
import { MOCK_CATALOG } from '../integrations/marketplaces/mock/adapter';
import { setProductCost } from '../services/costs';
import { importListings } from '../services/inventory';
import { createDefaultRules, ensureDefaultPresets } from '../services/settings';
import { DEMO_USER_DOMAIN } from '../services/tasks';
import { seedDemoTasks } from './seed-tasks';
import { getDb } from './client';
import { carrierAccounts, marketplaceAccounts, products, shippingRules, users } from './schema';

const DEMO_SENDER = {
  name: 'Magazyn Luora',
  company: 'Luora sp. z o.o.',
  street: 'ul. Magazynowa 5',
  city: 'Warszawa',
  postalCode: '02-222',
  countryCode: 'PL',
  phone: '500600700',
  email: 'wysylka@example.com',
};

export async function seed(admin: { email?: string; password?: string } = {}): Promise<void> {
  const db = getDb();
  const email = (admin.email ?? process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = admin.password ?? process.env.ADMIN_PASSWORD ?? 'change-me-please';
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!existing) {
    await db.insert(users).values({ email, name: 'Admin', role: 'admin', passwordHash: await hashPassword(password) });
    console.log(`Created admin ${email}`);
  }
  const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  await ensureDefaultPresets();

  if (!isMockMode()) return;
  const accounts = await db.select({ id: marketplaceAccounts.id }).from(marketplaceAccounts).limit(1);
  if (accounts.length) return;

  const created = await db
    .insert(marketplaceAccounts)
    .values([
      { type: 'shopify', name: 'Shopify (demo)', stockSyncEnabled: true, settings: { demo: true } },
      { type: 'allegro', name: 'Allegro (demo)', stockSyncEnabled: true, settings: { demo: true } },
      { type: 'empik', name: 'Empik (demo)', stockSyncEnabled: true, settings: { demo: true, autoAccept: false } },
    ])
    .returning({ id: marketplaceAccounts.id });
  const allegro = created[1];
  await db.insert(carrierAccounts).values([
    { type: 'inpost', name: 'InPost (demo)', sender: DEMO_SENDER, settings: { demo: true, labelFormat: 'pdf', labelSize: 'A6' } },
    {
      type: 'allegro_shipping',
      name: 'Allegro Delivery (demo)',
      marketplaceAccountId: allegro.id,
      sender: DEMO_SENDER,
      settings: { demo: true, labelFormat: 'pdf', labelSize: 'A6' },
    },
  ]);
  const rules = await db.select({ id: shippingRules.id }).from(shippingRules).limit(1);
  if (rules.length === 0) await createDefaultRules();
  // Demo products: every mock listing shares the same SKUs, so they link across marketplaces.
  for (const account of created) await importListings(account.id);
  // Demo landed costs, so margins show from the start.
  const demo = await db.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.sku, MOCK_CATALOG.map((p) => p.sku)));
  for (const p of demo) {
    const price = MOCK_CATALOG.find((c) => c.sku === p.sku)!.price;
    await setProductCost(p.id, { unitCost: Math.round(price * 0.32 * 100) / 100 }, null, 'manual');
  }
  // Two colleagues, so tasks can be shared out in the demo (they share the admin's password).
  const colleague = async (name: string, mail: string, role: Role) => {
    const address = `${mail}@${DEMO_USER_DOMAIN}`;
    const [found] = await db.select({ id: users.id }).from(users).where(eq(users.email, address));
    if (found) return found.id;
    const [row] = await db.insert(users).values({ email: address, name, role, passwordHash: await hashPassword(password) }).returning({ id: users.id });
    return row.id;
  };
  await seedDemoTasks({ admin: adminUser.id, ola: await colleague('Ola Nowak', 'ola', 'logistics'), marek: await colleague('Marek Zieliński', 'marek', 'marketing') });
  console.log('Created demo accounts, shipping rules and tasks (mock mode)');
}
