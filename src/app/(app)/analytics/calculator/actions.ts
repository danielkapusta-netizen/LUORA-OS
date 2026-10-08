'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { Candidate } from '@/lib/analytics/calculator';
import { assertCapability } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { calculatorCandidates } from '@/server/db/schema';

export async function saveCandidateAction(candidate: Candidate): Promise<string> {
  const user = await assertCapability('analytics');
  const db = getDb();
  const data = { ...candidate } as unknown as Record<string, unknown>;
  const [existing] = await db.select({ id: calculatorCandidates.id }).from(calculatorCandidates).where(eq(calculatorCandidates.id, candidate.id));
  if (existing) await db.update(calculatorCandidates).set({ data }).where(eq(calculatorCandidates.id, candidate.id));
  else await db.insert(calculatorCandidates).values({ id: candidate.id, data, createdBy: user.id });
  revalidatePath('/analytics/calculator');
  return candidate.id;
}

export async function deleteCandidateAction(id: string): Promise<void> {
  await assertCapability('analytics');
  await getDb().delete(calculatorCandidates).where(eq(calculatorCandidates.id, id));
  revalidatePath('/analytics/calculator');
}
