import { cookies } from 'next/headers';
import { cache } from 'react';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from './locales';
import { createT, type T } from './translate';

/** The language chosen in the switcher, or English when nothing has been chosen yet. */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const value = (await cookies()).get(LOCALE_COOKIE)?.value;
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    // Outside a request (queue jobs, scripts, tests) there is no cookie to read.
    return DEFAULT_LOCALE;
  }
});

/** Translator for server components, server actions and route handlers. */
export const getT = cache(async (): Promise<T> => createT(await getLocale()));
