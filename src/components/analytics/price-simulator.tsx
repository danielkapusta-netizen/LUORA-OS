'use client';

import { useState } from 'react';
import { marginAt, profitAt } from '@/lib/analytics/pricing';
import { cn } from '@/lib/utils';
import { formatValue } from './format';

/** "What if I sold it at…": margin and monthly profit at another gross price, instantly. */
export function PriceSimulator({
  averagePrice,
  commissionRate,
  unitCost,
  monthlyUnits,
  averageMarginPct,
}: {
  averagePrice: number;
  commissionRate: number;
  unitCost: number;
  monthlyUnits: number;
  averageMarginPct: number;
}) {
  const [price, setPrice] = useState(Math.round(averagePrice * 100) / 100);
  const valid = price > 0;
  const profit = valid ? profitAt(price, commissionRate, unitCost) : 0;
  const margin = valid ? marginAt(price, commissionRate, unitCost) * 100 : 0;
  const current = profitAt(averagePrice, commissionRate, unitCost);
  const monthlyDelta = (profit - current) * monthlyUnits;
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-slate-600">
        Gross price, zł
        <div className="mt-1 flex items-center gap-3">
          <input
            type="range"
            min={Math.max(1, Math.floor(averagePrice * 0.6))}
            max={Math.ceil(averagePrice * 1.6)}
            step={0.5}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="h-9 w-24 rounded-xl border border-slate-200 px-2 text-sm tabular-nums"
          />
        </div>
      </label>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Margin</dt>
          <dd className={cn('font-semibold tabular-nums', margin < 0 && 'text-red-700')}>
            {formatValue(margin, 'percent')}{' '}
            <span className="text-xs font-normal text-slate-500">
              ({margin - averageMarginPct >= 0 ? '+' : ''}
              {(margin - averageMarginPct).toFixed(1)} pp)
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Profit per unit</dt>
          <dd className="font-semibold tabular-nums">{formatValue(profit, 'pln')}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Monthly change</dt>
          <dd className={cn('font-semibold tabular-nums', monthlyDelta < 0 ? 'text-red-700' : 'text-emerald-700')}>
            {monthlyDelta >= 0 ? '+' : ''}
            {formatValue(monthlyDelta, 'pln')}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-slate-500">
        Assumes {monthlyUnits} units a month, {(commissionRate * 100).toFixed(1)}% fees and a {formatValue(unitCost, 'pln')} landed cost; shipping and packaging are left out.
      </p>
    </div>
  );
}
