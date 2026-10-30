import { createHash, timingSafeEqual } from 'node:crypto';

export const RESEARCH_HEADERS = { 'Cache-Control': 'no-store' };
export function researchJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: RESEARCH_HEADERS });
}

/** A dedicated capability: this token grants catalog reads and recommendation imports only. */
export function authorizeResearch(request: Request): Response | null {
  const expected = process.env.PRICING_RESEARCH_API_TOKEN;
  if (!expected || expected.length < 32) return researchJson({ error: 'Pricing research API is not configured' }, 503);
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const digest = (v: string) => createHash('sha256').update(v).digest();
  if (!supplied || !timingSafeEqual(digest(expected), digest(supplied))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { ...RESEARCH_HEADERS, 'WWW-Authenticate': 'Bearer' } });
  }
  return null;
}

export class ResearchBodyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Enforce the limit on the actual stream, including requests without Content-Length. */
export async function readResearchBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ResearchBodyError('Use application/json', 415);
  const max = 512 * 1024;
  if (Number(request.headers.get('content-length')) > max) throw new ResearchBodyError('Request is too large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ResearchBodyError('JSON body is required', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new ResearchBodyError('Request is too large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ResearchBodyError('Invalid JSON', 400); }
}
