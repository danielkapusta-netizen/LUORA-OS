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

// Same hues as the analytics charts, deepened so white text keeps 4.5:1 across the whole gradient.
const MARKETPLACE_FILLS: Record<string, string> = {
  shopify: 'from-[#2a6cc6] to-[#1d4f94]',
  allegro: 'from-[#c94a1c] to-[#a93c12]',
  empik: 'from-[#0f7a50] to-[#0b5e3e]',
  vonhalsky: 'from-[#8a6400] to-[#6e5000]',
  hebe: 'from-[#c92f7f] to-[#a3225f]',
};

/** The marketplace as a filled chip in its own colour, so the source reads at a glance. */
export function MarketplaceBadge({ marketplace }: { marketplace: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-gradient-to-br px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${MARKETPLACE_FILLS[marketplace] ?? 'from-slate-500 to-slate-700'}`}
    >
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
