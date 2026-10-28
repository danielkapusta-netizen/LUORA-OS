import { getT } from '@/lib/i18n/server';

export type ActionResult = { ok?: string; error?: string } | null;

/** Runs a server action body and turns thrown errors into a message for the form. */
export async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: message || (await getT())('Saved') };
  } catch (err) {
    // Let Next.js redirects and notFound() through.
    if (err && typeof err === 'object' && 'digest' in err && String((err as { digest: unknown }).digest).startsWith('NEXT_')) throw err;
    console.error(err);
    return { error: err instanceof Error ? err.message : (await getT())('Something went wrong') };
  }
}
