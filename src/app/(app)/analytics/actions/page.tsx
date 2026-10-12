import type { Metadata } from 'next';
import { hrefWith, InsightCard, Pills } from '@/components/analytics/blocks';
import { formatValue } from '@/components/analytics/format';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { ViewFilters } from '../filters';

export const metadata: Metadata = { title: 'Analytics · Action centre' };

const RULES = [
  ['Margin leak', 'A product with at least 2% of revenue earning under 15% margin (critical under 8%).'],
  ['Profit concentration', 'One product brings more than 30% of profit (critical over 45%).'],
  ['Missing costs', 'Revenue from products without a landed cost; their profit is overstated.'],
  ['Channel gap', 'Marketplaces converting revenue to profit 4 or more points apart.'],
  ['Under-scaled winners', 'Margin 8+ points above the portfolio, 3+ orders, under 10% of revenue.'],
  ['Momentum', 'Revenue or profit moving 12% or more against the previous window.'],
  ['Thin lines', 'More than 10% of order lines under 8% margin.'],
];

export default async function ActionCentrePage({ searchParams }: { searchParams: Promise<ViewParams & { kind?: string }> }) {
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
          label="Show"
          options={[
            { value: 'all', label: `All (${all.length})` },
            { value: 'risk', label: `Risks (${all.filter((i) => i.kind === 'risk').length})` },
            { value: 'opportunity', label: `Opportunities (${all.filter((i) => i.kind === 'opportunity').length})` },
          ]}
          active={kind}
          href={(v) => hrefWith('/analytics/actions', view.params, { kind: v === 'all' ? undefined : v })}
        />
        <Badge tone="red">{all.filter((i) => i.severity === 'critical').length} critical</Badge>
        {atStake > 0 && <span className="text-sm text-slate-600">About {formatValue(atStake, 'pln')} at stake</span>}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {shown.length ? shown.map((i) => <InsightCard key={i.id} insight={i} productHref={productHref} />) : (
            <Card>
              <EmptyState title="Nothing to act on in this period" />
            </Card>
          )}
        </div>
        <Card className="self-start">
          <CardBody className="space-y-2">
            <p className="text-sm font-semibold">How findings are raised</p>
            <ul className="space-y-2 text-xs text-slate-600">
              {RULES.map(([title, text]) => (
                <li key={title}>
                  <span className="font-medium text-slate-800">{title}.</span> {text}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
