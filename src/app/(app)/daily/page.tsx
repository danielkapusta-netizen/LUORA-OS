import type { Metadata } from 'next';
import { AutoRefresh } from '@/components/auto-refresh';
import { plusDays, today as shopToday } from '@/lib/analytics/window';
import { intlTag } from '@/lib/i18n/locales';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/permissions';
import { requireCapability } from '@/server/auth';
import { dailyOverview } from '@/server/services/daily';
import { AttentionCard, ProductsCard, SmallCards, TransactionsCard } from './day-cards';
import { DayStepper, MarketplacePills } from './day-header';
import { HourlyHero, ProfitHero, RevenueHero } from './hero-cards';
import { MarketplaceBars } from './marketplace-bars';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Daily overview') };
}

/**
 * One shop day at a glance: revenue against a typical day, the day hour by hour, where the money went, the
 * marketplaces, every order and product, and what needs a look. Today refreshes itself every two minutes.
 */
export default async function DailyPage({ searchParams }: { searchParams: Promise<{ day?: string; marketplace?: string }> }) {
  const user = await requireCapability('analytics');
  const t = await getT();
  const params = await searchParams;
  const o = await dailyOverview({ day: params.day, marketplace: params.marketplace, showProfit: can(user.role, 'profit') });
  const todayKey = shopToday();
  const date = new Intl.DateTimeFormat(intlTag(t.locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${o.day}T12:00:00Z`));
  const shortDate = new Intl.DateTimeFormat(intlTag(t.locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${o.day}T12:00:00Z`));
  const live = o.cutoffMinute === null ? null : `${String(Math.floor(o.cutoffMinute / 60)).padStart(2, '0')}:${String(o.cutoffMinute % 60).padStart(2, '0')}`;
  const dayParam = o.isToday ? null : o.day;
  const next = o.isToday ? null : plusDays(o.day, 1);

  return (
    // Spread into the page's side padding so the wash reaches the edges without making the page scroll sideways.
    <div className="relative isolate -mx-4 px-4 md:-mx-6 md:px-6 2xl:-mx-12 2xl:px-12">
      <div aria-hidden className="daily-wash pointer-events-none absolute inset-x-0 -top-10 -z-10 h-[680px]" />
      <AutoRefresh active={o.isToday} seconds={120} />

      <header className="mb-6 space-y-4 md:mb-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-500">{date}</p>
            <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-[-0.02em] text-ink md:text-5xl">{t('Daily overview')}</h1>
          </div>
          <DayStepper day={o.day} prev={plusDays(o.day, -1)} next={next} todayKey={todayKey} marketplace={o.marketplace} />
        </div>
        {o.marketplaces.length > 1 && <MarketplacePills day={dayParam} active={o.marketplace} options={o.marketplaces} />}
      </header>

      <div className="space-y-4 md:space-y-5">
        <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-3">
          <RevenueHero o={o} t={t} dayChip={o.isToday ? t('Today') : shortDate} />
          <HourlyHero o={o} t={t} live={live} />
          <ProfitHero o={o} t={t} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2">
          <MarketplaceBars rows={o.marketplaceSplit} day={dayParam} active={o.marketplace} showProfit={o.showProfit} />
          <SmallCards o={o} t={t} />
        </div>

        <ProductsCard o={o} t={t} />

        <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TransactionsCard o={o} t={t} />
          <AttentionCard o={o} t={t} />
        </div>
      </div>
    </div>
  );
}
