import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { formatPrice } from '@/lib/price';
import type { PricingFloor } from '@/server/services/pricing';

/**
 * The lowest price that still earns the minimum margin on this platform. The parts it is made of (cost, shipping,
 * packaging, commission) are only shown to people who may see costs; everyone who sees the page sees the price.
 */
export async function FloorCell({ floor, showParts, canEditCosts }: { floor: PricingFloor; showParts: boolean; canEditCosts: boolean }) {
  const t = await getT();
  if (floor.state === 'no_cost') {
    return (
      <span className="text-xs text-slate-500">
        {canEditCosts ? (
          <Link className="text-brand-700 underline underline-offset-2" href="/settings/costs">
            {t('Add the cost')}
          </Link>
        ) : (
          t('No cost yet')
        )}
      </span>
    );
  }
  if (floor.state === 'unreachable' || floor.price === null) {
    return (
      <span className="text-xs text-amber-700" title={t('Commission and margin leave nothing of the price to cover the costs')}>
        {t('Not reachable')}
      </span>
    );
  }
  const percent = (share: number) => `${(share * 100).toLocaleString(t.locale === 'pl' ? 'pl-PL' : 'en-GB', { maximumFractionDigits: 1 })}%`;
  return (
    <div>
      <span className="font-semibold tabular-nums">{formatPrice(floor.price)}</span>
      {showParts && floor.unitCost !== null && (
        <p className="mt-1 max-w-56 text-xs leading-relaxed whitespace-normal text-slate-500">
          {t('cost {cost} + shipping {shipping} + packaging {packaging}; commission {commission} of the price', {
            cost: formatPrice(floor.unitCost),
            shipping: formatPrice(floor.shipping),
            packaging: formatPrice(floor.packaging),
            commission: percent(floor.commissionShare),
          })}
        </p>
      )}
    </div>
  );
}

/** A price under the lowest price: shown in red next to it, so nobody sells below the margin without noticing. */
export async function BelowFloorNote({ floor }: { floor: PricingFloor }) {
  const t = await getT();
  if (floor.price === null) return null;
  return <p className="mt-1 text-xs text-red-700">{t('Below the lowest price ({price})', { price: formatPrice(floor.price) })}</p>;
}
