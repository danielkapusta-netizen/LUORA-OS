// Building blocks of the analytics pages, rendered on the server. Charts live in charts.tsx.
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card, CardBody } from '@/components/ui';
import type { ExecutiveBrief } from '@/lib/analytics/brief';
import { channelName } from '@/lib/analytics/insights';
import type { QuestionAnswer } from '@/lib/analytics/questions';
import type { ChannelPerformance, HealthScore, Insight, Kpi } from '@/lib/analytics/types';
import { cn } from '@/lib/utils';
import { Sparkline } from './charts';
import { formatBucket, formatValue, MARKETPLACE_COLORS, SERIES } from './format';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';
import { intlTag } from '@/lib/i18n/locales';

/** Builds a link to the current page with some query parameters changed (undefined removes one). */
export function hrefWith(path: string, current: Record<string, string | undefined>, next: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...next })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** A row of link "pills"; the active one is filled. Used for periods, metrics and dimensions. */
export async function Pills({ options, active, href, label }: { options: { value: string; label: string }[]; active: string; href: (value: string) => string; label: string }) {
  const t = await getT();
  return (
    <nav aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-1">
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
          aria-current={o.value === active ? 'true' : undefined}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium',
            o.value === active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {t(o.label)}
        </Link>
      ))}
    </nav>
  );
}

export function SectionTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Change against the comparison period; red only when the change is bad news. */
export async function Delta({ value, unit = '%', higherIsBetter = true }: { value: number | null; unit?: '%' | 'pp'; higherIsBetter?: boolean }) {
  const t = await getT();
  if (value === null || !Number.isFinite(value)) return <span className="text-xs text-slate-400">{t('no comparison')}</span>;
  const up = value > 0;
  const good = Math.abs(value) < 0.05 ? null : up === higherIsBetter;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', good === null ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-red-700')}>
      <Icon className="size-3.5" aria-hidden />
      {up ? '+' : ''}
      {value.toFixed(1)}
      {unit === 'pp' ? ' pp' : '%'}
    </span>
  );
}

export async function KpiCard({ kpi, comparisonLabel, granularity = 'day' }: { kpi: Kpi; comparisonLabel: string; granularity?: string }) {
  const t = await getT();
  const color = kpi.key === 'profit' || kpi.key === 'margin' ? SERIES.profit : SERIES.revenue;
  const change = kpi.isRate ? (kpi.previous === null ? null : kpi.value - kpi.previous) : kpi.changePct;
  return (
    <Card>
      <CardBody className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500" title={t(kpi.hint)}>
          {t(kpi.label)}
        </p>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">{formatValue(kpi.value, kpi.format, false, t.locale)}</p>
        <div className="flex items-center gap-1.5">
          <Delta value={change} unit={kpi.isRate ? 'pp' : '%'} higherIsBetter={kpi.higherIsBetter ?? true} />
          {change !== null && <span className="text-xs text-slate-400">{comparisonLabel}</span>}
        </div>
        <Sparkline values={kpi.series} color={color} label={t('{label} over the period', { label: t(kpi.label) })} />
        {kpi.peak && (
          <p className="text-xs text-slate-500">
            {t('Best {when}: {value}', { when: /^\d{4}-\d{2}-\d{2}$/.test(kpi.peak.label) ? formatBucket(kpi.peak.label, granularity, t.locale) : kpi.peak.label, value: formatValue(kpi.peak.value, kpi.format, false, t.locale) })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

const SEVERITY = {
  critical: { tone: 'red', label: msg('Critical') },
  attention: { tone: 'amber', label: msg('Attention') },
  info: { tone: 'blue', label: msg('Info') },
} as const;

export async function InsightCard({ insight, productHref }: { insight: Insight; productHref?: (key: string) => string }) {
  const t = await getT();
  const Icon = insight.kind === 'risk' ? ShieldAlert : Lightbulb;
  const sev = SEVERITY[insight.severity];
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-start gap-2">
          <Icon className={cn('mt-0.5 size-4 shrink-0', insight.kind === 'risk' ? 'text-red-600' : 'text-emerald-600')} aria-hidden />
          <h3 className="text-sm font-semibold text-slate-900">{insight.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sev.tone}>{t(sev.label)}</Badge>
          <Badge tone={insight.kind === 'risk' ? 'orange' : 'green'}>{insight.kind === 'risk' ? t('Risk') : t('Opportunity')}</Badge>
          {insight.confidence && <Badge tone="gray">{t('{level} confidence', { level: t(insight.confidence) })}</Badge>}
          {insight.impactPLN !== null && (
            <span className="text-xs text-slate-500">
              <span className="font-semibold text-slate-800">{formatValue(insight.impactPLN, 'pln', false, t.locale)}</span> {insight.impactLabel}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-600">{insight.why}</p>
        <p className="text-sm text-slate-800">
          <span className="font-medium">{t('Do:')} </span>
          {insight.action}
        </p>
        {insight.evidence?.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
            {insight.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {insight.entity?.type === 'product' && productHref && (
          <Link href={productHref(insight.entity.key)} className="text-xs font-medium text-brand-700 hover:underline">
            {t('Open {name} →', { name: insight.entity.label })}
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

const BANDS = {
  strong: { label: msg('Strong'), className: 'text-emerald-700', bar: 'bg-emerald-600' },
  healthy: { label: msg('Healthy'), className: 'text-emerald-700', bar: 'bg-emerald-500' },
  watch: { label: msg('Watch'), className: 'text-amber-700', bar: 'bg-amber-500' },
  'at-risk': { label: msg('At risk'), className: 'text-red-700', bar: 'bg-red-600' },
} as const;

export async function HealthCard({ health }: { health: HealthScore }) {
  const t = await getT();
  const band = BANDS[health.band];
  return (
    <Card>
      <CardBody className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('Business health')}</p>
          <p className="mt-1 text-5xl font-semibold tabular-nums text-slate-900">{Math.round(health.score)}</p>
          <p className={cn('text-sm font-semibold', band.className)}>{t(band.label)}</p>
          <p className="mt-2 text-sm text-slate-600">{health.headline}</p>
        </div>
        <ul className="space-y-3">
          {health.components.map((c) => (
            <li key={c.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800">
                  {c.label} <span className="text-xs font-normal text-slate-400">· {t('weight {pct}%', { pct: Math.round(c.weight * 100) })}</span>
                </span>
                <span className="tabular-nums text-slate-600">{c.value}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.score)} aria-label={c.label}>
                <div className={cn('h-1.5 rounded-full', c.score >= 65 ? 'bg-emerald-500' : c.score >= 50 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${Math.max(2, c.score)}%` }} />
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{c.detail}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export async function BriefCard({ brief, atStake }: { brief: ExecutiveBrief; atStake: number }) {
  const t = await getT();
  return (
    <Card className="border-brand-100 bg-gradient-to-br from-white to-brand-50/50">
      <CardBody className="space-y-2 py-5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand-700">
          <Sparkles className="size-3.5" aria-hidden /> {brief.greeting} · {brief.scope}
        </p>
        <p className="text-lg font-semibold text-slate-900">{brief.verdict}</p>
        {brief.body.map((line) => (
          <p key={line} className="text-sm text-slate-700">
            {line}
          </p>
        ))}
        {brief.attentionCount > 0 && (
          <p className="flex items-center gap-1.5 pt-1 text-sm text-slate-600">
            <AlertTriangle className="size-4 text-amber-600" aria-hidden />
            {t.plural(brief.attentionCount, '{n} finding needs a decision', '{n} findings need a decision')}
            {atStake > 0 && <> · {t('about {amount} at stake', { amount: formatValue(atStake, 'pln', false, t.locale) })}</>}.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

const TONES = { positive: 'text-emerald-700', negative: 'text-red-700', neutral: 'text-slate-900', opportunity: 'text-blue-700' } as const;

export async function QuestionCard({ answer }: { answer: QuestionAnswer }) {
  const t = await getT();
  return (
    <Card>
      <CardBody className="space-y-1.5">
        <p className="text-xs font-medium text-slate-500">{answer.question}</p>
        <p className="text-sm font-semibold text-slate-900">{answer.headline}</p>
        <p className={cn('text-2xl font-semibold tabular-nums', TONES[answer.tone])}>{answer.metric}</p>
        <p className="text-xs text-slate-500">{answer.metricCaption}</p>
        <p className="text-sm text-slate-600">{answer.explanation}</p>
        {answer.recommendation && (
          <p className="text-sm text-slate-800">
            <span className="font-medium">{t('Do:')} </span>
            {answer.recommendation}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** Revenue share and margin per marketplace, as proportional bars with the figures written out. */
export async function ChannelBars({ channels }: { channels: ChannelPerformance[] }) {
  const t = await getT();
  return (
    <ul className="space-y-4">
      {channels.map((c) => (
        <li key={c.source}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-slate-900">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: MARKETPLACE_COLORS[c.source] }} aria-hidden />
              {channelName(c.source)}
            </span>
            <span className="tabular-nums text-slate-600">
              {formatValue(c.revenuePLN, 'pln', false, t.locale)} · {t.plural(c.orders, '{n} order', '{n} orders')} · {t('margin {value}', { value: formatValue(c.marginPct, 'percent', false, t.locale) })} · {t('basket {value}', { value: formatValue(c.avgOrderValuePLN, 'pln', false, t.locale) })}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(1, c.revenueShare * 100)}%`, background: MARKETPLACE_COLORS[c.source] }} />
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{t('{pct}% of revenue', { pct: Math.round(c.revenueShare * 100) })}</p>
        </li>
      ))}
    </ul>
  );
}

/** Coloured intensity grid (one hue, light → dark) with every value written in its cell. */
export function Heatmap({
  rows,
  columns,
  cells,
  format,
  columnLabel = (c) => c,
}: {
  rows: string[];
  columns: string[];
  cells: { row: string; column: string; value: number; intensity: number }[];
  format: (v: number) => string;
  columnLabel?: (column: string) => string;
}) {
  const at = new Map(cells.map((c) => [`${c.row}|${c.column}`, c]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-slate-500" />
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 text-right font-medium text-slate-500">
                {columnLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th className="max-w-[16rem] truncate px-2 py-1 text-left font-medium text-slate-700" title={r}>
                {r}
              </th>
              {columns.map((c) => {
                const cell = at.get(`${r}|${c}`);
                const i = cell?.intensity ?? 0;
                return (
                  <td
                    key={c}
                    className="rounded px-2 py-1.5 text-right tabular-nums"
                    style={{ background: i > 0 ? `rgba(42,120,214,${0.08 + i * 0.72})` : '#f8f8f6', color: i > 0.55 ? '#fff' : '#0b0b0b' }}
                    title={`${r}, ${c}: ${cell ? format(cell.value) : '—'}`}
                  >
                    {cell && cell.value ? format(cell.value) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data-quality footer: how much of the revenue rests on known costs and reported fees. */
export async function CoverageNote({ costCoverage, estimatedFeeLines, totalLines, lastOrder }: { costCoverage: number; estimatedFeeLines: number; totalLines: number; lastOrder: Date | null }) {
  const t = await getT();
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 pt-4 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="size-3.5" aria-hidden /> {t('{pct}% of revenue has a known product cost', { pct: Math.round(costCoverage * 100) })}
      </span>
      <span>
        {t('{n} of {total} lines use an estimated fee (no fee reported yet)', { n: estimatedFeeLines, total: totalLines })}
      </span>
      {lastOrder && <span>{t('latest order {date}', { date: lastOrder.toLocaleDateString(intlTag(t.locale), { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>}
      <Link href="/settings/costs" className="text-brand-700 hover:underline">
        {t('Costs & margins →')}
      </Link>
    </p>
  );
}
