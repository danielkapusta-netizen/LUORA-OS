import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/jobs/handlers', () => ({ runJob: vi.fn() }));
vi.mock('@/server/cf', () => ({ setCfEnv: vi.fn(), getCfEnv: vi.fn() }));
vi.mock('@/server/db/client', () => ({ getDb: () => ({ delete: () => ({ where: async () => undefined }) }) }));

const { runJob } = await import('@/server/jobs/handlers');
const { handleBatch, handleScheduled, CRON_JOBS } = await import('@/worker/consumer');

function message(name: string, attempts = 1) {
  return { body: { name, data: {} }, attempts, ack: vi.fn(), retry: vi.fn() };
}

const run = (msgs: ReturnType<typeof message>[]) => handleBatch({ messages: msgs } as never, {} as never);

afterEach(() => vi.mocked(runJob).mockReset());

describe('queue consumer', () => {
  it('acks successful jobs', async () => {
    const m = message('orders-sync');
    await run([m]);
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
  });

  it('retries failures with backoff until the retry budget is used', async () => {
    vi.mocked(runJob).mockRejectedValue(new Error('boom'));
    const first = message('tracking-push', 1);
    const third = message('tracking-push', 3);
    const last = message('tracking-push', 6);
    await run([first, third, last]);
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(third.retry).toHaveBeenCalledWith({ delaySeconds: 240 });
    expect(last.ack).toHaveBeenCalled();
  });

  it('never retries a label purchase', async () => {
    vi.mocked(runJob).mockRejectedValue(new Error('carrier down'));
    const m = message('shipment-create');
    await run([m]);
    expect(m.retry).not.toHaveBeenCalled();
    expect(m.ack).toHaveBeenCalled();
  });
});

describe('cron', () => {
  it('maps every wrangler cron to a job', async () => {
    const wrangler = (await import('node:fs')).readFileSync('wrangler.jsonc', 'utf8');
    const crons = JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, '')).triggers.crons as string[];
    expect(crons.sort()).toEqual(Object.keys(CRON_JOBS).sort());
    await handleScheduled({ cron: '*/3 * * * *' } as never, {} as never);
    expect(runJob).toHaveBeenCalledWith('orders-sync-all', {});
  });

  it('runs every job sharing a schedule, even when one of them fails', async () => {
    vi.mocked(runJob).mockImplementation(async (name) => {
      if (name === 'stock-reconcile') throw new Error('marketplace down');
    });
    await handleScheduled({ cron: '30 2 * * *' } as never, {} as never);
    expect(runJob).toHaveBeenCalledWith('stock-reconcile', {});
    expect(runJob).toHaveBeenCalledWith('fx-sync', {});
  });
});
