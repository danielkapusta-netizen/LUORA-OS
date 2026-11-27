// The three gradient cards at the top: revenue against a typical day, the day hour by hour, and where the money went.
import { ArrowDownRight, ArrowUpRight, Minus, ReceiptText } from 'lucide-react';
import { formatValue } from '@/components/analytics/format';
import { changePct, marginWord, type MoneyBreakdown } from '@/lib/daily/compute';
import type { T } from '@/lib/i18n/translate';
import { cn } from '@/lib/utils';
import type { DailyOverview } from '@/server/services/daily';
import { DotDigits, formatDots } from './dot-digits';
import { DotNumber } from './dot-number';
import { HourlyDots } from './hourly-dots';

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** "vs a week ago by 11:05" for today, "vs a week before" for a past day. */
export function comparisonLabels(o: DailyOverview, t: T): { week: string; yesterday: string } {
  if (o.cutoffMinute === null) return { week: t('vs a week before'), yesterday: t('vs the day before') };
  const time = clock(o.cutoffMinute);
  return { week: t('vs a week ago by {time}', { time }), yesterday: t('vs yesterday by {time}', { time }) };
}

/** A small change pill: arrow, signed change, what it is compared with. Points (pp) for rates, % otherwise. */
export function ChangeChip({ value, unit = '%', label, tone = 'light' }: { value: number | null; unit?: '%' | 'pp'; label: string; tone?: 'light' | 'dark' }) {
  const Icon = value === null || Math.abs(value) < 0.05 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const text = value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit === 'pp' ? ' pp' : '%'}`;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
        tone === 'light' ? 'bg-white/16 text-white ring-1 ring-white/25' : 'bg-black/[0.04] text-slate-700',
        tone === 'dark' && value !== null && value > 0.05 && 'bg-emerald-50 text-emerald-800',
        tone === 'dark' && value !== null && value < -0.05 && 'bg-red-50 text-red-800',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {value !== null && <span className="font-semibold tabular-nums">{text}</span>}
      <span className="truncate opacity-80">{label}</span>
    </span>
  );
}

function HeroHeader({ title, chip }: { title: string; chip?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {chip}
    </div>
  );
}

const pill = 'rounded-full bg-white/16 px-3 py-1 text-xs font-medium ring-1 ring-white/25';

/** A dotted arc that fills as the day's revenue approaches the whole of the same weekday a week earlier. */
function DotArc({ share }: { share: number | null }) {
  const N = 40;
  const lit = share === null ? 0 : Math.round(Math.min(1, share) * N);
  const cx = 150;
  const cy = 132;
  const r = 112;
  const from = (200 * Math.PI) / 180;
  const to = (-20 * Math.PI) / 180;
  const at = (i: number) => {
    const a = from + ((to - from) * i) / (N - 1);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const knob = lit > 0 ? at(lit - 1) : null;
  return (
    <svg viewBox="0 0 300 176" className="absolute inset-0 h-full w-full" aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const [x, y] = at(i);
        return <circle key={i} cx={x} cy={y} r={i < lit ? 3.4 : 2.6} fill="white" opacity={i < lit ? 0.95 : 0.3} className="daily-dot-in" style={{ animationDelay: `${120 + i * 14}ms` }} />;
      })}
      {knob && <circle cx={knob[0]} cy={knob[1]} r={8} fill="white" stroke="rgb(255 255 255 / 0.45)" strokeWidth={6} paintOrder="stroke" />}
    </svg>
  );
}

export function RevenueHero({ o, t, dayChip }: { o: DailyOverview; t: T; dayChip: string }) {
  const labels = comparisonLabels(o, t);
  const weekFull = o.hoursLastWeek.reduce((s, h) => s + h.revenue, 0);
  const share = weekFull > 0 ? o.totals.revenue / weekFull : null;
  const digits = formatDots(o.totals.revenue, 'money', t.locale);
  // Sized to sit inside the arc whatever the amount.
  const big = digits.length > 6 ? 3.6 : digits.length > 5 ? 4 : 4.8;
  return (
    <section className="daily-hero daily-sunset daily-rise relative flex flex-col overflow-hidden p-5 text-white md:p-6" style={{ ['--i' as string]: 0 }} aria-labelledby="daily-revenue">
      <HeroHeader title={t('Revenue')} chip={<span className={pill}>{dayChip}</span>} />
      <div className="relative mx-auto mt-1 aspect-[300/176] w-full max-w-[300px]">
        <DotArc share={share} />
        <div className="absolute inset-x-0 top-[40%] flex flex-col items-center">
          <span id="daily-revenue" className="sr-only">
            {t('Revenue')}
          </span>
          <DotNumber value={o.totals.revenue} format="money" locale={t.locale} label={formatValue(o.totals.revenue, 'pln', false, t.locale)} dot={big} gap={big * 0.5} ghost={0} className="h-auto max-w-[56%]" />
          <span className="mt-2 text-sm font-medium text-white/90">zł</span>
        </div>
      </div>
      <p className="-mt-2 mb-3 text-center text-xs text-white/85">{share === null ? t('Nothing to compare with yet') : t('{share} of the same day a week ago', { share: `${Math.round(share * 100)}%` })}</p>
      <div className="flex flex-col items-start gap-2">
        <ChangeChip value={changePct(o.totals.revenue, o.lastWeek.revenue)} label={labels.week} />
        <ChangeChip value={changePct(o.totals.revenue, o.yesterday.revenue)} label={labels.yesterday} />
      </div>
      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-white/20 pt-4">
        {[
          { label: t('Orders'), value: o.totals.orders, format: 'int' as const },
          { label: t('Units'), value: o.totals.units, format: 'int' as const },
          { label: t('Avg basket'), value: o.totals.avgBasket ?? 0, format: 'money' as const },
        ].map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="text-xs text-white/80">{s.label}</dt>
            <dd className="mt-1.5">
              <DotNumber value={s.value} format={s.format} locale={t.locale} label={String(Math.round(s.value))} dot={2.8} gap={1.6} ghost={0} className="h-auto max-w-full" />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HourlyHero({ o, t, live }: { o: DailyOverview; t: T; live: string | null }) {
  const busiest = o.hours.reduce((best, h) => (h.revenue > best.revenue ? h : best), o.hours[0]);
  const last = o.lastOrderAt === null ? null : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(o.lastOrderAt));
  const nowHour = o.cutoffMinute === null ? null : Math.floor(o.cutoffMinute / 60);
  return (
    <section className="daily-hero daily-plum daily-rise relative flex flex-col overflow-hidden p-5 text-white md:p-6" style={{ ['--i' as string]: 1 }}>
      <HeroHeader
        title={t('Hour by hour')}
        chip={
          live ? (
            <span className={cn(pill, 'inline-flex items-center gap-1.5 bg-[#ff4f9a]/20 ring-[#ff7ab8]/40')}>
              <span className="size-1.5 animate-pulse rounded-full bg-[#ff7ab8] motion-reduce:animate-none" aria-hidden />
              {t('Live')} · {live}
            </span>
          ) : undefined
        }
      />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <div className="flex items-end gap-2">
            <DotNumber value={o.totals.orders} format="int" locale={t.locale} label={t.plural(o.totals.orders, '{n} order', '{n} orders')} dot={5.4} gap={2.7} ghost={0} />
            <span className="pb-0.5 text-sm text-white/75">{t.plural(o.totals.orders, 'order', 'orders')}</span>
          </div>
          <p className="mt-2 text-xs text-white/70">{last ? t('Last order at {time}', { time: last }) : t('No orders yet')}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-right">
          <dt className="text-[11px] text-white/60">{t('Busiest')}</dt>
          <dt className="text-[11px] text-white/60">{t('Units')}</dt>
          <dd>
            <DotDigits text={busiest.revenue > 0 ? `${String(busiest.hour).padStart(2, '0')}:00` : '-'} label={busiest.revenue > 0 ? `${busiest.hour}:00` : '—'} dot={2.6} gap={1.5} ghost={0} />
          </dd>
          <dd>
            <DotNumber value={o.totals.units} format="int" locale={t.locale} label={String(o.totals.units)} dot={2.6} gap={1.5} ghost={0} />
          </dd>
        </dl>
      </div>
      <div className="mt-auto pt-12">
        <HourlyDots hours={o.hours} ghost={o.hoursLastWeek} nowHour={nowHour} />
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="inline-block size-1.5 rounded-full bg-white/35" aria-hidden />
          {t('Faint dots: the same day a week ago')}
        </p>
      </div>
    </section>
  );
}

interface Step {
  key: string;
  label: string;
  value: number;
  start: number;
  end: number;
  total?: boolean;
}

/** The waterfall from revenue to profit, each step starting where the one before ended. */
function steps(b: MoneyBreakdown, t: T): Step[] {
  let running = b.revenue;
  const out: Step[] = [{ key: 'revenue', label: t('Revenue'), value: b.revenue, start: 0, end: b.revenue, total: true }];
  for (const [key, label, value] of [
    ['vat', t('VAT'), b.vat],
    ['fees', t('Fees'), b.fees],
    ['cost', t('Product cost'), b.cost],
    ['shipping', t('Shipping'), b.shipping],
    ['refunds', t('Refunds'), b.refunds],
  ] as const) {
    const next = running - value;
    out.push({ key, label, value: -value, start: Math.min(running, next), end: Math.max(running, next) });
    running = next;
  }
  out.push({ key: 'profit', label: t('Profit'), value: b.profit, start: Math.min(0, b.profit), end: Math.max(0, b.profit), total: true });
  return out;
}

export function ProfitHero({ o, t }: { o: DailyOverview; t: T }) {
  const labels = comparisonLabels(o, t);
  const word = marginWord(o.totals.marginPct);
  const list = steps(o.breakdown, t);
  const lo = Math.min(0, ...list.map((s) => s.start));
  const hi = Math.max(1, ...list.map((s) => s.end));
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const pct = o.breakdownUnit === 'pct';
  const show = (v: number) => (pct ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}%` : `${v < 0 ? '−' : ''}${formatValue(Math.abs(v), 'pln', Math.abs(v) >= 10_000, t.locale)}`);
  const estimated = o.orders.filter((x) => x.feesEstimated).length;
  const marginChange = o.totals.marginPct === null || o.lastWeek.marginPct === null ? null : o.totals.marginPct - o.lastWeek.marginPct;
  return (
    <section className="daily-hero daily-iris daily-rise relative flex flex-col overflow-hidden p-5 text-white md:p-6" style={{ ['--i' as string]: 2 }}>
      <HeroHeader
        title={o.showProfit ? t('Profit') : t('Margin')}
        chip={word ? <span className={pill}>{word === 'healthy' ? t('Healthy') : word === 'thin' ? t('Thin') : t('Loss')}</span> : undefined}
      />
      <div className="mt-4 flex flex-wrap items-end gap-x-2 gap-y-1">
        {o.showProfit ? (
          <>
            <DotNumber value={o.totals.profit} format="money" locale={t.locale} label={formatValue(o.totals.profit, 'pln', false, t.locale)} dot={5.4} gap={2.7} ghost={0} className="h-auto max-w-full" />
            <span className="pb-0.5 text-sm text-white/75">zł</span>
          </>
        ) : (
          <DotNumber value={o.totals.marginPct ?? 0} format="pct" locale={t.locale} label={formatValue(o.totals.marginPct, 'percent', false, t.locale)} dot={5.4} gap={2.7} ghost={0} />
        )}
      </div>
      <div className="mt-3 flex flex-col items-start gap-2">
        {o.showProfit && o.totals.marginPct !== null && <p className="text-xs text-white/85">{t('{margin} margin', { margin: formatValue(o.totals.marginPct, 'percent', false, t.locale) })}</p>}
        <ChangeChip value={marginChange} unit="pp" label={labels.week} />
      </div>

      <h3 className="mt-5 text-xs font-medium text-white/80">{t('Where the money went')}</h3>
      <ul className="mt-2 space-y-1.5">
        {list.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.75rem] items-center gap-2 text-[11px]">
            <span className={cn('truncate', s.total ? 'font-semibold text-white' : 'text-white/75')}>{s.label}</span>
            <span className="relative block h-2.5 rounded-full bg-white/10">
              <span
                className={cn(
                  'daily-rise absolute inset-y-0 rounded-full',
                  s.key === 'profit' ? (s.value < 0 ? 'bg-[#ffb4c8]' : 'bg-white') : s.total ? 'bg-white/90' : s.value > 0 ? 'bg-[#9ff0c9]' : 'bg-white/45',
                )}
                style={{ left: `${x(s.start)}%`, width: `${Math.max(x(s.end) - x(s.start), s.value === 0 ? 0 : 1.5)}%`, ['--i' as string]: 4 + i }}
              />
            </span>
            <span className={cn('text-right font-mono tabular-nums', s.total ? 'font-semibold text-white' : 'text-white/80')}>{show(s.value)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-5">
        <p className="inline-flex items-center gap-2 rounded-full bg-black/15 px-3 py-1.5 text-[11px] text-white/85 ring-1 ring-white/15">
          <ReceiptText className="size-3.5" aria-hidden />
          {estimated > 0 ? t.plural(estimated, 'Fees estimated for {n} order', 'Fees estimated for {n} orders') : t('All fees confirmed')}
        </p>
      </div>
    </section>
  );
}
