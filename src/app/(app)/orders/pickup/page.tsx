import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { buttonClass, Card, PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n/server';
import { today } from '@/lib/tasks/dates';
import { requireUser } from '@/server/auth';
import { listPickupAddresses, pickupBoard } from '@/server/services/pickups';
import { PickupBoard, type BoardColumn } from './pickup-board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Courier pickup') };
}

export default async function CourierPickupPage() {
  const t = await getT();
  const user = await requireUser();
  const [{ columns, otherCouriers }, addresses] = await Promise.all([pickupBoard(), listPickupAddresses()]);

  // Dates cross to the client as text.
  const board: BoardColumn[] = columns.map((c) => ({
    courier: c.courier,
    parcels: c.parcels.map((p) => ({ ...p, labelAt: p.labelAt.toISOString() })),
    pickups: c.pickups.map((p) => ({
      id: p.id,
      state: p.state,
      pickupDate: p.pickupDate,
      minTime: p.minTime,
      maxTime: p.maxTime,
      carrierPickupId: p.carrierPickupId,
      addressLabel: p.addressLabel,
      error: p.error,
      parcels: p.parcels,
    })),
  }));

  return (
    <>
      <PageHeader
        eyebrow={t('Orders')}
        title={t('Courier pickup')}
        description={t('Packed Allegro parcels that still need a courier. Tick them, choose a time the courier offers, and book.')}
      />
      {addresses.length === 0 ? (
        <Card className="mx-auto max-w-xl p-8 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-sky-tint text-sky-ink">
            <MapPin className="size-6" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">{t('Add a pickup address first')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('The courier needs to know where to collect the parcels. Addresses are kept in Settings → Shipping.')}</p>
          {user.role === 'admin' ? (
            <Link href="/settings/shipping#pickup-addresses" className={`${buttonClass('primary')} mt-5`}>
              {t('Add pickup address')}
            </Link>
          ) : (
            <p className="mt-4 text-sm text-slate-600">{t('Ask an administrator to add one.')}</p>
          )}
        </Card>
      ) : (
        <PickupBoard
          columns={board}
          otherCouriers={otherCouriers}
          addresses={addresses.map((a) => ({ id: a.id, label: a.label, line: `${a.street}, ${a.postalCode} ${a.city}`, isDefault: a.isDefault }))}
          today={today()}
        />
      )}
    </>
  );
}
