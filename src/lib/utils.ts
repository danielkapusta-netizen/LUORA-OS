import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMoney(amount: string | number | null | undefined, currency = 'PLN'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(Number(amount));
}

export function formatDate(value: Date | string | null | undefined, withTime = true): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

/** 1st, 2nd, 3rd, 11th... */
export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return 'never';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const MARKETPLACE_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  allegro: 'Allegro',
  empik: 'Empik',
  vonhalsky: 'Von Halsky',
};

export const CARRIER_LABELS: Record<string, string> = {
  inpost: 'InPost',
  allegro_shipping: 'Allegro Delivery',
};

export const SERVICE_LABELS: Record<string, string> = {
  inpost_locker_standard: 'Paczkomat',
  inpost_courier_standard: 'Courier',
  buyer_choice: "Buyer's method",
};
