import type { Instrumentation } from 'next';

/**
 * Every server error (a page render or a server action) is logged and kept in `app_errors`, keyed by
 * the digest the user sees under "This page couldn't load". Looking up that code then gives the cause.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err instanceof Error ? err : new Error(String(err));
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : null;
  const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : '';
  const row = {
    digest,
    path: request.path.slice(0, 500),
    route: context.routePath,
    kind: `${request.method} ${context.routeType}`,
    message: `${error.message}${cause}`.slice(0, 2000),
    stack: (error.stack ?? '').slice(0, 4000),
  };
  console.error('[server-error]', JSON.stringify(row));
  try {
    const { recordAppError } = await import('./server/services/app-errors');
    await recordAppError(row);
  } catch (saveErr) {
    console.error('[server-error] could not save:', saveErr instanceof Error ? saveErr.message : saveErr);
  }
};
