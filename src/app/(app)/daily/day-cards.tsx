// The white cards: four small figures, the day's transactions, the products sold and what needs a look.
import { AlertTriangle, ArrowRight, CheckCircle2, Package, ReceiptText, ShieldAlert, ShoppingBag, Undo2, Users } from 'lucide-react';
import Link from 'next/link';
import { formatValue } from '@/components/analytics/format';
import { changePct, type AttentionItem } from '@/lib/daily/compute';
import type { T } from '@/lib/i18n/translate';
import { cn, MARKETPLACE_LABELS } from '@/lib/utils';
import type { DailyOverview } from '@/server/services/daily';
import { DotNumber } from './dot-number';
import { ChangeChip, comparisonLabels } from './hero-cards';

const card = 'daily-glass daily-rise';
/** Order numbers come with or without their "#". */
const number = (n: string) => (n.startsWith('#') ? n : `#${n}`);
const pln = (v: number, t: T, compact = false) => formatValue(v, 'pln', compact, t.locale);
const pctText = (v: number | null, t: T) => formatValue(v, 'percent', false, t.locale);

/** Marketplace tiles in the same hues as the marketplace badges. */
const TILE: Record<string, string> = {
  shopify: 'from-[#2a6cc6] to-[#1d4f94]',
  allegro: 'from-[#f07b3f] to-[#c94a1c]',
  empik: 'from-[#14a06a] to-[#0b5e3e]',
  vonhalsky: 'from-[#b88a1e] to-[#6e5000]',
  hebe: 'from-[#ee4a9b] to-[#a3225f]',
  erli: 'from-[#9a63ff] to-[#5a2bb0]',
};

function IconTile({ icon: Icon, className }: { icon: typeof Package; className: string }) {
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl', className)}>
      <Icon className="size-[18px]" aria-hidden />
    </span>
  );
}

/** Orders against the whole of the same weekday a week earlier, as a ring of dashes. */
function Ring({ share }: { share: number | null }) {
  const N = 24;
  const lit = share === null ? 0 : Math.round(Math.min(1, share) * N);
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0" aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const a = (i / N) * 2 * Math.PI - Math.PI / 2;
        const [x1, y1, x2, y2] = [32 + 22 * Math.cos(a), 32 + 22 * Math.sin(a), 32 + 29 * Math.cos(a), 32 + 29 * Math.sin(a)];
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={3.2} strokeLinecap="round" stroke={i < lit ? '#ff8f5a' : '#f1e6e1'} />;
      })}
      <text x="32" y="36" textAnchor="middle" className="fill-ink font-mono text-[11px] font-medium">
        {share === null ? '—' : `${Math.round(share * 100)}%`}
      </text>
    </svg>
  );
}

function SmallCard({ i, icon, iconClass, title, caption, children, side }: { i: number; icon: typeof Package; iconClass: string; title: string; caption: string; children: React.ReactNode; side?: React.ReactNode }) {
  return (
    <div className={cn(card, 'flex flex-col p-4 md:p-5')} style={{ ['--i' as string]: i }}>
      <div className="flex items-start gap-3">
        <IconTile icon={icon} className={iconClass} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="truncate text-xs text-slate-500">{caption}</p>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0 text-ink">{children}</div>
        {side}
      </div>
    </div>
  );
}

export function SmallCards({ o, t }: { o: DailyOverview; t: T }) {
  const labels = comparisonLabels(o, t);
  const ordersShare = o.lastWeekFullDayOrders > 0 ? o.totals.orders / o.lastWeekFullDayOrders : null;
  const customers = o.customers.new + o.customers.returning;
  const returns = o.cancelled.count + o.refunded.count;
  const returnsAmount = o.cancelled.amount + o.refunded.amount;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5">
      <SmallCard
        i={4}
        icon={ShoppingBag}
        iconClass="bg-[#fff0e6] text-[#c2551f]"
        title={t('Orders')}
        caption={ordersShare === null ? t('Nothing to compare with yet') : t('of the same day a week ago')}
        side={<Ring share={ordersShare} />}
      >
        <DotNumber value={o.totals.orders} format="int" locale={t.locale} label={String(o.totals.orders)} dot={4} gap={2.2} ghost={0} />
      </SmallCard>
      <SmallCard
        i={5}
        icon={Users}
        iconClass="bg-[#fdeaf3] text-[#b0306f]"
        title={t('Customers')}
        caption={t('{new} new · {returning} returning', { new: o.customers.new, returning: o.customers.returning })}
        side={
          customers > 0 ? (
            <span className="flex h-12 items-end gap-1" aria-hidden>
              <span className="w-3 rounded-full bg-[linear-gradient(180deg,#ff8fc0,#f0568c)]" style={{ height: `${Math.max(12, (o.customers.new / customers) * 100)}%` }} />
              <span className="w-3 rounded-full bg-[linear-gradient(180deg,#b9a3ff,#7c5cf5)]" style={{ height: `${Math.max(12, (o.customers.returning / customers) * 100)}%` }} />
            </span>
          ) : undefined
        }
      >
        <DotNumber value={customers} format="int" locale={t.locale} label={String(customers)} dot={4} gap={2.2} ghost={0} />
      </SmallCard>
      <SmallCard i={6} icon={ReceiptText} iconClass="bg-[#e9f3ff] text-[#2a6cc6]" title={t('Average basket')} caption={labels.week}>
        <div className="flex items-end gap-1.5">
          <DotNumber value={o.totals.avgBasket ?? 0} format="money" locale={t.locale} label={pln(o.totals.avgBasket ?? 0, t)} dot={4} gap={2.2} ghost={0} />
          <span className="text-xs text-slate-500">zł</span>
        </div>
        {changePct(o.totals.avgBasket, o.lastWeek.avgBasket) !== null && (
          <div className="mt-2">
            <ChangeChip value={changePct(o.totals.avgBasket, o.lastWeek.avgBasket)} label="" tone="dark" />
          </div>
        )}
      </SmallCard>
      <SmallCard
        i={7}
        icon={Undo2}
        iconClass={returns > 0 ? 'bg-red-50 text-red-700' : 'bg-[#eefaf3] text-emerald-700'}
        title={t('Refunds & cancellations')}
        caption={returns > 0 ? t('{refunds} refunded · {cancelled} cancelled', { refunds: o.refunded.count, cancelled: o.cancelled.count }) : t('Nothing returned on this day')}
        side={returns > 0 ? <span className="font-mono text-sm font-medium text-red-700 tabular-nums">−{pln(returnsAmount, t)}</span> : <CheckCircle2 className="size-6 text-emerald-600" aria-hidden />}
      >
        <DotNumber value={returns} format="int" locale={t.locale} label={String(returns)} dot={4} gap={2.2} ghost={0} />
      </SmallCard>
    </div>
  );
}

const SHOWN = 8;

/** Each order on one quiet line: who bought, what, for how much, and what it left. */
export function TransactionsCard({ o, t }: { o: DailyOverview; t: T }) {
  const row = (x: DailyOverview['orders'][number]) => (
    <li key={x.orderId}>
      <Link href={`/orders/${x.orderId}`} className="press flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-black/[0.03]">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-semibold text-white', TILE[x.marketplace] ?? 'from-slate-500 to-slate-700')} title={MARKETPLACE_LABELS[x.marketplace] ?? x.marketplace}>
          {(MARKETPLACE_LABELS[x.marketplace] ?? x.marketplace).slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{x.buyerName || number(x.number)}</span>
          <span className="block truncate text-xs text-slate-500">{x.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</span>
        </span>
        <span className="shrink-0 text-right font-mono text-sm tabular-nums">
          <span className="block text-ink">{pln(x.revenue, t)}</span>
          {o.showProfit && <span className={cn('block text-xs', x.profit < 0 ? 'text-red-700' : 'text-emerald-700')}>{pln(x.profit, t)}</span>}
        </span>
      </Link>
    </li>
  );
  return (
    <section className={cn(card, 'flex h-full flex-col p-4 md:p-5')} style={{ ['--i' as string]: 9 }} aria-labelledby="daily-transactions">
      <div className="flex items-center justify-between gap-3 px-2">
        <h2 id="daily-transactions" className="text-base font-semibold text-ink">
          {t('Transactions')}
        </h2>
        <span className="text-xs text-slate-500">{t.plural(o.orders.length, '{n} order', '{n} orders')}</span>
      </div>
      {o.orders.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-black/[0.02] px-4 py-10 text-center text-sm text-slate-500">{t('No orders on this day yet.')}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-black/[0.04]">{o.orders.slice(0, SHOWN).map(row)}</ul>
          {o.orders.length > SHOWN && (
            <details className="group">
              <summary className="press mt-1 cursor-pointer list-none rounded-full px-2 py-2 text-center text-sm font-medium text-slate-600 hover:text-ink group-open:hidden">
                {t('Show all {n}', { n: o.orders.length })}
              </summary>
              <ul className="divide-y divide-black/[0.04]">{o.orders.slice(SHOWN).map(row)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** Margin bars run to 60%: beyond that a bar is simply full. */
const MARGIN_SCALE = 60;

/** Where a missing product cost is filled in: the cost list narrowed to products without one. */
export const COSTS_MISSING_HREF = '/settings/costs?missing=1';

export function ProductsCard({ o, t }: { o: DailyOverview; t: T }) {
  const missing = o.products.filter((p) => p.costMissing).length;
  // Name, then the figures: sales, units, revenue, profit per item, profit, margin (profit ones only when allowed).
  const cols = o.showProfit ? 'md:grid-cols-[minmax(0,1fr)_4rem_4rem_6rem_6rem_6rem_7.5rem]' : 'md:grid-cols-[minmax(0,1fr)_4rem_4rem_6rem_7.5rem]';
  const figure = 'font-mono text-sm tabular-nums md:text-right';
  const label = 'block text-[10px] text-slate-500 md:hidden';
  const row = (p: DailyOverview['products'][number]) => (
    <li key={p.key}>
      <Link
        href={`/analytics/products?period=month&open=${encodeURIComponent(p.analyticsKey)}`}
        className={cn('press grid grid-cols-3 items-center gap-x-3 gap-y-2 rounded-2xl px-2 py-3 transition-colors hover:bg-black/[0.03]', cols)}
      >
        <span className="col-span-3 flex min-w-0 items-center gap-3 md:col-span-1">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
            <img src={p.imageUrl} alt="" loading="lazy" className="size-11 shrink-0 rounded-2xl border border-black/[0.04] bg-white object-contain" />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-black/[0.03] text-slate-400">
              <Package className="size-4" aria-hidden />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
            <span className="block truncate text-xs text-slate-500">{[p.brand, p.costMissing ? t('cost missing') : null].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
        <span className={figure}>
          <span className={label}>{t('Sales')}</span>
          {p.orders}
        </span>
        <span className={figure}>
          <span className={label}>{t('Units')}</span>
          {p.units}
        </span>
        <span className={figure}>
          <span className={label}>{t('Revenue')}</span>
          {pln(p.revenue, t)}
        </span>
        {o.showProfit && (
          <>
            <span className={cn(figure, p.costMissing && 'text-slate-400')}>
              <span className={label}>{t('Per item')}</span>
              {p.costMissing || p.profitPerUnit === null ? '—' : pln(p.profitPerUnit, t)}
            </span>
            <span className={cn(figure, p.costMissing ? 'text-slate-400' : p.profit < 0 ? 'text-red-700' : 'text-emerald-700')}>
              <span className={label}>{t('Profit')}</span>
              {p.costMissing ? '—' : pln(p.profit, t)}
            </span>
          </>
        )}
        <span className="col-span-3 md:col-span-1">
          <span className="flex items-center justify-between gap-2 md:justify-end">
            <span className={label}>{t('Margin')}</span>
            <span className={cn('text-sm font-semibold tabular-nums', p.marginPct !== null && p.marginPct < 0 ? 'text-red-700' : 'text-ink')}>{p.costMissing ? '—' : pctText(p.marginPct, t)}</span>
          </span>
          <span className="mt-1.5 block h-1.5 rounded-full bg-black/[0.05]" aria-hidden>
            <span
              className={cn(
                'block h-full rounded-full',
                p.costMissing ? 'bg-amber-300' : p.marginPct !== null && p.marginPct < 0 ? 'bg-red-400' : p.marginPct !== null && p.marginPct < 15 ? 'bg-[linear-gradient(90deg,#ffb27f,#ff8f5a)]' : 'bg-[linear-gradient(90deg,#f0568c,#8b5cf6)]',
              )}
              style={{ width: `${p.costMissing ? 100 : Math.min(100, Math.max(4, ((p.marginPct ?? 0) / MARGIN_SCALE) * 100))}%` }}
            />
          </span>
        </span>
      </Link>
    </li>
  );
  return (
    <section className={cn(card, 'flex h-full flex-col p-4 md:p-5')} style={{ ['--i' as string]: 8 }} aria-labelledby="daily-products">
      <div className="flex items-center justify-between gap-3 px-2">
        <h2 id="daily-products" className="text-base font-semibold text-ink">
          {t('Products sold')}
        </h2>
        {missing > 0 ? (
          <Link href={COSTS_MISSING_HREF} className="press rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
            {t.plural(missing, 'Add costs for {n} product', 'Add costs for {n} products')} →
          </Link>
        ) : (
          o.products.length > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{t.plural(o.products.length, '{n} product', '{n} products')}</span>
        )}
      </div>
      {o.products.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-black/[0.02] px-4 py-10 text-center text-sm text-slate-500">{t('Nothing sold on this day yet.')}</p>
      ) : (
        <>
          <div className={cn('mt-3 hidden gap-x-3 px-2 text-[11px] text-slate-500 md:grid', cols)} aria-hidden>
            <span>{t('Product')}</span>
            <span className="text-right">{t('Sales')}</span>
            <span className="text-right">{t('Units')}</span>
            <span className="text-right">{t('Revenue')}</span>
            {o.showProfit && <span className="text-right">{t('Per item')}</span>}
            {o.showProfit && <span className="text-right">{t('Profit')}</span>}
            <span className="text-right">{t('Margin')}</span>
          </div>
          <ul className="mt-1 divide-y divide-black/[0.04]">{o.products.slice(0, SHOWN).map(row)}</ul>
          {o.products.length > SHOWN && (
            <details className="group">
              <summary className="press mt-1 cursor-pointer list-none rounded-full px-2 py-2 text-center text-sm font-medium text-slate-600 hover:text-ink group-open:hidden">
                {t('Show all {n}', { n: o.products.length })}
              </summary>
              <ul className="divide-y divide-black/[0.04]">{o.products.slice(SHOWN).map(row)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function attentionText(a: AttentionItem, t: T): { title: string; detail: string | null } {
  const amount = a.amount === null ? null : formatValue(Math.abs(a.amount), 'pln', false, t.locale);
  switch (a.kind) {
    case 'loss':
      return { title: t.plural(a.count, '{n} order sold at a loss', '{n} orders sold at a loss'), detail: amount ? `−${amount}` : null };
    case 'costMissing':
      return { title: t.plural(a.count, '{n} product without a cost', '{n} products without a cost'), detail: t('profit is overstated') };
    case 'pending':
      return { title: t.plural(a.count, '{n} order waiting for its profit', '{n} orders waiting for their profit'), detail: t('next sync') };
    case 'cancelled':
      return { title: t.plural(a.count, '{n} cancelled order', '{n} cancelled orders'), detail: amount };
    case 'refunded':
      return { title: t.plural(a.count, '{n} refund paid out', '{n} refunds paid out'), detail: amount ? `−${amount}` : null };
    case 'feesEstimated':
      return { title: t.plural(a.count, '{n} order with estimated fees', '{n} orders with estimated fees'), detail: t('confirmed later') };
  }
}

export function AttentionCard({ o, t }: { o: DailyOverview; t: T }) {
  const hrefFor = (a: AttentionItem): string | null => {
    if (a.kind === 'costMissing' || a.kind === 'feesEstimated') return COSTS_MISSING_HREF;
    if (a.kind === 'cancelled') return `/orders?status=cancelled&from=${o.day}&to=${o.day}`;
    if (a.kind === 'loss' || a.kind === 'refunded') return `/orders?from=${o.day}&to=${o.day}`;
    return null;
  };
  // Distorted profit first; the rest is for information.
  const serious = o.attention.filter((a) => a.kind === 'loss' || a.kind === 'costMissing' || a.kind === 'cancelled' || a.kind === 'refunded').length;
  return (
    <section className="daily-hero daily-plum daily-rise flex flex-col p-5 text-white" style={{ ['--i' as string]: 10 }} aria-labelledby="daily-attention">
      <div className="flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
          <ShieldAlert className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="daily-attention" className="text-sm font-semibold">
            {t('Needs attention')}
          </h2>
          <p className="flex items-center gap-1.5 text-[11px] text-white/70">
            <span className={cn('size-1.5 rounded-full', o.attention.length === 0 ? 'bg-emerald-400' : serious > 0 ? 'bg-[#ff7ab8]' : 'bg-amber-300')} aria-hidden />
            {o.attention.length === 0 ? t('All clear') : t.plural(o.attention.length, '{n} thing to check', '{n} things to check')}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <DotNumber value={o.attention.length} format="int" locale={t.locale} label={String(o.attention.length)} dot={5} gap={2.6} ghost={0} />
      </div>
      {o.attention.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-white/85">
          <CheckCircle2 className="size-4 text-emerald-300" aria-hidden />
          {t('Every order has its cost and profit.')}
        </p>
      ) : (
        <ul className="mt-4 space-y-1">
          {o.attention.map((a) => {
            const text = attentionText(a, t);
            const href = hrefFor(a);
            const body = (
              <>
                <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0 self-start', a.kind === 'loss' || a.kind === 'costMissing' ? 'text-[#ff9ccf]' : 'text-white/55')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug">{text.title}</span>
                  {text.detail && <span className="block text-[11px] text-white/65 tabular-nums">{text.detail}</span>}
                </span>
                {href && <ArrowRight className="size-3.5 shrink-0 text-white/55" aria-hidden />}
              </>
            );
            return (
              <li key={a.kind}>
                {href ? (
                  <Link href={href} className="press flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white/8">
                    {body}
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 px-2 py-2">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto pt-5">
        <Link href={`/orders?from=${o.day}&to=${o.day}`} className="press flex items-center justify-center rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-[#4a1240]">
          {t("Open the day's orders")}
        </Link>
      </div>
    </section>
  );
}
