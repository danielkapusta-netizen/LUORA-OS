'use client';

import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/msg';
import type { OrderStatus } from '@/server/db/schema';
import { MARKETPLACE_LABELS } from '@/lib/utils';
import { Badge, type BadgeTone } from './ui';

const STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  // Same pastels as the Dashboard tiles for the open statuses.
  new: { label: msg('New'), tone: 'sky' },
  processing: { label: msg('Processing'), tone: 'blush' },
  label_created: { label: msg('Label created'), tone: 'butter' },
  shipped: { label: msg('Shipped'), tone: 'green' },
  delivered: { label: msg('Delivered'), tone: 'gray' },
  on_hold: { label: msg('On hold'), tone: 'peach' },
  cancelled: { label: msg('Cancelled'), tone: 'red' },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const t = useT();
  const s = STATUS[status];
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
}

// Same hues as the analytics charts, so a marketplace keeps one colour across the app.
const MARKETPLACE_DOTS: Record<string, string> = {
  shopify: 'bg-[#2a78d6]',
  allegro: 'bg-[#eb6834]',
  empik: 'bg-[#1baf7a]',
  vonhalsky: 'bg-[#d4a017]',
  hebe: 'bg-[#d6338a]',
};

/** A quiet chip: the marketplace's colour as a dot, the name in ink. */
export function MarketplaceBadge({ marketplace }: { marketplace: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-xs font-medium whitespace-nowrap text-slate-700">
      <span className={`size-1.5 rounded-full ${MARKETPLACE_DOTS[marketplace] ?? 'bg-slate-400'}`} aria-hidden />
      {MARKETPLACE_LABELS[marketplace] ?? marketplace}
    </span>
  );
}

const SHIPMENT: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: msg('Creating…'), tone: 'amber' },
  created: { label: msg('Label ready'), tone: 'green' },
  failed: { label: msg('Failed'), tone: 'red' },
  cancelled: { label: msg('Cancelled'), tone: 'gray' },
};

export function ShipmentBadge({ state }: { state: string }) {
  const t = useT();
  const s = SHIPMENT[state] ?? { label: state, tone: 'gray' as const };
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
}
