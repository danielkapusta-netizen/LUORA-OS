import type { OrderStatus } from '@/server/db/schema';
import { MARKETPLACE_LABELS } from '@/lib/utils';
import { Badge, type BadgeTone } from './ui';

const STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'New', tone: 'blue' },
  processing: { label: 'Processing', tone: 'violet' },
  label_created: { label: 'Label created', tone: 'amber' },
  shipped: { label: 'Shipped', tone: 'green' },
  delivered: { label: 'Delivered', tone: 'gray' },
  on_hold: { label: 'On hold', tone: 'orange' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

// Same hues as the analytics charts, so a marketplace keeps one colour across the app.
const MARKETPLACE_TONES: Record<string, string> = {
  shopify: 'bg-blue-100 text-blue-800',
  allegro: 'bg-orange-100 text-orange-800',
  empik: 'bg-emerald-100 text-emerald-800',
  vonhalsky: 'bg-amber-100 text-amber-900',
};

export function MarketplaceBadge({ marketplace }: { marketplace: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${MARKETPLACE_TONES[marketplace] ?? 'bg-slate-100'}`}>
      {MARKETPLACE_LABELS[marketplace] ?? marketplace}
    </span>
  );
}

const SHIPMENT: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Creating…', tone: 'amber' },
  created: { label: 'Label ready', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export function ShipmentBadge({ state }: { state: string }) {
  const s = SHIPMENT[state] ?? { label: state, tone: 'gray' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
