// Returning customers on the Orders list, against a local D1 database with the demo marketplaces.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('returning customers (D1)', { timeout: 90_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-returning-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    orders: typeof import('@/server/services/orders');
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
    };
    for (const a of await m.db.getDb().select().from(m.schema.marketplaceAccounts)) await m.orders.syncAccount(a.id);
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  const all = () => m.db.getDb().select().from(m.schema.orders);

  it('marks exactly the orders whose customer ordered (and did not cancel) before', async () => {
    const orders = await all();
    const byCustomer = new Map<string, typeof orders>();
    for (const o of orders) if (o.customerId && o.status !== 'cancelled') byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
    const expected = new Map<string, number>();
    for (const list of byCustomer.values()) {
      const sorted = [...list].sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
      sorted.forEach((o) => {
        const earlier = sorted.filter((p) => p.placedAt.getTime() < o.placedAt.getTime()).length;
        if (earlier > 0) expected.set(o.id, earlier + 1);
      });
    }
    expect(expected.size).toBeGreaterThan(0);

    const info = await m.orders.returningInfo(orders.map((o) => ({ id: o.id, customerId: o.customerId, placedAt: o.placedAt })));
    expect(new Map([...info].map(([id, v]) => [id, v.orderNumber]))).toEqual(expected);
    for (const [id, v] of info) {
      const order = orders.find((o) => o.id === id)!;
      expect(v.firstOrderAt.getTime()).toBeLessThan(order.placedAt.getTime());
    }
  });

  it('lists the flag on the rows and filters to returning customers only', async () => {
    const everything = await m.orders.listOrders({ page: 1 });
    const flagged = everything.rows.filter((r) => r.returning).map((r) => r.order.id);
    expect(flagged.length).toBeGreaterThan(0);
    const only = await m.orders.listOrders({ returning: true, page: 1 });
    expect(only.rows.every((r) => r.returning)).toBe(true);
    expect(only.total).toBeGreaterThan(0);
    expect(only.total).toBeLessThanOrEqual(everything.total);
    expect(only.rows.every((r) => flagged.includes(r.order.id) || everything.total > everything.rows.length)).toBe(true);
  });

  it('does not count a cancelled earlier order, and leaves unlinked orders unmarked', async () => {
    const db = m.db.getDb();
    const orders = await all();
    const target = [...(await m.orders.listOrders({ returning: true, page: 1 })).rows].find((r) => r.returning?.orderNumber === 2)!;
    const customerId = target.order.customerId!;
    const earlier = orders.filter((o) => o.customerId === customerId && o.placedAt.getTime() < target.order.placedAt.getTime() && o.status !== 'cancelled');
    for (const o of earlier) await db.update(m.schema.orders).set({ status: 'cancelled' }).where(m.orm.eq(m.schema.orders.id, o.id));
    const info = await m.orders.returningInfo([{ id: target.order.id, customerId, placedAt: target.order.placedAt }]);
    expect(info.has(target.order.id)).toBe(false);
    expect((await m.orders.returningInfo([{ id: 'x', customerId: null, placedAt: new Date() }])).size).toBe(0);
  });
});
