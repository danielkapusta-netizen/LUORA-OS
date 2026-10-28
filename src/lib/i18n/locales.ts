export const LOCALES = ['en', 'pl'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'luora_locale';

/** Shown in the language switcher, always in the language itself. */
export const LOCALE_NAME: Record<Locale, string> = { en: 'English', pl: 'Polski' };

/** The BCP 47 tag handed to Intl for dates, numbers and sorting. */
export const INTL_TAG: Record<Locale, string> = { en: 'en-GB', pl: 'pl-PL' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function intlTag(locale: Locale): string {
  return INTL_TAG[locale];
}
