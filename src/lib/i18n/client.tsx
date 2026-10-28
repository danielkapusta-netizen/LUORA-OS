'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './locales';
import { createT, type T } from './translate';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Gives client components the language the server rendered with. Mounted once in the root layout. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Translator for client components. */
export function useT(): T {
  const locale = useLocale();
  return useMemo(() => createT(locale), [locale]);
}
