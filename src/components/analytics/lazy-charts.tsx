'use client';

// The Recharts charts, split out of the first page load. Recharts is the biggest client bundle in the app,
// so each chart loads on its own after the page has painted. The box keeps the chart's height while it
// loads, so nothing below it jumps.
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

function Skeleton() {
  return <div className="h-full min-h-[inherit] w-full animate-pulse rounded-2xl bg-black/[0.03] motion-reduce:animate-none" aria-hidden />;
}

function sized<P extends object>(Chart: ComponentType<P>, height: number | ((props: P) => number)) {
  function LazyChart(props: P) {
    const h = typeof height === 'function' ? height(props) : height;
    return (
      <div style={{ minHeight: h }} className="grid [&>*]:min-w-0">
        <Chart {...props} />
      </div>
    );
  }
  return LazyChart;
}

export const PulseChart = sized(dynamic(() => import('./charts').then((m) => m.PulseChart), { ssr: false, loading: Skeleton }), 280);
export const MetricChart = sized(dynamic(() => import('./charts').then((m) => m.MetricChart), { ssr: false, loading: Skeleton }), 320);
export const WeekdayBars = sized(dynamic(() => import('./charts').then((m) => m.WeekdayBars), { ssr: false, loading: Skeleton }), 200);
export const Waterfall = sized(dynamic(() => import('./charts').then((m) => m.Waterfall), { ssr: false, loading: Skeleton }), 220);
export const HistoryCharts = sized(dynamic(() => import('./charts').then((m) => m.HistoryCharts), { ssr: false, loading: Skeleton }), 184);
export const PriceCharts = sized(dynamic(() => import('./charts').then((m) => m.PriceCharts), { ssr: false, loading: Skeleton }), 184);
export const RevenueByDay = sized(dynamic(() => import('@/app/(app)/analytics/charts').then((m) => m.RevenueByDay), { ssr: false, loading: Skeleton }), 280);
export const HorizontalBars = sized(
  dynamic(() => import('@/app/(app)/analytics/charts').then((m) => m.HorizontalBars), { ssr: false, loading: Skeleton }),
  (p) => Math.max(80, p.data.length * 36 + 16),
);
