import { authorizeResearch, researchJson } from '@/server/pricing-research-api';
import { researchCatalog } from '@/server/services/pricing-research';

export async function GET(request: Request) {
  const denied = authorizeResearch(request);
  if (denied) return denied;
  const after = new URL(request.url).searchParams.get('after') ?? undefined;
  if (after && after.length > 100) return researchJson({ error: 'Invalid cursor' }, 400);
  try { return researchJson(await researchCatalog(after)); }
  catch {
    console.error('Pricing research catalog read failed');
    return researchJson({ error: 'Could not read research catalog' }, 500);
  }
}
