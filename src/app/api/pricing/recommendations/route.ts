import { revalidatePath } from 'next/cache';
import { authorizeResearch, readResearchBody, ResearchBodyError, researchJson } from '@/server/pricing-research-api';
import { importPricingResearch, ResearchInputError } from '@/server/services/pricing-research';

export async function POST(request: Request) {
  const denied = authorizeResearch(request);
  if (denied) return denied;
  try {
    const result = await importPricingResearch(await readResearchBody(request));
    if (result.applied) revalidatePath('/pricing');
    return researchJson(result);
  } catch (error) {
    if (error instanceof ResearchBodyError) return researchJson({ error: error.message }, error.status);
    if (error instanceof ResearchInputError) return researchJson({ error: error.message }, 422);
    console.error('Pricing research import failed');
    return researchJson({ error: 'Could not save pricing research; retry the same batch' }, 500);
  }
}
