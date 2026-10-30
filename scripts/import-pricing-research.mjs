// Reads catalog mappings or imports research. It never calls a marketplace price-update API.
import { readFile } from 'node:fs/promises';

async function main() {
  const args = process.argv.slice(2);
  const catalog = args.length === 1 && args[0] === '--catalog';
  const file = args.length === 2 && args[0] === '--file' ? args[1] : null;
  if (!catalog && !file) throw new Error('Usage: node scripts/import-pricing-research.mjs --catalog | --file research.json');
  const base = new URL(process.env.LUORA_OS_URL ?? 'https://luora-os.danielkapusta.workers.dev');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) throw new Error('LUORA_OS_URL must be an HTTPS origin (HTTP is allowed for localhost)');
  const token = process.env.PRICING_RESEARCH_API_TOKEN;
  if (!token || token.length < 32) throw new Error('Set PRICING_RESEARCH_API_TOKEN securely in the environment');
  async function request(path, body) {
    const response = await fetch(new URL(path, base), {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Research API ${response.status}: ${result.error ?? 'Request failed'}`);
    return result;
  }
  if (catalog) {
    let cursor = null;
    const products = [];
    let accounts = [];
    const seen = new Set();
    do {
      const page = await request(`/api/pricing/recommendations/catalog${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
      accounts = page.accounts; products.push(...page.products); cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Catalog cursor repeated; retry later');
      if (cursor) seen.add(cursor);
    } while (cursor);
    console.log(JSON.stringify({ accounts, products }, null, 2));
    return;
  }
  const input = JSON.parse(await readFile(file, 'utf8'));
  if (!input || typeof input.runId !== 'string' || !Array.isArray(input.recommendations) || input.recommendations.length === 0 || Object.keys(input).some(key => !['runId', 'recommendations'].includes(key))) throw new Error('The file must contain only runId and a nonempty recommendations array');
  const keys = new Set();
  for (const r of input.recommendations) {
    const key = JSON.stringify([r.shopifyVariantId, r.accountId]);
    if (keys.has(key)) throw new Error('Duplicate product/account in the file');
    keys.add(key);
  }
  const totals = { received: 0, applied: 0, ignoredOlderOrEqual: 0 };
  let offset = 0;
  while (offset < input.recommendations.length) {
    const batch = [];
    while (offset + batch.length < input.recommendations.length && batch.length < 100) {
      const next = input.recommendations[offset + batch.length];
      if (Buffer.byteLength(JSON.stringify({ runId: input.runId, recommendations: [...batch, next] }), 'utf8') > 512 * 1024) break;
      batch.push(next);
    }
    if (batch.length === 0) throw new Error(`Record ${offset + 1} exceeds the API size limit`);
    const result = await request('/api/pricing/recommendations', { runId: input.runId, recommendations: batch });
    for (const key of Object.keys(totals)) totals[key] += result[key];
    console.error(`Imported records ${offset + 1}–${offset + batch.length}. Safe to retry the same file.`);
    offset += batch.length;
  }
  console.log(JSON.stringify(totals, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Import failed'); process.exitCode = 1; });
