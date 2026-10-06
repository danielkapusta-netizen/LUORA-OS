// What every analytics page starts from: the business data, the chosen period and its snapshot.
import type { CustomRange, PeriodKey, ResolvedPeriod } from '@/lib/analytics/period';
import type { Snapshot } from '@/lib/analytics/snapshot';
import type { Channel } from '@/lib/analytics/types';
import { loadBusinessData, parsePeriodKey, periodFor, snapshotFor, type BusinessData } from './dataset';

export interface ViewParams {
  period?: string;
  marketplace?: string;
  from?: string;
  to?: string;
}

export interface AnalyticsView {
  data: BusinessData;
  period: ResolvedPeriod;
  periodKey: PeriodKey;
  snapshot: Snapshot;
  marketplace?: Channel;
  /** The query parameters that define the view, to keep when linking within it. */
  params: Record<string, string | undefined>;
}

const CHANNELS: Channel[] = ['shopify', 'allegro', 'empik', 'vonhalsky'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function analyticsView(p: ViewParams, fallback: PeriodKey = 'month'): Promise<AnalyticsView> {
  const marketplace = CHANNELS.includes(p.marketplace as Channel) ? (p.marketplace as Channel) : undefined;
  const data = await loadBusinessData({ marketplace });
  const custom: CustomRange | undefined =
    p.from && p.to && DAY.test(p.from) && DAY.test(p.to) ? { from: new Date(`${p.from}T00:00:00Z`), to: new Date(`${p.to}T23:59:59Z`) } : undefined;
  const periodKey = custom ? 'custom' : parsePeriodKey(p.period, fallback);
  const period = periodFor(data, periodKey, custom);
  return {
    data,
    period,
    periodKey,
    snapshot: snapshotFor(data, period),
    marketplace,
    params: { period: custom ? undefined : p.period, marketplace, from: custom ? p.from : undefined, to: custom ? p.to : undefined },
  };
}
