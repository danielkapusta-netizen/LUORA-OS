import { describe, expect, it, vi } from 'vitest';
import { errorMessage } from '@/lib/action-result';
import { isReadOnlySql, isTransientD1Error, withD1Retry } from '@/server/db/d1-retry';

function fakeD1(fail: (sql: string, call: number) => Error | null) {
  const calls: string[] = [];
  const statement = (sql: string): D1PreparedStatement =>
    ({
      bind: () => statement(sql),
      all: async () => {
        calls.push(sql);
        const err = fail(sql, calls.filter((c) => c === sql).length);
        if (err) throw err;
        return { results: [{ ok: 1 }], success: true, meta: {} };
      },
      run: async () => {
        calls.push(sql);
        const err = fail(sql, calls.filter((c) => c === sql).length);
        if (err) throw err;
        return { results: [], success: true, meta: {} };
      },
    }) as unknown as D1PreparedStatement;
  return { db: { prepare: (sql: string) => statement(sql), batch: async () => [] } as unknown as D1Database, calls };
}

describe('D1 retry', () => {
  it('recognises transient errors and read-only statements', () => {
    expect(isTransientD1Error(new Error('D1_ERROR: Network connection lost.'))).toBe(true);
    expect(isTransientD1Error(new Error('Failed query: select 1', { cause: new Error('D1_ERROR: storage operation exceeded timeout') }))).toBe(true);
    expect(isTransientD1Error(new Error('UNIQUE constraint failed'))).toBe(false);
    expect(isReadOnlySql('select "id" from "orders"')).toBe(true);
    expect(isReadOnlySql('insert into "shipments" …')).toBe(false);
  });

  it('retries a read after a transient error', async () => {
    vi.useFakeTimers();
    const { db, calls } = fakeD1((sql, n) => (n === 1 ? new Error('D1_ERROR: Network connection lost.') : null));
    const read = withD1Retry(db).prepare('select 1').bind().all();
    await vi.runAllTimersAsync();
    expect((await read).results).toEqual([{ ok: 1 }]);
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('gives up on a read after two retries', async () => {
    vi.useFakeTimers();
    const { db, calls } = fakeD1(() => new Error('D1_ERROR: Network connection lost.'));
    const read = withD1Retry(db).prepare('select 1').bind().all();
    const settled = read.catch((err: Error) => err);
    await vi.runAllTimersAsync();
    expect(((await settled) as Error).message).toContain('Network connection lost');
    expect(calls).toHaveLength(3);
    vi.useRealTimers();
  });

  it('never retries a write', async () => {
    const { db, calls } = fakeD1(() => new Error('D1_ERROR: Network connection lost.'));
    await expect(withD1Retry(db).prepare('insert into t values (1)').bind().run()).rejects.toThrow('Network connection lost');
    expect(calls).toHaveLength(1);
  });

  it('shows the reason instead of the SQL', () => {
    expect(errorMessage(new Error('Failed query: select "id" from "orders"', { cause: new Error('D1_ERROR: no such column: x') }))).toBe('D1_ERROR: no such column: x');
    expect(errorMessage(new Error('Failed query: select 1', { cause: new Error('D1_ERROR: Network connection lost.') }))).toBe('The database was briefly unavailable. Try again.');
    expect(errorMessage(new Error('Order not found'))).toBe('Order not found');
  });
});
