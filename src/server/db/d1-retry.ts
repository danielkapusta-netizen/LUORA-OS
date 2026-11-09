// D1 sometimes fails a query for a moment ("Network connection lost", a storage timeout, an internal
// error); Cloudflare documents these as safe to retry. Reads are retried twice; writes never are, so a
// retry can't buy a second label or save something twice.

const TRANSIENT = /network connection lost|storage operation exceeded timeout|internal error|reset because its code was updated|overloaded|transient issue/i;

export function isTransientD1Error(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message} ${err.cause instanceof Error ? err.cause.message : ''}` : String(err);
  return TRANSIENT.test(message);
}

/** A read-only statement: safe to run twice. */
export function isReadOnlySql(sql: string): boolean {
  return /^\s*select\b/i.test(sql);
}

/** Waits before each retry: a blip usually clears within a second. */
const RETRY_DELAYS_MS = [200, 600];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function once<T>(readOnly: boolean, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!readOnly || !isTransientD1Error(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      console.warn('[d1] retrying a read after a transient error:', err instanceof Error ? err.message : err);
      await pause(RETRY_DELAYS_MS[attempt]);
    }
  }
}

const inner = new WeakMap<object, D1PreparedStatement>();
const sqlOf = new WeakMap<object, string>();

function wrapStatement(stmt: D1PreparedStatement, sql: string): D1PreparedStatement {
  const readOnly = isReadOnlySql(sql);
  const wrapped = {
    bind: (...values: unknown[]) => wrapStatement(stmt.bind(...values), sql),
    first: (column?: string) => once(readOnly, () => (column === undefined ? stmt.first() : stmt.first(column))),
    all: () => once(readOnly, () => stmt.all()),
    raw: (options?: { columnNames?: boolean }) => once(readOnly, () => stmt.raw(options as { columnNames: true })),
    run: () => once(readOnly, () => stmt.run()),
  } as unknown as D1PreparedStatement;
  inner.set(wrapped, stmt);
  sqlOf.set(wrapped, sql);
  return wrapped;
}

/** The D1 binding with two retries for reads that hit a transient error. */
export function withD1Retry(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql), sql);
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          const plain = statements.map((s) => inner.get(s) ?? s);
          const readOnly = statements.every((s) => isReadOnlySql(sqlOf.get(s) ?? ''));
          return once(readOnly, () => target.batch(plain));
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
