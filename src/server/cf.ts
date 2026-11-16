// Access to Cloudflare bindings (D1, Queues, R2) from anywhere on the server.
// Inside Next.js requests they come from OpenNext's request context; the queue
// and cron handlers (and tests/scripts) install them with setCfEnv().
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { JobMessage } from './jobs/queue';

export interface CfEnv {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  LABELS: R2Bucket;
  /** OAuth grants and tokens for the MCP endpoint; the endpoint stays closed without it. */
  OAUTH_KV?: KVNamespace;
}

const holder = globalThis as unknown as { __luoraCfEnv?: CfEnv };

export function setCfEnv(env: CfEnv | undefined): void {
  holder.__luoraCfEnv = env;
}

export function getCfEnv(): CfEnv {
  if (holder.__luoraCfEnv) return holder.__luoraCfEnv;
  return getCloudflareContext().env as unknown as CfEnv;
}
