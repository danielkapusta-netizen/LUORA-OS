'use client';

// The page's header: which day it is, stepping a day back or forward (or picking one), and the marketplace filter as a
// pill whose white highlight slides to the chosen marketplace.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { cn, MARKETPLACE_LABELS } from '@/lib/utils';

export function dailyHref(day: string | null, marketplace: string | null): string {
  const q = new URLSearchParams();
  if (day) q.set('day', day);
  if (marketplace) q.set('marketplace', marketplace);
  const s = q.toString();
  return s ? `/daily?${s}` : '/daily';
}

export function DayStepper({ day, prev, next, todayKey, marketplace }: { day: string; prev: string; next: string | null; todayKey: string; marketplace: string | null }) {
  const t = useT();
  const router = useRouter();
  const isToday = day === todayKey;
  const arrow = 'press flex size-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-black/[0.05]';
  return (
    <div className="material-bar flex items-center gap-1 rounded-full p-1 shadow-[0_0_0_1px_rgba(28,27,25,0.05),0_8px_24px_-14px_rgba(122,70,180,0.35)]">
      <Link href={dailyHref(prev, marketplace)} scroll={false} className={arrow} aria-label={t('Previous day')}>
        <ChevronLeft className="size-4" aria-hidden />
      </Link>
      <Link
        href={dailyHref(null, marketplace)}
        scroll={false}
        aria-current={isToday ? 'page' : undefined}
        className={cn('press rounded-full px-3.5 py-2 text-sm font-medium transition-colors', isToday ? 'bg-ink text-white' : 'text-ink hover:bg-black/[0.05]')}
      >
        {t('Today')}
      </Link>
      {next ? (
        <Link href={dailyHref(next === todayKey ? null : next, marketplace)} scroll={false} className={arrow} aria-label={t('Next day')}>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(arrow, 'pointer-events-none text-slate-300')} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
      <label className="relative ml-1">
        <span className="sr-only">{t('Choose a day')}</span>
        <input
          type="date"
          value={day}
          max={todayKey}
          onChange={(e) => e.target.value && router.push(dailyHref(e.target.value === todayKey ? null : e.target.value, marketplace), { scroll: false })}
          className="h-10 rounded-full border-0 bg-black/[0.04] px-3 text-sm text-ink focus:ring-2 focus:ring-ink/15 focus:outline-none"
        />
      </label>
    </div>
  );
}

export function MarketplacePills({ day, active, options }: { day: string | null; active: string | null; options: string[] }) {
  const t = useT();
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const key = active ?? 'all';
  const list = [{ value: 'all', label: t('All marketplaces') }, ...options.map((m) => ({ value: m, label: MARKETPLACE_LABELS[m] ?? m }))];

  useLayoutEffect(() => {
    const el = refs.current.get(key);
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [key, options.length]);

  return (
    <nav aria-label={t('Marketplace')} className="scrollbar-none -mx-1 overflow-x-auto px-1">
      <div className="material-bar relative inline-flex gap-0.5 rounded-full p-1 shadow-[0_0_0_1px_rgba(28,27,25,0.05)]">
        {box && (
          <span
            aria-hidden
            className="absolute top-1 bottom-1 rounded-full bg-ink transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ left: box.left, width: box.width }}
          />
        )}
        {list.map((o) => {
          const on = o.value === key;
          return (
            <Link
              key={o.value}
              href={dailyHref(day, o.value === 'all' ? null : o.value)}
              scroll={false}
              ref={(el) => {
                if (el) refs.current.set(o.value, el);
                else refs.current.delete(o.value);
              }}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'press relative z-10 rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200',
                on ? 'text-white' : 'text-slate-600 hover:text-ink',
                !box && on && 'bg-ink',
              )}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
