// Importing a purchase invoice into product costs, against a local D1 database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('purchase invoice import (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-invoice-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    costs: typeof import('@/server/services/costs');
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
      costs: await import('@/server/services/costs'),
    };
    await m.db.getDb().insert(m.schema.fxRates).values({ currency: 'EUR', day: '2026-10-05', rate: 4.3855 });
    await m.db.getDb().insert(m.schema.products).values([
      { sku: 'INV-A', name: 'Invoice Cream A 50 ml', ean: '8809562191438', stock: 0 },
      { sku: 'INV-B', name: 'Invoice Toner B 150 ml', ean: null, stock: 0 },
    ]);
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  const base = { currency: 'EUR', effectiveFrom: '2026-10-05', vatIncluded: false, vatRate: 0.23, deliveryTotal: 10, deliveryIncludesVat: true, extraPln: 0 };
  const entry = async (sku: string) => {
    const [p] = await m.db.getDb().select().from(m.schema.products).where(m.orm.eq(m.schema.products.sku, sku));
    return (await m.costs.costHistory(p.id))[0];
  };

  it('checks without saving, then saves net price + delivery share at the NBP rate of the day', async () => {
    const lines = '8809562191438;3;6.25\nInvoice Toner B 150 ml;7;5.00\n8809000000000;2;9.99';
    const check = await m.costs.importInvoice({ ...base, lines, preview: true }, null);
    expect(check.saved).toBe(0);
    expect(check.pieces).toBe(12);
    expect(check.unmatched).toEqual(['8809000000000']);
    expect(await entry('INV-A')).toBeUndefined();

    const done = await m.costs.importInvoice({ ...base, lines, invoiceNumber: 'PI1' }, null);
    expect(done.saved).toBe(2);
    const freight = (10 / 1.23 / 12) * 4.3855;
    const a = await entry('INV-A');
    expect(a).toMatchObject({ source: 'invoice', purchaseCurrency: 'EUR', purchasePrice: '6.25', effectiveFrom: '2026-10-05', note: 'Invoice PI1' });
    expect(Number(a.unitCost)).toBeCloseTo(6.25 * 4.3855 + freight, 3);
    expect(Number(a.freight)).toBeCloseTo(freight, 3);
    // Saving the same invoice again replaces the entries instead of adding more.
    await m.costs.importInvoice({ ...base, lines }, null);
    const [p] = await m.db.getDb().select().from(m.schema.products).where(m.orm.eq(m.schema.products.sku, 'INV-A'));
    expect(await m.costs.costHistory(p.id)).toHaveLength(1);
  });

  it('takes VAT out of gross prices, adds extras, and averages a product listed twice', async () => {
    const r = await m.costs.importInvoice(
      { ...base, vatIncluded: true, deliveryTotal: 0, extraPln: 30, effectiveFrom: '2026-10-05', lines: '8809562191438;1;12.30\n8809562191438;3;24.60' },
      null,
    );
    expect(r.lines).toHaveLength(1);
    const a = await entry('INV-A');
    // (1 x 10 + 3 x 20) / 4 = 17.50 net, plus 30 PLN / 4 pieces of extras.
    expect(Number(a.purchasePrice)).toBeCloseTo(17.5, 4);
    expect(Number(a.unitCost)).toBeCloseTo(17.5 * 4.3855 + 7.5, 3);
  });

  it('refuses a missing date, empty input and a currency without a rate', async () => {
    await expect(m.costs.importInvoice({ ...base, effectiveFrom: '', lines: '1;2;3' }, null)).rejects.toThrow('invoice date');
    await expect(m.costs.importInvoice({ ...base, lines: 'nothing here' }, null)).rejects.toThrow('No lines');
  });
});
