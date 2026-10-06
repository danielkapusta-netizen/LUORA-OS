import { Badge } from '@/components/ui';
import type { SalesLine } from '@/server/db/schema';
import { cn } from '@/lib/utils';

/** How an order's revenue becomes profit, from its stored profit lines. */
export function ProfitBreakdown({ lines, compact }: { lines: SalesLine[]; compact?: boolean }) {
  if (!lines.length) return <p className="text-sm text-slate-500">No profit figures yet (cancelled, or waiting for the exchange rate).</p>;
  const total = (k: keyof SalesLine) => lines.reduce((sum, l) => sum + Number(l[k] ?? 0), 0);
  const gross = total('gross');
  const net = total('net');
  const profit = total('profit');
  const estimated = lines.some((l) => l.feesEstimated);
  const missingCost = lines.some((l) => !l.costKnown);
  const rows: [string, number, string?][] = [
    ['Paid for the goods', gross],
    ['VAT', net - gross],
    ['Marketplace fees', -total('fees'), estimated ? 'estimated' : undefined],
    ['Product cost', -total('cost'), missingCost ? 'missing for some lines' : undefined],
    ['Shipping paid by the buyer', total('shipping')],
    ['Labels, packaging, delivery', -total('delivery')],
    ['Refunds', -total('refunds')],
  ];
  return (
    <div className={cn('space-y-1.5 text-sm', compact && 'text-xs')}>
      <dl className="space-y-1">
        {rows
          .filter(([label, v]) => Math.abs(v) >= 0.005 || label === 'Product cost')
          .map(([label, v, note]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-600">
                {label} {note && <Badge tone="amber">{note}</Badge>}
              </dt>
              <dd className="tabular-nums">{v.toFixed(2)} zł</dd>
            </div>
          ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-1 font-semibold">
          <dt>Profit</dt>
          <dd className={cn('tabular-nums', profit < 0 ? 'text-red-700' : 'text-emerald-700')}>
            {profit.toFixed(2)} zł <span className="text-xs font-normal text-slate-500">({gross > 0 ? ((profit / gross) * 100).toFixed(1) : '0'}% margin)</span>
          </dd>
        </div>
      </dl>
      {lines[0].currency !== 'PLN' && (
        <p className="text-xs text-slate-500">
          Converted from {lines[0].currency} at {lines[0].fxRate.toFixed(4)} (NBP, {lines[0].day}); VAT {(lines[0].vatRate * 100).toFixed(0)}%.
        </p>
      )}
    </div>
  );
}
