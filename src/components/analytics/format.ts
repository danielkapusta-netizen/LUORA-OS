// Number and date formatting plus the palette, shared by server-rendered blocks and client charts.
import { intlTag, type Locale } from '@/lib/i18n/locales';

export const SERIES = { revenue: '#2a78d6', profit: '#1baf7a', third: '#eb6834' } as const;
export const MARKETPLACE_COLORS: Record<string, string> = { shopify: '#2a78d6', allegro: '#eb6834', empik: '#1baf7a', vonhalsky: '#d4a017', hebe: '#d6338a' };
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', comparison: '#a8a79f' };
export const STATUS = { good: '#0ca30c', critical: '#d03b3b' };

export type ValueFormat = 'pln' | 'number' | 'percent';

export function formatValue(v: number | null | undefined, format: ValueFormat, compact = false, locale: Locale = 'en'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (format === 'percent') return `${v.toFixed(1).replace('.', locale === 'pl' ? ',' : '.')}%`;
  const n = new Intl.NumberFormat(intlTag(locale), compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }).format(v);
  return format === 'pln' ? `${n} zł` : n;
}

/** `2026-09-14` → `14 Sep`, months as `Sep 26`. */
export function formatBucket(date: string, granularity: string = 'day', locale: Locale = 'en'): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  if (granularity === 'month' || granularity === 'quarter') return d.toLocaleDateString(intlTag(locale), { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (granularity === 'year') return String(d.getUTCFullYear());
  return d.toLocaleDateString(intlTag(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

