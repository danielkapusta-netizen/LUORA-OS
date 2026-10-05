'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

// Validated categorical slots 1–3 of the reference palette. Colour follows the
// marketplace everywhere, so a filter never repaints a series.
export const MARKETPLACE_COLORS: Record<string, string> = { shopify: '#2a78d6', allegro: '#eb6834', empik: '#1baf7a', vonhalsky: '#d4a017' };
const NAMES: Record<string, string> = { shopify: 'Shopify', allegro: 'Allegro', empik: 'Empik', vonhalsky: 'Von Halsky' };
const INK = { secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' };
const SINGLE = '#2a78d6';

const whole = (v: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(v);

function ChartTooltip({ active, payload, label, unit, format = whole }: Partial<TooltipContentProps<number, string>> & { unit?: string; format?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-slate-500">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="font-semibold tabular-nums text-slate-900">
            {format(Number(p.value))}
            {unit ? ` ${unit}` : ''}
          </span>
          {payload.length > 1 && <span className="text-slate-500">{p.name}</span>}
        </p>
      ))}
    </div>
  );
}

/** Revenue per day, stacked by marketplace. */
export function RevenueByDay({ data, marketplaces, currency }: { data: Record<string, number | string>[]; marketplaces: string[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: INK.axis }} tick={{ fill: INK.muted, fontSize: 11 }} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: INK.muted, fontSize: 11 }} tickFormatter={whole} width={56} />
        <Tooltip content={<ChartTooltip unit={currency} />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
        <Legend iconType="rect" iconSize={10} formatter={(v: string) => <span style={{ color: INK.secondary, fontSize: 12 }}>{v}</span>} />
        {marketplaces.map((m, i) => (
          <Bar
            key={m}
            dataKey={m}
            name={NAMES[m] ?? m}
            stackId="revenue"
            fill={MARKETPLACE_COLORS[m] ?? SINGLE}
            // Surface-coloured edge = the 2px gap between stacked segments.
            stroke="#ffffff"
            strokeWidth={2}
            maxBarSize={24}
            isAnimationActive={false}
            radius={i === marketplaces.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars with the value at the tip. */
export function HorizontalBars({
  data,
  unit,
  byMarketplace,
  decimals = 0,
}: {
  data: { key: string; label: string; value: number }[];
  unit?: string;
  /** Colour each bar by its marketplace key instead of the single-series blue. */
  byMarketplace?: boolean;
  decimals?: number;
}) {
  const format = (v: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: decimals }).format(v);
  return (
    <ResponsiveContainer width="100%" height={Math.max(80, data.length * 36 + 16)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, left: 0, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={{ stroke: INK.axis }} tick={{ fill: INK.secondary, fontSize: 12 }} width={120} />
        <Tooltip content={<ChartTooltip unit={unit} format={format} />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
        {/* No animation: Recharts hides value labels until an animation finishes. */}
        <Bar dataKey="value" maxBarSize={20} radius={[0, 4, 4, 0]} fill={SINGLE} isAnimationActive={false}>
          {byMarketplace && data.map((d) => <Cell key={d.key} fill={MARKETPLACE_COLORS[d.key] ?? SINGLE} />)}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: unknown) => `${format(Number(v))}${unit ? ` ${unit}` : ''}`}
            style={{ fill: INK.secondary, fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
