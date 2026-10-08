'use client';

// Charts for the analytics pages. Same conventions as the operations charts: validated palette
// slots, thin marks, recessive axes, a tooltip on every chart, colour by entity (never by rank).
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import { formatBucket, formatValue, INK, SERIES, STATUS, type ValueFormat } from './format';

function ChartTooltip({ active, payload, label, format, granularity }: Partial<TooltipContentProps<number, string>> & { format: ValueFormat; granularity?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-slate-500">{typeof label === 'string' ? formatBucket(label, granularity) : label}</p>
      {rows.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="font-semibold tabular-nums text-slate-900">{formatValue(Number(p.value), format)}</span>
          <span className="text-slate-500">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

const axisProps = {
  x: { tickLine: false, axisLine: { stroke: INK.axis }, tick: { fill: INK.muted, fontSize: 11 }, minTickGap: 20 },
  y: { tickLine: false, axisLine: false, tick: { fill: INK.muted, fontSize: 11 }, width: 64 },
} as const;

/** A tiny trend line for KPI tiles (no axes; the tile states the value). */
export function Sparkline({ values, color = SERIES.revenue, label }: { values: number[]; color?: string; label: string }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface PulsePoint {
  date: string;
  revenue: number;
  profit: number;
  orders: number;
}

/** Revenue and profit (same unit, one axis) or orders over time. */
export function PulseChart({ data, metric, granularity, showProfit = true }: { data: PulsePoint[]; metric: 'money' | 'orders'; granularity: string; showProfit?: boolean }) {
  const format: ValueFormat = metric === 'orders' ? 'number' : 'pln';
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="date" {...axisProps.x} tickFormatter={(d: string) => formatBucket(d, granularity)} />
        <YAxis {...axisProps.y} tickFormatter={(v: number) => formatValue(v, format, true)} />
        <Tooltip content={<ChartTooltip format={format} granularity={granularity} />} cursor={{ stroke: INK.axis }} />
        {metric === 'money' ? (
          <>
            <Legend iconType="plainline" formatter={(v: string) => <span style={{ color: INK.secondary, fontSize: 12 }}>{v}</span>} />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke={SERIES.revenue} fill={SERIES.revenue} fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} />
            {showProfit && <Area type="monotone" dataKey="profit" name="Profit" stroke={SERIES.profit} fill={SERIES.profit} fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} />}
            <ReferenceLine y={0} stroke={INK.axis} />
          </>
        ) : (
          <Bar dataKey="orders" name="Orders" fill={SERIES.revenue} maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface SeriesPoint {
  date: string;
  value: number | null;
  previous: number | null;
  lastYear: number | null;
  movingAverage: number | null;
  forecast: number | null;
}

/** The Trends chart: one metric with optional comparison, average and projection overlays. */
export function MetricChart({
  data,
  format,
  granularity,
  label,
  overlays,
}: {
  data: SeriesPoint[];
  format: ValueFormat;
  granularity: string;
  label: string;
  overlays: { previous?: boolean; lastYear?: boolean; movingAverage?: boolean; forecast?: boolean };
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="date" {...axisProps.x} tickFormatter={(d: string) => formatBucket(d, granularity)} />
        <YAxis {...axisProps.y} tickFormatter={(v: number) => formatValue(v, format, true)} />
        <Tooltip content={<ChartTooltip format={format} granularity={granularity} />} cursor={{ stroke: INK.axis }} />
        <Legend iconType="plainline" formatter={(v: string) => <span style={{ color: INK.secondary, fontSize: 12 }}>{v}</span>} />
        <Area type="monotone" dataKey="value" name={label} stroke={SERIES.revenue} fill={SERIES.revenue} fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
        {overlays.previous && (
          <Line type="monotone" dataKey="previous" name="Previous period" stroke={INK.comparison} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        )}
        {overlays.lastYear && (
          <Line type="monotone" dataKey="lastYear" name="Last year" stroke={SERIES.third} strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
        )}
        {overlays.movingAverage && (
          <Line type="monotone" dataKey="movingAverage" name="Moving average" stroke={INK.primary} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        )}
        {overlays.forecast && (
          <Line type="monotone" dataKey="forecast" name="Projection" stroke={SERIES.revenue} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Two small charts side by side for a product's month-by-month history (never two axes on one). */
export function HistoryCharts({ data }: { data: { month: string; marginPct: number; units: number; orders: number }[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Margin over time</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="month" {...axisProps.x} tickFormatter={(d: string) => formatBucket(d, 'month')} />
            <YAxis {...axisProps.y} width={44} tickFormatter={(v: number) => `${Math.round(v)}%`} />
            <Tooltip content={<ChartTooltip format="percent" granularity="month" />} cursor={{ stroke: INK.axis }} />
            <ReferenceLine y={0} stroke={INK.axis} />
            <Line type="monotone" dataKey="marginPct" name="Margin" stroke={SERIES.profit} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Units sold</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="month" {...axisProps.x} tickFormatter={(d: string) => formatBucket(d, 'month')} />
            <YAxis {...axisProps.y} width={36} allowDecimals={false} />
            <Tooltip content={<ChartTooltip format="number" granularity="month" />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
            <Bar dataKey="units" name="Units" fill={SERIES.revenue} maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Unit price and margin of each sale, for the pricing page (two charts, one axis each). */
export function PriceCharts({ prices, margins }: { prices: { date: string; price: number }[]; margins: { date: string; marginPct: number }[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Price per unit, each sale</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={prices} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="date" {...axisProps.x} tickFormatter={(d: string) => formatBucket(d)} />
            <YAxis {...axisProps.y} width={52} domain={['auto', 'auto']} tickFormatter={(v: number) => formatValue(v, 'pln', true)} />
            <Tooltip content={<ChartTooltip format="pln" />} cursor={{ stroke: INK.axis }} />
            <Line type="stepAfter" dataKey="price" name="Price" stroke={SERIES.revenue} strokeWidth={2} dot={prices.length <= 30 ? { r: 3 } : false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Margin by month</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={margins} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="date" {...axisProps.x} tickFormatter={(d: string) => formatBucket(d, 'month')} />
            <YAxis {...axisProps.y} width={44} tickFormatter={(v: number) => `${Math.round(v)}%`} />
            <Tooltip content={<ChartTooltip format="percent" granularity="month" />} cursor={{ stroke: INK.axis }} />
            <ReferenceLine y={0} stroke={INK.axis} />
            <Line type="monotone" dataKey="marginPct" name="Margin" stroke={SERIES.profit} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** An axis label broken over two lines, so long step names never run into each other. */
function WrappedTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const words = String(payload?.value ?? '').split(' ');
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : words;
  return (
    <text x={x} y={(y ?? 0) + 4} textAnchor="middle" fill={INK.secondary} fontSize={11}>
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? 8 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

type WaterfallStep = { label: string; value: number; kind: 'start' | 'minus' | 'plus' | 'total' };

/** Floating bars: each step starts where the previous one ended. */
function waterfallBars(steps: WaterfallStep[]) {
  const out: { label: string; base: number; size: number; value: number; kind: WaterfallStep['kind'] }[] = [];
  let level = 0;
  for (const s of steps) {
    if (s.kind === 'start' || s.kind === 'total') {
      level = s.value;
      out.push({ label: s.label, base: Math.min(0, s.value), size: Math.abs(s.value), value: s.value, kind: s.kind });
      continue;
    }
    const next = s.kind === 'minus' ? level - s.value : level + s.value;
    out.push({ label: s.label, base: Math.min(level, next), size: Math.abs(s.value), value: s.kind === 'minus' ? -s.value : s.value, kind: s.kind });
    level = next;
  }
  return out;
}

/** Where the money of an average sale goes: revenue, then each deduction, then profit. */
export function Waterfall({ steps }: { steps: WaterfallStep[] }) {
  const data = waterfallBars(steps);
  const color = (kind: string, value: number) =>
    kind === 'start' ? SERIES.revenue : kind === 'total' ? (value >= 0 ? STATUS.good : STATUS.critical) : kind === 'minus' ? INK.comparison : SERIES.profit;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: INK.axis }} tick={<WrappedTick />} interval={0} height={36} />
        <YAxis {...axisProps.y} width={52} tickFormatter={(v: number) => formatValue(v, 'pln', true)} />
        <Tooltip
          cursor={{ fill: 'rgba(11,11,11,0.04)' }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs shadow-md">
                <p className="text-slate-500">{String(payload[0].payload.label)}</p>
                <p className="font-semibold tabular-nums">{formatValue(Number(payload[0].payload.value), 'pln')}</p>
              </div>
            ) : null
          }
        />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="size" stackId="w" maxBarSize={44} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.label} fill={color(d.kind, d.value)} />
          ))}
          <LabelList dataKey="value" position="top" formatter={(v: unknown) => formatValue(Number(v), 'pln')} style={{ fill: INK.secondary, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Revenue by weekday: which days trade. */
export function WeekdayBars({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: INK.axis }} tick={{ fill: INK.secondary, fontSize: 12 }} />
        <YAxis {...axisProps.y} tickFormatter={(v: number) => formatValue(v, 'pln', true)} />
        <Tooltip content={<ChartTooltip format="pln" />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
        <Bar dataKey="value" name="Average revenue" fill={SERIES.revenue} maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
