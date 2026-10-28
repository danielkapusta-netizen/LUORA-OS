import type { Metadata } from 'next';
import { hrefWith, InsightCard, Pills } from '@/components/analytics/blocks';
import { formatValue } from '@/components/analytics/format';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { ViewFilters } from '../filters';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Analytics · Action centre') };
}

const RULES = [
  [msg('Margin leak'), msg('A product with at least 2% of revenue earning under 15% margin (critical under 8%).')],
  [msg('Profit concentration'), msg('One product brings more than 30% of profit (critical over 45%).')],
  [msg('Missing costs'), msg('Revenue from products without a landed cost; their profit is overstated.')],
  [msg('Channel gap'), msg('Marketplaces converting revenue to profit 4 or more points apart.')],
  [msg('Under-scaled winners'), msg('Margin 8+ points above the portfolio, 3+ orders, under 10% of revenue.')],
  [msg('Momentum'), msg('Revenue or profit moving 12% or more against the previous window.')],
  [msg('Thin lines'), msg('More than 10% of order lines under 8% margin.')],
];

export default async function ActionCentrePage({ searchParams }: { searchParams: Promise<ViewParams & { kind?: string }> }) {
  const t = await getT();
  await requireUser();
  const params = await searchParams;
  const view = await analyticsView(params);
  const kind = params.kind === 'risk' || params.kind === 'opportunity' ? params.kind : 'all';
  const all = view.snapshot.insights;
  const shown = kind === 'all' ? all : all.filter((i) => i.kind === kind);
  const atStake = all.reduce((sum, i) => sum + (i.impactPLN ?? 0), 0);
  const productHref = (key: string) => hrefWith('/analytics/products', view.params, { open: key });

  return (
    <>
      <ViewFilters view={view} path="/analytics/actions" extra={{ kind: params.kind }} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Pills
          label={t('Show')}
          options={[
            { value: 'all', label: t('All ({n})', { n: all.length }) },
            { value: 'risk', label: t('Risks ({n})', { n: all.filter((i) => i.kind === 'risk').length }) },
            { value: 'opportunity', label: t('Opportunities ({n})', { n: all.filter((i) => i.kind === 'opportunity').length }) },
          ]}
          active={kind}
          href={(v) => hrefWith('/analytics/actions', view.params, { kind: v === 'all' ? undefined : v })}
        />
        <Badge tone="red">{t('{n} critical', { n: all.filter((i) => i.severity === 'critical').length })}</Badge>
        {atStake > 0 && <span className="text-sm text-slate-600">{t('About {amount} at stake', { amount: formatValue(atStake, 'pln', false, t.locale) })}</span>}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {shown.length ? shown.map((i) => <InsightCard key={i.id} insight={i} productHref={productHref} />) : (
            <Card>
              <EmptyState title={t('Nothing to act on in this period')} />
            </Card>
          )}
        </div>
        <Card className="self-start">
          <CardBody className="space-y-2">
            <p className="text-sm font-semibold">{t('How findings are raised')}</p>
            <ul className="space-y-2 text-xs text-slate-600">
              {RULES.map(([title, text]) => (
                <li key={title}>
                  <span className="font-medium text-slate-800">{t(title)}.</span> {t(text)}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
