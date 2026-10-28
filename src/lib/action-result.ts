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
    const t = await getT();
    // Messages thrown by the services are English source strings; those with a Polish translation are shown translated.
    return { error: err instanceof Error ? t(err.message) : t('Something went wrong') };
  }
}
