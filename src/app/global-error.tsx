'use client';

import { useMemo } from 'react';
import { ErrorScreen } from '@/components/error-screen';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/lib/i18n/locales';
import { createT } from '@/lib/i18n/translate';
import './globals.css';

function cookieLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const value = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))?.[1];
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** The app's own layout failed (e.g. reading the session); this replaces the whole document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const locale = useMemo(() => cookieLocale(), []);
  const t = useMemo(() => createT(locale), [locale]);
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-canvas antialiased">
        <ErrorScreen error={error} retry={retry} t={t} />
      </body>
    </html>
  );
}
