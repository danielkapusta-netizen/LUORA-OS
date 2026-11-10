'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import type { T } from '@/lib/i18n/translate';

const AUTO_RETRY_MS = 1000;
const AUTO_RETRY_KEY = 'luora:auto-retry';

/**
 * Shown when a page fails on the server. Most of these are a moment's database hiccup, so it quietly
 * tries again once; after that the user decides. The code at the bottom finds the cause in `app_errors`.
 */
export function ErrorScreen({ error, retry, t }: { error: Error & { digest?: string }; retry: () => void; t: T }) {
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    // One automatic retry per page per minute, so a page that keeps failing can't loop.
    const key = `${AUTO_RETRY_KEY}:${location.pathname}`;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(key) ?? 0);
    } catch {}
    if (Date.now() - last < 60_000) return;
    try {
      sessionStorage.setItem(key, String(Date.now()));
    } catch {}
    const timer = setTimeout(retry, AUTO_RETRY_MS);
    return () => clearTimeout(timer);
  }, [retry]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-black/[0.06] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-butter-tint text-butter-ink">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <h1 className="font-display text-xl font-semibold text-ink">{t("This page couldn't load")}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('Something went wrong on our side. Try again; it usually works the second time.')}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-ink-soft"
          >
            <RotateCw className="size-4" aria-hidden />
            {t('Try again')}
          </button>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium text-ink hover:bg-black/[0.04]"
          >
            {t('Reload page')}
          </button>
        </div>
        {error.digest && <p className="mt-6 font-mono text-xs text-slate-400">{t('Error code')}: {error.digest}</p>}
      </div>
    </div>
  );
}
