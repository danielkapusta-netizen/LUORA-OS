import { Package, UserRound } from 'lucide-react';
import { cn, formatMoney } from '@/lib/utils';
import { getT } from '@/lib/i18n/server';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Buyer's name, and whether the parcel goes to them or to someone else. */
export async function CustomerSummary({ buyerName, recipientName, className }: { buyerName: string; recipientName: string; className?: string }) {
  const t = await getT();
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl bg-canvas p-4', className)}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
        {initials(buyerName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{buyerName}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-sm">
          <UserRound className="size-3.5 shrink-0 text-slate-400" />
          {recipientName === buyerName ? (
            <span className="text-slate-500">{t('Recipient is the buyer')}</span>
          ) : (
            <span>
              <span className="text-slate-500">{t('Ships to')} </span>
              <span className="font-medium text-amber-700">{recipientName}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export interface SummaryItem {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  imageUrl: string | null;
}

/**
 * Products with photo and quantity; prices only when a currency is given.
 * `highlightQuantity` marks lines with more than one piece in yellow, so packers don't miss them.
 */
export async function OrderItemsList({
  items,
  currency,
  highlightQuantity,
  className,
}: {
  items: SummaryItem[];
  currency?: string;
  highlightQuantity?: boolean;
  className?: string;
}) {
  const t = await getT();
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-white">
            {i.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- marketplace CDNs vary; no image optimiser on Workers
              <img src={i.imageUrl} alt="" className="size-full object-contain" loading="lazy" />
            ) : (
              <Package className="size-5 text-slate-300" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm leading-snug">{i.name}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {highlightQuantity && i.quantity > 1 ? (
                <span className="mr-1 inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-sm font-semibold text-amber-800 ring-1 ring-amber-300">
                  {t('Qty {n}', { n: i.quantity })}
                </span>
              ) : (
                <>{t('Qty {n}', { n: i.quantity })} </>
              )}
              {i.sku ? `· ${i.sku}` : ''}
            </p>
          </div>
          {currency && <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{formatMoney(Number(i.unitPrice) * i.quantity, currency)}</span>}
        </li>
      ))}
    </ul>
  );
}
