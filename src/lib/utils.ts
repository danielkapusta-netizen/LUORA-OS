import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { intlTag, type Locale } from '@/lib/i18n/locales';
import { msg } from '@/lib/i18n/msg';
import type { T } from '@/lib/i18n/translate';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMoney(amount: string | number | null | undefined, currency = 'PLN'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(Number(amount));
}

export function formatDate(value: Date | string | null | undefined, withTime = true, locale: Locale = 'en'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(intlTag(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

/** 1st, 2nd, 3rd, 11th... in English; 1., 2., 3. in Polish. */
export function ordinal(n: number, locale: Locale = 'en'): string {
  if (locale === 'pl') return `${n}.`;
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function timeAgo(value: Date | string | null | undefined, t: T): string {
  if (!value) return t('never');
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t('just now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('{n} h ago', { n: hours });
  return t.plural(Math.round(hours / 24), '{n} day ago', '{n} days ago');
}

export const MARKETPLACE_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  allegro: 'Allegro',
  empik: 'Empik',
  vonhalsky: 'Von Halsky',
  hebe: 'HEBE',
};

export const CARRIER_LABELS: Record<string, string> = {
  inpost: 'InPost',
  allegro_shipping: 'Allegro Delivery',
};

export const SERVICE_LABELS: Record<string, string> = {
  inpost_locker_standard: 'Paczkomat',
  inpost_courier_standard: msg('Courier'),
  buyer_choice: msg("Buyer's method"),
};
