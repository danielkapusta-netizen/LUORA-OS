// Roles against a local D1 database: the courier summary for logistics, role changes and the last-admin guard.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('roles (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-roles-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    orders: typeof import('@/server/services/orders');
    settings: typeof import('@/server/services/settings');
  };

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    (await import('@/server/jobs/queue')).setEnqueueImplementation(async () => undefined);
    await (await import('@/server/db/seed')).seed();
    m = {
      db: await import('@/server/db/client'),
      schema: await import('@/server/db/schema'),
      orm: await import('drizzle-orm'),
      orders: await import('@/server/services/orders'),
      settings: await import('@/server/services/settings'),
    };
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  it('seeds the demo colleagues with the logistics and marketing roles', async () => {
    const rows = await m.settings.listUsers();
    expect(rows.map((u) => u.role).sort()).toEqual(['admin', 'logistics', 'marketing']);
  });

  it('counts the orders still to send by courier, matching the open order counts', async () => {
    for (const a of await m.db.getDb().select().from(m.schema.marketplaceAccounts)) await m.orders.syncAccount(a.id);
    const couriers = await m.orders.ordersToShipByCourier();
    const counts = await m.orders.statusCounts();
    const toSend = (counts.new ?? 0) + (counts.processing ?? 0) + (counts.label_created ?? 0);
    expect(toSend).toBeGreaterThan(0);
    expect(couriers.reduce((sum, c) => sum + c.count, 0)).toBe(toSend);
    expect(couriers.reduce((sum, c) => sum + c.labelled, 0)).toBe(counts.label_created ?? 0);
    expect(couriers.map((c) => c.count)).toEqual([...couriers.map((c) => c.count)].sort((a, b) => b - a));
  });

  it('changes a role, and never leaves the system without an admin', async () => {
    const rows = await m.settings.listUsers();
    const admin = rows.find((u) => u.role === 'admin')!;
    const marketing = rows.find((u) => u.role === 'marketing')!;
    await m.settings.setUserRole(marketing.id, 'logistics');
    expect((await m.settings.listUsers()).find((u) => u.id === marketing.id)!.role).toBe('logistics');
    await expect(m.settings.setUserRole(admin.id, 'marketing')).rejects.toThrow('at least one admin');
    await expect(m.settings.deleteUser(admin.id)).rejects.toThrow('at least one admin');
    await m.settings.setUserRole(marketing.id, 'admin');
    await m.settings.setUserRole(admin.id, 'marketing');
    expect((await m.settings.listUsers()).filter((u) => u.role === 'admin')).toHaveLength(1);
    await expect(m.settings.setUserRole(marketing.id, 'boss' as never)).rejects.toThrow('Unknown role');
  });

  it('the migration turns staff into logistics and leaves admins alone', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(path.join(process.cwd(), 'drizzle/0012_roles.sql'), 'utf8');
    const db = m.db.getDb();
    await db.run(m.orm.sql`update users set role = 'staff' where role = 'logistics'`);
    await db.run(m.orm.sql.raw(sql.replace(/;\s*$/, '')));
    const roles = (await m.settings.listUsers()).map((u) => u.role);
    expect(roles).not.toContain('staff');
    expect(roles).toContain('admin');
  });
});
