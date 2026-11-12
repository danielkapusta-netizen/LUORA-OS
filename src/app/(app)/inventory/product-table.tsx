// The rows of the Inventory table: one compact line per product, with one column per marketplace.
import { AlertCircle, Boxes } from 'lucide-react';
import Link from 'next/link';
import { MarketplaceBadge } from '@/components/badges';
import { ExpandableRow } from '@/components/expandable-row';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Gauge } from '@/components/gauge';
import { Badge, Input, Select } from '@/components/ui';
import { msg } from '@/lib/i18n/msg';
import type { T } from '@/lib/i18n/translate';
import { LOW_STOCK, type MarketplaceCell } from '@/lib/inventory-view';
import { hasRealSku } from '@/lib/sku';
import { desiredQuantity, GONE, marketplaceQuantity } from '@/lib/stock';
import { cn, formatDate, MARKETPLACE_LABELS } from '@/lib/utils';
import type { Product } from '@/server/db/schema';
import type { listProductsWithListings } from '@/server/services/inventory';
import type { PerformanceLevel, ProductPerformance } from '@/server/services/product-stats';
import { activateListingAction, adjustStockAction, adoptStockAction, setListingStockAction, unlinkListingAction } from './actions';

export type ListingRow = Awaited<ReturnType<typeof listProductsWithListings>>['listings'][number];

const LEVEL_LABEL: Record<PerformanceLevel, string> = { excellent: msg('Excellent'), good: msg('Good'), low: msg('Low'), none: msg('No sales') };
const LEVEL_TONE: Record<PerformanceLevel, string> = { excellent: 'text-emerald-700', good: 'text-emerald-700', low: 'text-amber-700', none: 'text-slate-500' };

export function ProductPhoto({ product, size = 'size-8' }: { product: Pick<Product, 'imageUrl'>; size?: string }) {
  return product.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
    <img src={product.imageUrl} alt="" loading="lazy" className={cn(size, 'shrink-0 rounded-lg border border-black/[0.06] bg-white object-contain')} />
  ) : (
    <span className={cn(size, 'flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400')}>
      <Boxes className="size-4" aria-hidden />
    </span>
  );
}

const num = 'font-mono text-[13px] tabular-nums';
const sub = 'text-[10px] leading-none text-slate-500';

/**
 * How the product stands on one marketplace. A plain number means on sale and right; colour and words are kept
 * for what needs a look. `inline` lays it out on one line, for the chips on a phone.
 */
function CellView({ cell, platform, productId, publishHref, inline, t }: { cell: MarketplaceCell; platform: string; productId: string; publishHref?: string; inline?: boolean; t: T }) {
  const label = MARKETPLACE_LABELS[platform] ?? platform;
  const shown = cell.shown.map((q) => q ?? '?').join(' / ');
  const wrap = cn('inline-flex items-center', inline ? 'gap-1' : 'min-h-8 flex-col justify-center gap-0.5');
  const notes = [cell.untracked ? t('not tracked') : null, cell.draft === 'draft' ? t('draft') : cell.draft ? t('archived') : null].filter(Boolean).join(' · ');
  const noteTitle = cell.untracked ? t('{platform} does not track this product’s stock: it sells there whatever the number says.', { platform: label }) : undefined;

  switch (cell.kind) {
    case 'none':
      return publishHref ? (
        <Link href={publishHref} title={t('No offer on {platform}. Create one.', { platform: label })} className={cn(wrap, 'rounded px-2 text-slate-400 hover:bg-black/[0.04] hover:text-ink')}>
          —
        </Link>
      ) : (
        <span title={t('No offer on {platform}', { platform: label })} className={cn(wrap, 'text-slate-400')}>
          —
        </span>
      );
    case 'gone':
      return (
        <span title={t('The offer no longer exists on {platform}', { platform: label })} className={cn(wrap, 'text-[11px] text-slate-500')}>
          {t('removed')}
        </span>
      );
    case 'off': {
      const status = cell.reason ? ` (${cell.reason.toLowerCase()})` : '';
      if (!cell.activateId) {
        return (
          <span
            title={cell.held ? t('Off sale on {platform}{status}. Nothing is sent to this account yet.', { platform: label, status }) : t('Off sale on {platform}{status}. There is no stock to put on sale.', { platform: label, status })}
            className={cn(wrap, 'text-[11px] text-slate-500')}
          >
            {t('off sale')}
          </span>
        );
      }
      return (
        <ActionForm action={activateListingAction.bind(null, cell.activateId)} className={wrap} quiet popup={t('Activating on {platform}', { platform: label })}>
          <span title={t('Off sale on {platform}{status}. Put it back on sale with the stock in Luora.', { platform: label, status })}>
            <SubmitButton size="sm" variant="secondary" pendingText="…" className="h-6 px-2 text-[11px] max-md:h-8 max-md:px-3 max-md:text-xs">
              {t('Activate')}
            </SubmitButton>
          </span>
        </ActionForm>
      );
    }
    case 'locked':
      return (
        <span title={t('A bundle: {platform} counts its stock from its components, so nothing is sent.', { platform: label })} className={wrap}>
          <span className={cn(num, 'text-slate-600')}>{shown}</span>
          <span className={sub}>{t('bundle')}</span>
        </span>
      );
    case 'manual':
      return (
        <span title={t('Managed on {platform}: nothing is sent.', { platform: label })} className={wrap}>
          <span className={cn(num, 'text-slate-600')}>{shown}</span>
          <span className={sub}>{t('manual')}</span>
        </span>
      );
    case 'ok':
      return (
        <span className={wrap} title={noteTitle}>
          <span className={cn(num, 'text-ink')}>{shown}</span>
          {notes && <span className={sub}>{notes}</span>}
        </span>
      );
    case 'differs': {
      // Nothing is sent to an account under review, so the choice is offered instead: take its number.
      // Only Shopify's number can be taken: it is where stock was kept until now.
      const takeable = platform === 'shopify' && cell.held && !cell.untracked && cell.accountId && cell.shown.length === 1 && cell.shown[0] !== null;
      if (takeable) {
        return (
          <ActionForm action={adoptStockAction.bind(null, cell.accountId!, productId)} className={wrap} quiet popup={t('Taking stock from {platform}', { platform: label })}>
            <span className={cn(num, 'font-semibold text-amber-700')} title={t('{platform} shows {has}; Luora has {want}. Nothing is sent to {platform} yet.', { platform: label, has: shown, want: cell.want ?? 0 })}>
              {shown}
            </span>
            <span title={t('Set the stock in Luora to {n}, as {platform} shows', { n: shown, platform: label })}>
              <SubmitButton size="sm" variant="ghost" pendingText="…" className="h-5 px-1.5 text-[10px] underline underline-offset-2 max-md:h-8 max-md:px-2 max-md:text-xs">
                {t('use {n}', { n: shown })}
              </SubmitButton>
            </span>
          </ActionForm>
        );
      }
      return (
        <span
          className={wrap}
          title={
            cell.held
              ? t('{platform} shows {has}; Luora has {want}. Nothing is sent to {platform} yet.', { platform: label, has: shown, want: cell.want ?? 0 })
              : t('{platform} shows {has}; it is being sent {want}.', { platform: label, has: shown, want: cell.want ?? 0 })
          }
        >
          <span className={cn(num, 'font-semibold text-amber-700')}>{shown}</span>
          <span className={cn(sub, 'text-amber-700')}>{cell.held ? notes || t('differs') : `→ ${cell.want}`}</span>
        </span>
      );
    }
    case 'error':
      return (
        <span className={wrap} title={t('{platform} refused the last update: {reason}', { platform: label, reason: cell.reason ?? '' })}>
          <span className={cn(num, 'inline-flex items-center gap-1 font-semibold text-red-700')}>
            <AlertCircle className="size-3.5" aria-hidden />
            {shown}
          </span>
          <span className={cn(sub, 'text-red-700')}>{t('refused')}</span>
        </span>
      );
  }
}

/** Every listing of the product: what each is sent, when it last got through, and the way to change that. */
function ListingDetails({ listings, stock, isLive, t }: { listings: ListingRow[]; stock: number; isLive: (accountId: string) => boolean; t: T }) {
  if (listings.length === 0) return <p className="px-2 py-3 text-sm text-slate-500">{t('Not linked to any platform listing.')}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-black/[0.06] bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">{t('Platform')}</th>
            <th className="px-3 py-2 font-medium">{t('Name on the platform')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('Stock there')}</th>
            <th className="px-3 py-2 font-medium">{t('Send')}</th>
            <th className="px-3 py-2 font-medium">{t('Last sync')}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {listings.map((l) => {
            const gone = l.listingStatus === GONE;
            const offSale = !l.active && !l.soldOut && !gone;
            const qty = marketplaceQuantity(l);
            const want = desiredQuantity({ stock, ...l });
            const sellable = desiredQuantity({ stock, stockMode: l.stockMode, fixedQty: l.fixedQty, stockLocked: l.stockLocked }) ?? 0;
            return (
              <tr key={l.id} className={cn(!l.active && 'bg-slate-50/70 text-slate-600')}>
                <td className="px-3 py-2 align-top">
                  <MarketplaceBadge marketplace={l.marketplace} />
                </td>
                <td className="px-3 py-2 align-top">
                  {l.title}
                  {gone && (
                    <Badge tone="gray" className="ml-2">
                      {t('No longer on the marketplace')}
                    </Badge>
                  )}
                  {l.soldOut && !l.active && (
                    <Badge tone="amber" className="ml-2">
                      {t('Sold out there: back on sale once stock is sent')}
                    </Badge>
                  )}
                  {offSale && (
                    <Badge tone="gray" className="ml-2">
                      {l.listingStatus ? t('Not on sale: {status}', { status: l.listingStatus.toLowerCase() }) : t('Not on sale')}
                    </Badge>
                  )}
                  {l.stockLocked && (
                    <Badge tone="blue" className="ml-2">
                      {t('Bundle')}
                    </Badge>
                  )}
                </td>
                <td className={cn('px-3 py-2 text-right align-top font-semibold tabular-nums', l.active && want !== null && qty !== null && qty !== want && 'text-amber-700')}>
                  {l.active ? (qty ?? '?') : <span title={t('The offer is not on sale, so its stock figure does not count')}>0</span>}
                </td>
                <td className="px-3 py-2 align-top">
                  {gone ? (
                    '—'
                  ) : l.stockLocked ? (
                    <span className="text-xs">{t('Nothing is sent: the marketplace counts a bundle from its components')}</span>
                  ) : offSale ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs">{t('Nothing is sent while it is off sale')}</span>
                      {sellable > 0 && isLive(l.accountId) && (
                        <ActionForm action={activateListingAction.bind(null, l.id)} showOk>
                          <SubmitButton size="sm" variant="secondary" pendingText={t('Activating…')}>
                            {t('Activate with {n}', { n: sellable })}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  ) : (
                    <ActionForm action={setListingStockAction.bind(null, l.id)} className="flex flex-wrap items-center gap-1.5 [&>p]:mt-0 [&>p]:w-full [&>p]:text-xs" showOk={false}>
                      <Select name="mode" defaultValue={l.stockMode} className="h-8 w-36 text-xs" aria-label={t('What is sent to this listing')}>
                        <option value="master">{t('Master stock ({n})', { n: Math.max(0, stock) })}</option>
                        <option value="fixed">{t('Fixed quantity')}</option>
                        <option value="off">{t('Nothing (manage there)')}</option>
                      </Select>
                      <Input name="qty" inputMode="numeric" defaultValue={l.fixedQty ?? ''} placeholder={t('qty')} aria-label={t('Fixed quantity')} className="h-8 w-16 text-center text-xs" />
                      <SubmitButton size="sm" variant="secondary" pendingText="…">
                        {t('Save')}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-xs text-slate-500">
                  {l.lastPushError ? (
                    <span className="text-red-700">
                      {t('Not sent:')} {l.lastPushError}
                    </span>
                  ) : l.lastPushedAt ? (
                    <>
                      {t('sent {n}', { n: l.lastPushedQty ?? 0 })} · {formatDate(l.lastPushedAt, true, t.locale)}
                    </>
                  ) : l.lastSeenAt ? (
                    <>{t('read {date}', { date: formatDate(l.lastSeenAt, true, t.locale) })}</>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  {l.marketplace !== 'shopify' && (
                    <ActionForm action={unlinkListingAction.bind(null, l.id)} showOk={false}>
                      <SubmitButton size="sm" variant="ghost" pendingText="…">
                        {t('Unlink')}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProductRow({
  product: p,
  listings,
  cells,
  perf: f,
  publishHref,
  isLive,
  colSpan,
  t,
}: {
  product: Product;
  listings: ListingRow[];
  /** One per marketplace column, in column order. */
  cells: { platform: string; cell: MarketplaceCell }[];
  perf: ProductPerformance;
  /** Where an offer for this marketplace is created, when there is such a page. */
  publishHref: Record<string, string | undefined>;
  isLive: (accountId: string) => boolean;
  colSpan: number;
  t: T;
}) {
  return (
    <ExpandableRow colSpan={colSpan} label={t('listings')} stack dense className="align-middle" details={<ListingDetails listings={listings} stock={p.stock} isLive={isLive} t={t} />}>
      <td className="py-1.5 pr-3 pl-2 md:w-full md:max-w-0 max-md:order-1 max-md:px-0 max-md:pr-12">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProductPhoto product={p} />
          <div className="min-w-0">
            <p className="truncate text-[13px] leading-tight font-medium text-ink max-md:line-clamp-2 max-md:whitespace-normal" title={p.name}>
              {p.name}
            </p>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500">
              {hasRealSku(p.sku) ? <span className="font-mono">{p.sku}</span> : <span className="text-amber-700">{t('No SKU')}</span>}
              {p.ean && <span className="ml-2 font-mono">{p.ean}</span>}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap max-md:order-3 max-md:px-0 max-md:py-1">
        <div className="flex items-center gap-1.5" title={t('{level} performance', { level: t(LEVEL_LABEL[f.level]) })}>
          <Gauge value={f.percentile} tone={f.level} className="h-5 w-9" label={t('{level} performance', { level: t(LEVEL_LABEL[f.level]) })} />
          <span className={cn(num, 'text-ink')}>{f.units}</span>
          <span className="text-[11px] text-slate-500 md:hidden">{t('sold')}</span>
          <span className={cn('text-[11px]', LEVEL_TONE[f.level])}>{t(LEVEL_LABEL[f.level])}</span>
        </div>
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap max-md:order-2 max-md:px-0 max-md:py-2">
        <ActionForm action={adjustStockAction.bind(null, p.id)} className="flex items-center gap-1.5 max-md:flex-wrap md:grid md:grid-cols-[auto_auto] md:justify-start [&>p]:mt-0 [&>p]:text-xs [&>p]:whitespace-normal max-md:[&>p]:w-full md:[&>p]:col-span-2" showOk={false}>
          <input type="hidden" name="mode" value="set" />
          <span className="text-xs text-slate-500 md:hidden">{t('Stock')}</span>
          <Input
            name="value"
            inputMode="numeric"
            aria-label={t('Stock of {name}', { name: p.name })}
            defaultValue={p.stock}
            key={p.stock}
            className={cn('h-8 w-16 px-1 text-center font-mono text-[13px] font-semibold tabular-nums', p.stock <= 0 && 'border-red-200 text-red-700', p.stock > 0 && p.stock < LOW_STOCK && 'text-amber-700')}
            required
          />
          <span title={t('Sets the stock and sends it to every marketplace')}>
            <SubmitButton size="sm" variant="secondary" pendingText="…">
              {t('Update')}
            </SubmitButton>
          </span>
        </ActionForm>
      </td>
      {cells.map(({ platform, cell }) => (
        <td key={platform} className="px-2 py-1 text-center whitespace-nowrap max-md:hidden">
          <CellView cell={cell} platform={platform} productId={p.id} publishHref={publishHref[platform]} t={t} />
        </td>
      ))}
      <td className="md:hidden max-md:order-4 max-md:px-0 max-md:pt-1">
        <div className="flex flex-wrap gap-1.5">
          {cells.map(({ platform, cell }) => (
            <span key={platform} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-black/[0.06] bg-white py-0.5 pr-2 pl-2.5 text-xs text-slate-600">
              {MARKETPLACE_LABELS[platform] ?? platform}
              <CellView cell={cell} platform={platform} productId={p.id} publishHref={publishHref[platform]} inline t={t} />
            </span>
          ))}
        </div>
      </td>
    </ExpandableRow>
  );
}
