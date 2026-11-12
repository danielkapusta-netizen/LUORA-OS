import { RefreshCw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { MarketplaceBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, buttonClass, Card, EmptyState, Input, PageHeader, Select } from '@/components/ui';
import { RangeControl } from '@/components/analytics/period-control';
import { resolveDayWindow, windowLabel } from '@/lib/analytics/window';
import { cellFor, FILTERS, groupByBrand, productFlags, SORTS, sortProducts, type InventoryFilter, type InventorySort } from '@/lib/inventory-view';
import { cn, MARKETPLACE_LABELS, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { listProductsWithListings, matchingGroups, pendingPushCounts, recentStockLog, stockSyncStatus } from '@/server/services/inventory';
import { SUGGESTION_THRESHOLD } from '@/server/services/matching';
import { emptyPerformance, productStats, type ProductPerformance } from '@/server/services/product-stats';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { latestSyncRun } from '@/server/services/stock-sync';
import { adoptStockAction, confirmClearSuggestionsAction, goLiveAction, importListingsAction, linkGroupAction, syncAllStockAction } from './actions';
import { BrandGroup } from './brand-group';
import { ProductRow, type ListingRow } from './product-table';
import { SyncPanel } from './sync-panel';
import { msg } from '@/lib/i18n/msg';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Inventory') };
}

/** Rows per page in the flat lists; the brand view shows every product, folded by brand. */
const PAGE_SIZE = 50;
const PERIODS = [7, 30, 90] as const;
const SORT_LABEL: Record<InventorySort, string> = { brand: msg('Brand'), sales: msg('Best selling'), name: msg('Name'), stock: msg('Lowest stock'), new: msg('Newest') };
const FILTER_LABEL: Record<InventoryFilter, string> = { all: msg('All'), out: msg('Out of stock'), low: msg('Low stock'), differs: msg('Differs somewhere'), off: msg('Off sale with stock') };
const PLATFORMS = ['shopify', 'allegro', 'empik', 'hebe', 'vonhalsky'] as const;

function hrefWith(params: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const merged = { ...params, ...change };
  const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])));
  return `/inventory${qs.size ? `?${qs}` : ''}`;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; filter?: string; days?: string; from?: string; to?: string; page?: string }>;
}) {
  const t = await getT();
  const viewer = await requireUser();
  const admin = viewer.role === 'admin';
  const params = await searchParams;
  const win = resolveDayWindow(params, PERIODS, 30);
  const winLabel = windowLabel(win, t);
  const periodPresets = [...PERIODS.map((d) => ({ value: String(d), label: t.plural(d, '{n} day', '{n} days') })), { value: 'lastweek', label: t('Last week') }];
  const sort: InventorySort = (SORTS as readonly string[]).includes(params.sort ?? '') ? (params.sort as InventorySort) : 'brand';
  const filter: InventoryFilter = (FILTERS as readonly string[]).includes(params.filter ?? '') ? (params.filter as InventoryFilter) : 'all';
  const [{ products, listings }, allAccounts, matching, log, stats, pending, syncStatus, run] = await Promise.all([
    listProductsWithListings(),
    listMarketplaceAccounts(),
    matchingGroups(),
    recentStockLog(30),
    productStats(win),
    pendingPushCounts(),
    stockSyncStatus(),
    latestSyncRun(),
  ]);
  const accounts = allAccounts.filter((a) => a.enabled);
  const sending = new Set(accounts.filter((a) => a.stockSyncEnabled && !a.stockDryRun).map((a) => a.id));
  const isLive = (accountId: string) => sending.has(accountId);
  const platforms = PLATFORMS.filter((m) => accounts.some((a) => a.type === m));
  const perf = (id: string): ProductPerformance => stats.byProduct.get(id) ?? emptyPerformance();
  const byProduct = new Map<string, ListingRow[]>();
  for (const l of listings) byProduct.set(l.productId!, [...(byProduct.get(l.productId!) ?? []), l]);
  const productName = new Map(products.map((p) => [p.id, p.name]));

  // Where an offer is created for a marketplace the product is not on yet (admins only, like those pages).
  const publishHref: Record<string, string | undefined> = {};
  if (admin) {
    for (const a of accounts) {
      if (a.type === 'allegro' || a.type === 'empik' || a.type === 'hebe') publishHref[a.type] ??= `/inventory/publish/${a.id}`;
      if (a.type === 'vonhalsky') publishHref.vonhalsky = '/inventory/vonhalsky';
    }
  }

  // How every product stands on every marketplace.
  const view = products.map((p) => {
    const own = byProduct.get(p.id) ?? [];
    const cells = platforms.map((platform) => ({ platform, cell: cellFor(own.filter((l) => l.marketplace === platform), p.stock, isLive) }));
    return { product: p, own, cells, flags: productFlags(cells.map((c) => c.cell), p.stock) };
  });

  // List
  const needle = params.q?.toLowerCase().trim();
  const searched = needle ? view.filter((v) => [v.product.sku, v.product.name, v.product.ean ?? '', v.product.brand ?? '', ...v.own.map((l) => l.title)].some((x) => x.toLowerCase().includes(needle))) : view;
  const counts: Record<InventoryFilter, number> = {
    all: searched.length,
    out: searched.filter((v) => v.flags.out).length,
    low: searched.filter((v) => v.flags.low).length,
    differs: searched.filter((v) => v.flags.differs).length,
    off: searched.filter((v) => v.flags.off).length,
  };
  const filtered = filter === 'all' ? searched : searched.filter((v) => v.flags[filter]);
  const rowOf = new Map(filtered.map((v) => [v.product.id, v]));
  const grouped = sort === 'brand' ? groupByBrand(filtered.map((v) => v.product)) : null;
  const sorted = sortProducts(filtered.map((v) => v.product), sort, (id) => perf(id).units);
  const pages = grouped ? 1 : Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const colSpan = 4 + platforms.length + 1;

  const clear = matching.filter((m) => m.clear && !m.eanDiffers).length;
  const offerCount = matching.reduce((n, g) => n + g.listings.length, 0);
  // Accounts stock sync is switched on for, but nothing is sent to yet: someone has to look and decide.
  const review = accounts
    .filter((a) => a.stockSyncEnabled && a.stockDryRun)
    .map((a) => ({
      account: a,
      differing: view.filter((v) => v.cells.some((c) => c.platform === a.type && c.cell.accountId === a.id && c.cell.kind === 'differs' && !c.cell.untracked)).length,
    }));
  const running = run?.status === 'running';
  const settling = view.some((v) => v.cells.some((c) => c.cell.kind === 'differs' && !c.cell.held));

  const row = (id: string) => {
    const v = rowOf.get(id)!;
    return <ProductRow key={id} product={v.product} listings={v.own} cells={v.cells} perf={perf(id)} publishHref={publishHref} isLive={isLive} colSpan={colSpan} t={t} />;
  };

  return (
    <>
      <AutoRefresh active={running || settling} seconds={running ? 5 : 15} />
      <PageHeader
        title={t('Inventory')}
        description={t('One stock number per product, sent to every marketplace. Products and photos come from Shopify; Allegro, Empik and HEBE offers are matched by EAN.')}
        actions={
          <>
            <details className="relative">
              <summary className={cn(buttonClass('secondary'), 'list-none [&::-webkit-details-marker]:hidden')}>{t('More')}</summary>
              <div className="absolute right-0 z-20 mt-2 flex w-64 flex-col gap-1 rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_16px_40px_-16px_rgba(28,27,25,0.35)] max-md:left-0 max-md:right-auto">
                <ActionForm action={importListingsAction} className="[&>p]:px-3 [&>p]:text-xs">
                  <SubmitButton variant="ghost" className="w-full justify-start" pendingText={t('Importing…')}>
                    {t('Import listings')}
                  </SubmitButton>
                </ActionForm>
                {admin &&
                  accounts
                    .filter((a) => a.type === 'allegro' || a.type === 'empik' || a.type === 'hebe')
                    .map((a) => (
                      <Link key={a.id} className={cn(buttonClass('ghost'), 'justify-start')} href={`/inventory/publish/${a.id}`}>
                        {t('Publish to {platform}', { platform: MARKETPLACE_LABELS[a.type] })}
                      </Link>
                    ))}
                <Link className={cn(buttonClass('ghost'), 'justify-start')} href="/inventory/vonhalsky">
                  {t('Von Halsky offers')}
                </Link>
              </div>
            </details>
            <ActionForm action={syncAllStockAction} showOk={false}>
              <span title={t('Reads every marketplace, sends the stock in Luora wherever a marketplace shows another number, then checks that it arrived.')}>
                <SubmitButton pendingText={t('Starting…')}>
                  <RefreshCw className="size-4" aria-hidden /> {t('Update all stock')}
                </SubmitButton>
              </span>
            </ActionForm>
          </>
        }
      />

      <SyncPanel accounts={accounts} status={syncStatus} pending={pending} run={run} t={t} />

      {review.map(({ account, differing }) => (
        <section key={account.id} className="mb-5 rounded-3xl border border-butter/60 bg-butter-tint px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-butter-ink">
              <p className="font-semibold">{t('Nothing is sent to {account} yet', { account: account.name })}</p>
              <p className="mt-0.5">
                {differing
                  ? t.plural(differing, '{n} product shows another stock there than in Luora.', '{n} products show another stock there than in Luora.')
                  : t('Every product shows the same stock there as in Luora.')}{' '}
                {account.type === 'shopify' && differing > 0
                  ? t('Take its numbers where it is right, correct the rest here, then start sending: from then on the stock in Luora replaces the numbers there.')
                  : t('Check the numbers, then start sending: from then on the stock in Luora replaces the numbers there.')}
              </p>
            </div>
            {admin ? (
              <div className="flex flex-wrap items-start gap-2">
                {account.type === 'shopify' && differing > 0 && (
                  <ActionForm action={adoptStockAction.bind(null, account.id, null)}>
                    <SubmitButton
                      variant="secondary"
                      pendingText={t('Reading {account}…', { account: account.name })}
                      confirm={t.plural(differing, 'Set the stock of {n} product in Luora to the number {account} shows?', 'Set the stock of {n} products in Luora to the numbers {account} shows?', { account: account.name })}
                    >
                      {t('Take {account}’s numbers ({n})', { account: account.name, n: differing })}
                    </SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={goLiveAction.bind(null, account.id)}>
                  <SubmitButton
                    pendingText={t('Starting…')}
                    confirm={
                      differing
                        ? t.plural(differing, 'For {n} product the stock in Luora will replace the number in {account}. Start sending?', 'For {n} products the stock in Luora will replace the numbers in {account}. Start sending?', { account: account.name })
                        : t('Start sending stock to {account}?', { account: account.name })
                    }
                  >
                    {t('Start sending to {account}', { account: account.name })}
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <p className="text-xs text-butter-ink">{t('An admin switches sending on.')}</p>
            )}
          </div>
        </section>
      ))}

      {matching.length > 0 && (
        <details className="group mb-5 rounded-2xl border border-amber-200 bg-amber-50/40" open={matching.length <= 10}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3">
            <span className="text-sm">
              <span className="font-semibold">
                {t('Needs matching ({products}, {offers})', { products: t.plural(matching.length, '{n} product', '{n} products'), offers: t.plural(offerCount, '{n} offer', '{n} offers') })}
              </span>
              <span className="ml-2 text-slate-500">{t('Offers sharing an EAN are one product. Their Shopify product has no barcode, so pick it once. Stock isn’t synced until linked.')}</span>
            </span>
            <span className="text-xs font-medium text-brand-700 group-open:hidden">{t('Show')}</span>
          </summary>
          <div className="border-t border-amber-200 bg-white">
            {clear > 0 && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-2.5 text-sm text-slate-600">
                <span>{t.plural(clear, '{n} product has a clear match by name.', '{n} products have a clear match by name.')}</span>
                <ActionForm action={confirmClearSuggestionsAction}>
                  <SubmitButton size="sm" variant="secondary" pendingText={t('Linking…')}>
                    {t.plural(clear, 'Link {n} clear match', 'Link {n} clear matches')}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {matching.map((g) => {
                const top = g.suggestions[0] && g.suggestions[0].score >= SUGGESTION_THRESHOLD ? g.suggestions[0] : null;
                const suggestedIds = new Set(g.suggestions.map((s) => s.productId));
                return (
                  <li key={g.key} className="grid grid-cols-1 items-center gap-2 px-5 py-3 lg:grid-cols-[1fr_minmax(0,28rem)]">
                    <div className="min-w-0 space-y-1.5">
                      <p className="text-xs text-slate-500">{g.ean ? `EAN ${g.ean}` : t('no EAN')}</p>
                      {g.listings.map((l) => (
                        <div key={l.id} className="flex items-start gap-2 text-sm">
                          <MarketplaceBadge marketplace={l.marketplace} />
                          <span className="min-w-0 flex-1">{l.title}</span>
                          <span className="shrink-0 text-xs text-slate-500">{t('stock {n}', { n: l.lastSeenQty ?? '?' })}</span>
                        </div>
                      ))}
                      <p className="text-xs">
                        {top ? (
                          <span className={g.clear ? 'text-emerald-700' : 'text-amber-700'}>
                            {t('{kind} ({pct}%) – check it', { kind: g.clear ? t('Clear match by name') : t('Possible match'), pct: Math.round(top.score * 100) })}
                          </span>
                        ) : (
                          <span className="text-slate-500">{t('No close match: choose the Shopify product')}</span>
                        )}
                        {g.eanDiffers && <span className="ml-2 text-amber-700">{t('Shopify has another barcode for it')}</span>}
                      </p>
                    </div>
                    <ActionForm action={linkGroupAction.bind(null, g.listings.map((l) => l.id))} className="flex gap-1.5" showOk={false}>
                      <Select name="productId" className="h-9 min-w-0 flex-1 text-xs" defaultValue={top?.productId ?? ''}>
                        <option value="">{t('Choose Shopify product…')}</option>
                        {g.suggestions.length > 0 && (
                          <optgroup label={t('Closest by name')}>
                            {g.suggestions.map((s) => (
                              <option key={s.productId} value={s.productId}>
                                {productName.get(s.productId)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label={t('All products')}>
                          {products
                            .filter((p) => !suggestedIds.has(p.id))
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </optgroup>
                      </Select>
                      <SubmitButton size="sm" pendingText="…">
                        {g.listings.length > 1 ? t('Link {n}', { n: g.listings.length }) : t('Link')}
                      </SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      )}

      <Card className="mb-5 overflow-clip">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-5 py-3">
          <form action="/inventory" className="mr-auto max-md:w-full">
            {sort !== 'brand' && <input type="hidden" name="sort" value={sort} />}
            {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
            {win.custom ? (
              <>
                <input type="hidden" name="from" value={win.custom.from} />
                <input type="hidden" name="to" value={win.custom.to} />
              </>
            ) : (
              win.key !== '30' && <input type="hidden" name="days" value={win.key} />
            )}
            <Input name="q" defaultValue={params.q} placeholder={t('Search name, brand, SKU, EAN')} aria-label={t('Search name, brand, SKU, EAN')} className="h-8 w-64 max-md:w-full" type="search" enterKeyHint="search" />
          </form>
          <RangeControl path="/inventory" current={params} presets={periodPresets} active={win.key} param="days" custom={win.custom} reset={['page']} label={t('Sales period')} />
          <div className="flex max-w-full overflow-x-auto rounded-full border border-black/[0.08] p-0.5 text-xs max-md:scrollbar-none" role="group" aria-label={t('Order')}>
            {SORTS.map((s) => (
              <Link
                key={s}
                href={hrefWith(params, { sort: s === 'brand' ? undefined : s, page: undefined })}
                aria-current={s === sort ? 'true' : undefined}
                className={cn('shrink-0 rounded-full px-3 py-1 whitespace-nowrap max-md:px-4 max-md:py-2 max-md:text-sm', s === sort ? 'bg-ink text-white' : 'text-slate-600 hover:bg-black/[0.04]')}
              >
                {t(SORT_LABEL[s])}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-black/[0.06] px-5 py-2.5 text-xs">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={hrefWith(params, { filter: f === 'all' ? undefined : f, page: undefined })}
              aria-current={f === filter ? 'true' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 whitespace-nowrap max-md:px-3 max-md:py-2',
                f === filter ? 'border-ink bg-ink text-white' : 'border-black/[0.08] text-slate-600 hover:border-black/20',
                f !== filter && counts[f] === 0 && 'opacity-60',
              )}
            >
              {t(FILTER_LABEL[f])}
              <span className={cn('font-mono tabular-nums', f === filter ? 'text-white/80' : 'text-slate-500')}>{counts[f]}</span>
            </Link>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={products.length ? t('No product matches') : t('No products yet')}>
            {products.length ? null : t('Press “Update all stock” to load your products and photos from Shopify.')}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="min-w-full max-md:block">
              <thead className="max-md:hidden">
                <tr className="text-left text-[11px] text-slate-500 [&>th]:bg-white [&>th]:font-medium [&>th]:shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)] lg:[&>th]:sticky lg:[&>th]:top-14 lg:[&>th]:z-10 2xl:[&>th]:top-0">
                  <th className="w-10" />
                  <th className="py-2 pr-3 pl-2 md:min-w-44">{t('Product')}</th>
                  <th className="px-3 py-2 whitespace-nowrap">{t('Sold · {period}', { period: winLabel })}</th>
                  <th className="px-3 py-2">{t('Stock')}</th>
                  {platforms.map((m) => (
                    <th key={m} className="px-2 py-2 text-center whitespace-nowrap">
                      {MARKETPLACE_LABELS[m]}
                    </th>
                  ))}
                  <th className="hidden" />
                </tr>
              </thead>
              {grouped ? (
                grouped.map((g) => {
                  const units = g.products.reduce((sum, p) => sum + Math.max(0, p.stock), 0);
                  const out = g.products.filter((p) => p.stock <= 0).length;
                  return (
                    <BrandGroup
                      key={g.key || 'none'}
                      label={g.label ?? t('No brand')}
                      colSpan={colSpan}
                      summary={
                        <>
                          {t.plural(g.products.length, '{n} product', '{n} products')} · {t('{n} in stock', { n: units.toLocaleString('pl-PL') })}
                          {out > 0 && <span className="text-red-700"> · {t('{n} out of stock', { n: out })}</span>}
                        </>
                      }
                    >
                      {g.products.map((p) => row(p.id))}
                    </BrandGroup>
                  );
                })
              ) : (
                <tbody className="max-md:block [&>tr+tr]:border-t [&>tr+tr]:border-black/[0.04]">{shown.map((p) => row(p.id))}</tbody>
              )}
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-black/[0.06] px-5 py-3 text-sm text-slate-500">
            {page > 1 ? (
              <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page - 1) })}>
                {t('Previous')}
              </Link>
            ) : (
              <span className={cn(buttonClass('secondary', 'sm'), 'pointer-events-none opacity-40')}>{t('Previous')}</span>
            )}
            <span>{t('Page {page} of {pages}', { page, pages })}</span>
            {page < pages ? (
              <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page + 1) })}>
                {t('Next')}
              </Link>
            ) : (
              <span className={cn(buttonClass('secondary', 'sm'), 'pointer-events-none opacity-40')}>{t('Next')}</span>
            )}
          </div>
        )}
      </Card>

      <details className="rounded-2xl border border-black/[0.06] bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">{t('Recent stock pushes')}</summary>
        {log.length === 0 ? (
          <EmptyState title={t('Nothing sent yet')} />
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {log.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-5 py-2">
                <span className="min-w-0 truncate">
                  {e.accountName}: {e.title ?? 'listing'} → <strong>{e.quantity}</strong>
                  {e.error && <span className="ml-1 text-red-700">({e.error})</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {e.dryRun ? <Badge tone="amber">{t('dry run')}</Badge> : e.ok ? <Badge tone="green">{t('sent')}</Badge> : <Badge tone="red">{t('failed')}</Badge>}
                  <span className="text-xs text-slate-500">{timeAgo(e.createdAt, t)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
