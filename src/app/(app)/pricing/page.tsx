import { Boxes, RefreshCw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Alert, Badge, buttonClass, Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { can } from '@/lib/permissions';
import { formatPrice, priceChangePercent } from '@/lib/price';
import { hasRealSku } from '@/lib/sku';
import { cn, timeAgo } from '@/lib/utils';
import { requireCapability } from '@/server/auth';
import type { Product } from '@/server/db/schema';
import { isPricePlatform, MAX_PRICES_PER_PUSH, PRICE_PLATFORM_LABEL, PRICE_PLATFORMS, pricingView, type PricedListing, type PricePlatform, type PricingRow } from '@/server/services/pricing';
import { pushPricesAction, refreshPricesAction } from './actions';
import { PriceCell } from './price-cell';

export const metadata: Metadata = { title: 'Pricing' };

const SORTS = { name: 'Name', high: 'Highest price', low: 'Lowest price', changed: 'Recently changed' } as const;
type Sort = keyof typeof SORTS;

type Params = { platform?: string; q?: string; sort?: string; all?: string; page?: string };

function hrefWith(params: Params, change: Partial<Record<keyof Params, string | undefined>>) {
  const merged = { ...params, ...change };
  const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1]) && !(e[0] === 'platform' && e[1] === 'shopify')));
  return `/pricing${qs.size ? `?${qs}` : ''}`;
}

function ProductPhoto({ product }: { product: Pick<Product, 'imageUrl'> }) {
  return product.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
    <img src={product.imageUrl} alt="" className="size-12 shrink-0 rounded-xl border border-slate-100 bg-white object-contain" />
  ) : (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-300">
      <Boxes className="size-5" />
    </span>
  );
}

const firstPrice = (row: PricingRow) => Number(row.listings.find((l) => l.price)?.price ?? NaN);
const lastChange = (row: PricingRow) => Math.max(0, ...row.listings.map((l) => l.priceUpdatedAt?.getTime() ?? 0));

/** Highest first for the number sorts, with products that have no price last whichever way it goes. */
function byNumber(value: (row: PricingRow) => number, direction: 1 | -1) {
  return (a: PricingRow, b: PricingRow) => {
    const x = value(a);
    const y = value(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
    return (x - y) * direction;
  };
}

function ListingStatus({ listing, platform }: { listing: PricedListing; platform: PricePlatform }) {
  return (
    <p className="mt-1 text-xs text-slate-500">
      {listing.priceError ? (
        <span className="text-red-700">Not sent: {listing.priceError}</span>
      ) : (
        <>
          On {PRICE_PLATFORM_LABEL[platform]}: <span className="font-medium text-slate-700 tabular-nums">{formatPrice(listing.price, listing.currency)}</span>
          {listing.priceUpdatedAt && <> · changed {timeAgo(listing.priceUpdatedAt)}</>}
        </>
      )}
      {!listing.active && (
        <Badge tone="gray" className="ml-2">
          {listing.listingStatus ? `Not on sale: ${listing.listingStatus.toLowerCase()}` : 'Not on sale'}
        </Badge>
      )}
      {platform === 'vonhalsky' && listing.priceManual && (
        <Badge tone="blue" className="ml-2">
          <span title="Set here, so “Update prices of Luora offers” no longer follows Shopify for this offer">Set by hand</span>
        </Badge>
      )}
    </p>
  );
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireCapability('pricing');
  const params = await searchParams;
  const platform: PricePlatform = isPricePlatform(params.platform) ? params.platform : 'shopify';
  const label = PRICE_PLATFORM_LABEL[platform];
  const sort: Sort = params.sort && params.sort in SORTS ? (params.sort as Sort) : 'name';
  const showAll = params.all === '1';
  const view = await pricingView(platform);

  const needle = params.q?.toLowerCase().trim();
  const matching = needle
    ? view.rows.filter((r) => [r.product.sku, r.product.name, r.product.ean ?? '', ...r.listings.map((l) => l.title)].some((v) => v.toLowerCase().includes(needle)))
    : view.rows;
  const listed = matching.filter((r) => r.listings.length > 0);
  const notListed = matching.length - listed.length;
  const visible = showAll ? matching : listed;
  const sorted = [...visible].sort(
    sort === 'high'
      ? byNumber(firstPrice, -1)
      : sort === 'low'
        ? byNumber(firstPrice, 1)
        : sort === 'changed'
          ? byNumber(lastChange, -1)
          : (a, b) => a.product.name.localeCompare(b.product.name, 'pl'),
  );
  const pages = Math.max(1, Math.ceil(sorted.length / MAX_PRICES_PER_PUSH));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = sorted.slice((page - 1) * MAX_PRICES_PER_PUSH, page * MAX_PRICES_PER_PUSH);

  return (
    <>
      <PageHeader
        title="Pricing"
        description="Every product's selling price on each platform, gross and in złoty. Type a new price and press Update: it goes to the platform straight away."
        actions={
          view.accounts.length > 0 && (
            <ActionForm action={refreshPricesAction.bind(null, platform)} popup="Reading prices">
              <SubmitButton variant="secondary" pendingText="Starting…">
                <RefreshCw className="size-4" /> Read prices from {label}
              </SubmitButton>
            </ActionForm>
          )
        }
      />

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Platform">
        {PRICE_PLATFORMS.map((p) => (
          <Link
            key={p}
            href={hrefWith({ q: params.q }, { platform: p })}
            aria-current={p === platform ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium max-md:py-3',
              p === platform ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {PRICE_PLATFORM_LABEL[p]}
          </Link>
        ))}
      </nav>

      {view.accounts.length === 0 ? (
        <Card>
          <EmptyState title={`No ${label} account is connected`}>
            {can(viewer.role, 'settings') ? (
              <>
                Add and connect one in{' '}
                <Link className="text-brand-700 underline" href="/settings/integrations">
                  Settings → Integrations
                </Link>
                .
              </>
            ) : (
              'Ask an admin to connect it.'
            )}
          </EmptyState>
        </Card>
      ) : (
        <>
          {view.unlinked > 0 && (
            <div className="mb-4">
              <Alert tone="amber">
                {view.unlinked} {label} offer{view.unlinked === 1 ? ' is' : 's are'} not linked to a Shopify product, so {view.unlinked === 1 ? 'its' : 'their'} price can’t be changed here.{' '}
                <Link className="font-medium underline" href="/inventory">
                  Link them in Inventory
                </Link>
                .
              </Alert>
            </div>
          )}

          <Card className="mb-5 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
              <form action="/pricing" className="mr-auto max-md:w-full">
                {platform !== 'shopify' && <input type="hidden" name="platform" value={platform} />}
                {sort !== 'name' && <input type="hidden" name="sort" value={sort} />}
                {showAll && <input type="hidden" name="all" value="1" />}
                <Input name="q" defaultValue={params.q} placeholder="Search name, SKU, EAN" className="h-8 w-60 max-md:w-full" type="search" enterKeyHint="search" />
              </form>
              <div className="flex max-w-full overflow-x-auto rounded-full border border-slate-200 p-0.5 text-xs max-md:scrollbar-none">
                {(Object.keys(SORTS) as Sort[]).map((s) => (
                  <Link
                    key={s}
                    href={hrefWith(params, { sort: s === 'name' ? undefined : s, page: undefined })}
                    className={cn('shrink-0 rounded-full px-3 py-1 whitespace-nowrap max-md:px-4 max-md:py-2 max-md:text-sm', s === sort ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
                  >
                    {SORTS[s]}
                  </Link>
                ))}
              </div>
            </div>

            {shown.length === 0 ? (
              <EmptyState title={view.rows.length ? (listed.length === 0 && notListed > 0 ? `Nothing is listed on ${label} yet` : 'No product matches the search') : 'No products yet'}>
                {view.rows.length ? null : 'Open Inventory and press “Import listings” to load your products from Shopify.'}
              </EmptyState>
            ) : (
              <ActionForm action={pushPricesAction.bind(null, platform)} popup="Price update" showOk={false}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5 text-sm text-slate-600">
                  <span>
                    {listed.length} product{listed.length === 1 ? '' : 's'} on {label}
                    {notListed > 0 && (
                      <>
                        {' '}
                        ·{' '}
                        <Link className="text-brand-700 hover:underline" href={hrefWith(params, { all: showAll ? undefined : '1', page: undefined })}>
                          {showAll ? 'hide' : 'show'} {notListed} not listed here
                        </Link>
                      </>
                    )}
                  </span>
                  <SubmitButton size="sm" pendingText="Sending…">
                    Update every changed price on this page
                  </SubmitButton>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm max-md:block">
                    <thead className="text-left text-xs text-slate-500 max-md:hidden">
                      <tr>
                        <th className="px-5 py-2 font-medium">Product</th>
                        <th className="px-4 py-2 font-medium">Price on {label} (gross)</th>
                        {platform !== 'shopify' && <th className="px-4 py-2 font-medium">Shopify price</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 max-md:block">
                      {shown.map(({ product, listings, shopifyPrice }) => (
                        <tr key={product.id} className="align-top max-md:flex max-md:flex-col max-md:px-4 max-md:py-3">
                          <td className="px-5 py-3 max-md:px-0 max-md:py-1">
                            <div className="flex min-w-64 items-center gap-3 max-md:min-w-0">
                              <ProductPhoto product={product} />
                              <div className="min-w-0">
                                <p className="font-medium leading-snug">{product.name}</p>
                                <p className="mt-0.5 text-xs">
                                  {hasRealSku(product.sku) ? <span className="font-mono text-slate-500">{product.sku}</span> : <Badge tone="amber">No SKU</Badge>}
                                  {product.ean && <span className="ml-2 font-mono text-slate-400">{product.ean}</span>}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 max-md:px-0 max-md:py-1">
                            {listings.length === 0 ? (
                              <span className="text-xs text-slate-400">Not listed on {label}</span>
                            ) : (
                              <div className="space-y-3">
                                {listings.map((l) => (
                                  <div key={l.id}>
                                    {(listings.length > 1 || view.accounts.length > 1 || l.title !== product.name) && (
                                      <p className="mb-1 max-w-sm truncate text-xs text-slate-500" title={l.title}>
                                        {view.accounts.length > 1 && <span className="font-medium">{l.accountName} · </span>}
                                        {l.title}
                                      </p>
                                    )}
                                    <PriceCell key={`${l.id}:${l.price}`} listingId={l.id} current={l.price} label={`Price of ${product.name} on ${label}`} />
                                    <ListingStatus listing={l} platform={platform} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          {platform !== 'shopify' && (
                            <td className="px-4 py-3 whitespace-nowrap max-md:px-0 max-md:py-1 max-md:text-sm max-md:text-slate-500">
                              <span className="md:hidden">Shopify: </span>
                              <span className="font-medium tabular-nums">{formatPrice(shopifyPrice)}</span>
                              {listings[0]?.price && shopifyPrice && <ShopifyGap shopify={shopifyPrice} here={listings[0].price} />}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ActionForm>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
              {page > 1 ? (
                <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page - 1) })}>
                  Previous
                </Link>
              ) : (
                <span className={cn(buttonClass('secondary', 'sm'), 'pointer-events-none opacity-40')}>Previous</span>
              )}
              <span>
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page + 1) })}>
                  Next
                </Link>
              ) : (
                <span className={cn(buttonClass('secondary', 'sm'), 'pointer-events-none opacity-40')}>Next</span>
              )}
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/** How much dearer (or cheaper) this platform is than Shopify. */
function ShopifyGap({ shopify, here }: { shopify: string; here: string }) {
  const gap = priceChangePercent(shopify, here);
  if (gap === null || Math.abs(gap) < 0.05) return null;
  return <span className="ml-2 text-xs text-slate-500 tabular-nums">here {gap > 0 ? '+' : ''}{gap.toFixed(1)}%</span>;
}
