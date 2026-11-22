'use client';

// Top products, ranked by revenue or by profit, switched in place: rows glide to their new place and new ones
// fade in, instead of the whole page reloading.
import { Package } from 'lucide-react';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { formatValue } from '@/components/analytics/format';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { SegmentedToggle } from './segmented-toggle';

export interface TopProduct {
  key: string;
  label: string;
  brand: string;
  units: number;
  revenuePLN: number;
  marginPLN: number;
  marginPct: number;
  costUnknown: boolean;
}

type Rank = 'revenue' | 'profit';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TopProductsCard({ byRevenue, byProfit, total, viewAllHref }: { byRevenue: TopProduct[]; byProfit: TopProduct[] | null; total: number; viewAllHref: string }) {
  const t = useT();
  const [rank, setRank] = useState<Rank>('revenue');
  const rows = rank === 'profit' && byProfit ? byProfit : byRevenue;
  const nodes = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, number>());

  // FLIP: remember where each row was, then after the switch move it from there to its new place.
  const choose = (next: Rank) => {
    if (next === rank) return;
    before.current = new Map([...nodes.current].map(([key, el]) => [key, el.getBoundingClientRect().top]));
    setRank(next);
  };

  useLayoutEffect(() => {
    const previous = before.current;
    if (!previous.size || reducedMotion()) return;
    for (const [key, el] of nodes.current) {
      // The figure changes from revenue to profit (or back): it fades in.
      el.querySelector('[data-value]')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      const was = previous.get(key);
      if (was === undefined) {
        el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
      } else {
        const dy = was - el.getBoundingClientRect().top;
        if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    before.current = new Map();
  }, [rank]);

  const pln = (v: number) => formatValue(v, 'pln', false, t.locale);

  return (
    <Card tone="sky">
      <CardHeader
        icon={Package}
        title={t('Top products')}
        count={total}
        actions={
          <>
            {byProfit && (
              <SegmentedToggle
                label={t('Rank products by')}
                value={rank}
                onChange={choose}
                options={[
                  { value: 'revenue', label: t('Revenue') },
                  { value: 'profit', label: t('Profit') },
                ]}
              />
            )}
            <Link href={viewAllHref} className="rounded-full px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-ink">
              {t('View all')}
            </Link>
          </>
        }
      />
      <CardBody className="pt-3 pb-5">
        <ol className="space-y-2" aria-live="polite">
          {rows.map((p) => (
            <li
              key={p.key}
              ref={(el) => {
                if (el) nodes.current.set(p.key, el);
                else nodes.current.delete(p.key);
              }}
            >
              <Link
                href={`/analytics/products?open=${encodeURIComponent(p.key)}`}
                className="flex min-h-14 items-center gap-3 rounded-2xl border border-black/[0.04] bg-white/90 px-4 py-2.5 transition-colors hover:border-black/10 hover:bg-white"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-600">
                  <Package className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {p.brand ? `${p.brand} · ` : ''}
                    {t.plural(p.units, '{n} unit', '{n} units')}
                    {p.costUnknown ? ` · ${t('cost missing')}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span data-value className="block text-sm font-medium tabular-nums">
                    {pln(rank === 'profit' ? p.marginPLN : p.revenuePLN)}
                  </span>
                  <span className={cn('block text-xs tabular-nums text-slate-500', p.marginPLN < 0 && 'text-red-700')}>
                    {t('margin {value}', { value: formatValue(p.marginPct, 'percent', false, t.locale) })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
