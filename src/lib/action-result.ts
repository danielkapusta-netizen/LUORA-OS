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
    return { error: err instanceof Error ? t(errorMessage(err)) : t('Something went wrong') };
  }
}

/**
 * What to tell staff about an error. A database query error carries the SQL in its message and the
 * real reason in its cause; a brief D1 outage gets a plain "try again".
 */
export function errorMessage(err: Error): string {
  const cause = err.cause instanceof Error ? err.cause : null;
  const text = `${err.message} ${cause?.message ?? ''}`;
  if (/network connection lost|storage operation exceeded timeout|internal error|overloaded|transient issue/i.test(text)) {
    return 'The database was briefly unavailable. Try again.';
  }
  if (cause && /^Failed query:/.test(err.message)) return cause.message;
  return err.message;
}
