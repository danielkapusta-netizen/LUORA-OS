// Pieces both Dashboards share: the greeting, the new orders and what to pick for them, today's sales and the tasks panel.
import { CalendarDays, CircleDashed, Inbox, Package, PackageOpen, SquareCheckBig } from 'lucide-react';
import { Delta } from '@/components/analytics/blocks';
import { formatValue } from '@/components/analytics/format';
import { Card, CardBody, CardHeader, DatePill, Eyebrow, ListRow, PanelLink, StatTile } from '@/components/ui';
import { comparisonText } from '@/lib/analytics/period';
import type { Snapshot } from '@/lib/analytics/snapshot';
import type { Kpi } from '@/lib/analytics/types';
import { dayLabel } from '@/lib/tasks/dates';
import { dueState } from '@/lib/tasks/model';
import { intlTag } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';
import type { PickLine } from '@/server/services/orders';
import type { TaskCard } from '@/server/services/tasks';
import { getT } from '@/lib/i18n/server';

/** Today's date over a serif "Welcome back", with anything else (a period control) on the right. */
export async function Greeting({ name, actions }: { name: string; actions?: React.ReactNode }) {
  const t = await getT();
  const date = new Intl.DateTimeFormat(intlTag(t.locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' }).format(new Date());
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:mb-10">
      <div className="min-w-0">
        <Eyebrow className="mb-2">{date}</Eyebrow>
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight text-ink md:text-5xl">{t('Welcome back, {name}', { name })}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** New orders waiting to be picked, with what has to come off the shelves for them right beside. */
export async function PickRow({ newOrders, lines }: { newOrders: number; lines: PickLine[] }) {
  const t = await getT();
  return (
    <section aria-label={t('To pick')} className="grid grid-cols-1 items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <StatTile href="/orders?status=new" tone="sky" icon={Inbox} label={t('New')} value={newOrders} caption={t('Waiting to be picked up')} />
      <PickListCard lines={lines} />
    </section>
  );
}

const PICK_SHOWN = 10;

function PickLineRow({ line, t }: { line: PickLine; t: Awaited<ReturnType<typeof getT>> }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-black/[0.04] bg-white/90 px-3 py-2">
      {line.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
        <img src={line.imageUrl} alt="" className="size-10 shrink-0 rounded-xl border border-black/[0.04] bg-white object-contain" loading="lazy" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.03] text-slate-400">
          <Package className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{line.name}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">
          {line.sku ? `${line.sku} · ` : ''}
          {t.plural(line.orders, 'in {n} order', 'in {n} orders')}
        </span>
      </span>
      <span className="shrink-0 font-mono text-lg font-medium tabular-nums text-ink">×{line.quantity}</span>
    </li>
  );
}

/** The products new orders need, summed per product, the most wanted first. */
export async function PickListCard({ lines }: { lines: PickLine[] }) {
  const t = await getT();
  const units = lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <Card>
      <CardHeader
        icon={PackageOpen}
        title={t('To pick')}
        description={lines.length ? t('{units} from {products}', { units: t.plural(units, '{n} item', '{n} items'), products: t.plural(lines.length, '{n} product', '{n} products') }) : undefined}
        actions={<PanelLink href="/orders?status=new">{t('Orders')}</PanelLink>}
      />
      <CardBody className="pt-2 pb-5">
        {lines.length === 0 ? (
          <p className="rounded-2xl bg-black/[0.02] px-4 py-6 text-center text-sm text-slate-500">{t('Nothing to pick: no new orders.')}</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {lines.slice(0, PICK_SHOWN).map((l) => (
                <PickLineRow key={l.key} line={l} t={t} />
              ))}
            </ul>
            {lines.length > PICK_SHOWN && (
              <details className="group mt-1.5">
                <summary className="cursor-pointer list-none rounded-full px-2 py-1 text-sm text-slate-600 hover:text-ink group-open:hidden">
                  {t('Show {n} more', { n: lines.length - PICK_SHOWN })}
                </summary>
                <ul className="space-y-1.5">
                  {lines.slice(PICK_SHOWN).map((l) => (
                    <PickLineRow key={l.key} line={l} t={t} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Today so far (Warsaw day): revenue, profit (when the viewer may see it), margin, orders and units, against the
 * day before, with the products sold today underneath.
 */
export async function TodayCard({ snapshot, showProfit }: { snapshot: Snapshot; showProfit: boolean }) {
  const t = await getT();
  const kpi = (key: string) => snapshot.kpis.find((k) => k.key === key);
  const figures = [kpi('revenue'), showProfit ? kpi('profit') : undefined, kpi('margin'), kpi('orders')].filter((k): k is Kpi => Boolean(k));
  const units = snapshot.totals.units;
  const unitsBefore = snapshot.previousTotals?.units ?? null;
  const sold = [...snapshot.products].sort((a, b) => b.units - a.units || b.revenuePLN - a.revenuePLN).slice(0, 8);
  const comparison = comparisonText(snapshot.period, t);
  // A day before without sales gives nothing to compare with (a margin "+40 pp" against no sales says nothing).
  const compared = (snapshot.previousTotals?.orders ?? 0) > 0;
  return (
    <Card>
      <CardHeader icon={CalendarDays} title={t('Today')} description={t('Sales so far today, from every marketplace.')} />
      <CardBody className="space-y-4 pt-2 pb-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {figures.map((k) => (
            <TodayFigure
              key={k.key}
              label={t(k.label)}
              value={formatValue(k.value, k.format, false, t.locale)}
              change={!compared ? null : k.isRate ? (k.previous === null ? null : k.value - k.previous) : k.changePct}
              unit={k.isRate ? 'pp' : '%'}
              comparison={comparison}
            />
          ))}
          <TodayFigure
            label={t('Units sold')}
            value={formatValue(units, 'number', false, t.locale)}
            change={compared && unitsBefore ? ((units - unitsBefore) / unitsBefore) * 100 : null}
            unit="%"
            comparison={comparison}
          />
        </div>
        {sold.length === 0 ? (
          <p className="rounded-2xl bg-black/[0.02] px-4 py-6 text-center text-sm text-slate-500">{t('No sales yet today.')}</p>
        ) : (
          <div>
            {/* On phones the name takes its own line and the figures sit under it, right-aligned. */}
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-xs font-medium text-slate-500">
              <span className="w-full truncate sm:w-auto sm:min-w-0 sm:flex-1">{t('Sold today')}</span>
              <span className="ml-auto w-12 shrink-0 text-right sm:ml-0">{t('Units')}</span>
              <span className="w-20 shrink-0 text-right sm:w-24">{t('Revenue')}</span>
              {showProfit && <span className="w-20 shrink-0 text-right sm:w-24">{t('Profit')}</span>}
            </div>
            <ul className="divide-y divide-black/[0.04] rounded-2xl border border-black/[0.04]">
              {sold.map((p) => (
                <li key={p.productKey} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                  <span className="w-full truncate sm:w-auto sm:min-w-0 sm:flex-1">{p.label}</span>
                  <span className="ml-auto w-12 shrink-0 text-right font-mono tabular-nums text-slate-600 sm:ml-0">×{p.units}</span>
                  <span className="w-20 shrink-0 text-right font-mono tabular-nums sm:w-24">{formatValue(p.revenuePLN, 'pln', false, t.locale)}</span>
                  {showProfit && (
                    <span
                      title={p.costUnknown ? t('cost missing') : undefined}
                      className={cn(
                        'w-20 shrink-0 text-right font-mono tabular-nums sm:w-24',
                        p.costUnknown ? 'text-slate-400' : p.marginPLN < 0 ? 'text-red-700' : 'text-emerald-700',
                      )}
                    >
                      {formatValue(p.marginPLN, 'pln', false, t.locale)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

async function TodayFigure({ label, value, change, unit, comparison }: { label: string; value: string; change: number | null; unit: '%' | 'pp'; comparison: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.05] bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-medium tabular-nums text-ink">{value}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1">
        <Delta value={change} unit={unit} />
        {change !== null && <span className="text-[11px] text-slate-500">{comparison}</span>}
      </div>
    </div>
  );
}

/** "My tasks" in a butter panel: one white row per task, with its due day on the right. */
export async function TasksPanel({ tasks, today, limit, show = 5, className }: { tasks: TaskCard[]; today: string; limit: number; show?: number; className?: string }) {
  const t = await getT();
  return (
    <Card tone="butter" className={className}>
      <CardHeader icon={SquareCheckBig} title={t('My tasks')} count={tasks.length >= limit ? `${limit}+` : tasks.length} actions={<PanelLink href="/tasks?who=me">{t('View all')}</PanelLink>} />
      <CardBody className="space-y-2 pt-3 pb-5">
        {tasks.length ? (
          tasks.slice(0, show).map((task) => {
            const state = dueState(task, today);
            return (
              <ListRow
                key={task.id}
                href={`/tasks/${task.id}`}
                icon={<CircleDashed className="size-4" aria-hidden />}
                title={task.title}
                subtitle={task.customer?.name ?? task.project?.name}
                trailing={
                  task.dueDate ? (
                    <DatePill className={cn(state === 'overdue' && 'border-red-200 bg-red-50 text-red-700', state === 'today' && 'border-ink/20 font-medium text-ink')}>{dayLabel(task.dueDate, today, t)}</DatePill>
                  ) : undefined
                }
              />
            );
          })
        ) : (
          <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-slate-500">{t('Nothing assigned to you.')}</p>
        )}
      </CardBody>
    </Card>
  );
}
