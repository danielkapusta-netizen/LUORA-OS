import { Boxes, PackageX, RefreshCw, ShoppingBag, TrendingUp, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { MarketplaceBadge } from '@/components/badges';
import { ExpandableRow } from '@/components/expandable-row';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Gauge } from '@/components/gauge';
import { Badge, buttonClass, Card, EmptyState, Input, PageHeader, Select } from '@/components/ui';
import { hasRealSku } from '@/lib/sku';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { Product } from '@/server/db/schema';
import { listProductsWithListings, marketplaceQuantity, matchingSuggestions, recentStockLog } from '@/server/services/inventory';
import { SUGGESTION_THRESHOLD } from '@/server/services/matching';
import { emptyPerformance, productStats, type PerformanceLevel, type ProductPerformance } from '@/server/services/product-stats';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { adjustStockAction, confirmClearSuggestionsAction, importListingsAction, linkListingAction, syncAllStockAction, unlinkListingAction } from './actions';

export const metadata: Metadata = { title: 'Inventory' };

type ListingRow = Awaited<ReturnType<typeof listProductsWithListings>>['listings'][number];

const PAGE_SIZE = 20;
const PERIODS = [7, 30, 90] as const;
const SORTS = { sales: 'Best selling', name: 'Name', stock: 'Lowest stock' } as const;
type Sort = keyof typeof SORTS;
const PLATFORMS = ['shopify', 'allegro', 'empik'] as const;
const PLATFORM_LABEL: Record<string, string> = { shopify: 'Shopify', allegro: 'Allegro', empik: 'Empik' };
const LEVEL_LABEL: Record<PerformanceLevel, string> = { excellent: 'Excellent', good: 'Good', low: 'Low', none: 'No sales' };
const LEVEL_TONE: Record<PerformanceLevel, string> = { excellent: 'text-emerald-600', good: 'text-emerald-600', low: 'text-amber-600', none: 'text-slate-400' };

const compact = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
const pln = (v: number) => `${v < 1000 ? Math.round(v) : compact.format(v)} zł`;

function hrefWith(params: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const merged = { ...params, ...change };
  const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])));
  return `/inventory${qs.size ? `?${qs}` : ''}`;
}

function ProductPhoto({ product, size = 'size-14' }: { product: Pick<Product, 'imageUrl'>; size?: string }) {
  return product.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
    <img src={product.imageUrl} alt="" className={cn(size, 'shrink-0 rounded-xl border border-slate-100 bg-white object-contain')} />
  ) : (
    <span className={cn(size, 'flex shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-300')}>
      <Boxes className="size-5" />
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500">{children}</p>;
}

/** Green / amber / grey dot per platform: same stock as here, different, or not listed. */
function PlatformDots({ listings, stock }: { listings: ListingRow[]; stock: number }) {
  return (
    <div className="mt-1.5 flex gap-2">
      {PLATFORMS.map((m) => {
        const own = listings.filter((l) => l.marketplace === m);
        const quantities = own.map(marketplaceQuantity);
        const state = own.length === 0 ? 'none' : own.some((l) => l.lastPushError) ? 'error' : quantities.some((q) => q !== Math.max(0, stock)) ? 'drift' : 'ok';
        const title = own.length === 0 ? `${PLATFORM_LABEL[m]}: not listed` : `${PLATFORM_LABEL[m]}: ${quantities.map((q) => q ?? '?').join(' / ')}`;
        return (
          <span key={m} title={title} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <span
              className={cn(
                'size-2 rounded-full',
                state === 'ok' && 'bg-emerald-500',
                state === 'drift' && 'bg-amber-400',
                state === 'error' && 'bg-red-500',
                state === 'none' && 'bg-slate-200',
              )}
            />
            {PLATFORM_LABEL[m]}
            {own.length > 0 && <span className="tabular-nums text-slate-700">{quantities.map((q) => q ?? '?').join('/')}</span>}
          </span>
        );
      })}
    </div>
  );
}

function ListingDetails({ listings, stock }: { listings: ListingRow[]; stock: number }) {
  if (listings.length === 0) return <p className="px-2 py-3 text-sm text-slate-500">Not linked to any platform listing.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Platform</th>
            <th className="px-3 py-2 font-medium">Name on the platform</th>
            <th className="px-3 py-2 text-right font-medium">Stock there</th>
            <th className="px-3 py-2 font-medium">Last sync</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {listings.map((l) => {
            const qty = marketplaceQuantity(l);
            return (
              <tr key={l.id}>
                <td className="px-3 py-2 align-top">
                  <MarketplaceBadge marketplace={l.marketplace} />
                </td>
                <td className="px-3 py-2 align-top">{l.title}</td>
                <td className={cn('px-3 py-2 text-right align-top font-semibold tabular-nums', qty !== null && qty !== Math.max(0, stock) && 'text-amber-700')}>
                  {qty ?? '?'}
                </td>
                <td className="px-3 py-2 align-top text-xs text-slate-500">
                  {l.lastPushError ? (
                    <span className="text-red-700">Not sent: {l.lastPushError}</span>
                  ) : l.lastPushedAt ? (
                    <>
                      sent {l.lastPushedQty} · {formatDate(l.lastPushedAt)}
                    </>
                  ) : l.lastSeenAt ? (
                    <>read {formatDate(l.lastSeenAt)}</>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  {l.marketplace !== 'shopify' && (
                    <ActionForm action={unlinkListingAction.bind(null, l.id)} showOk={false}>
                      <SubmitButton size="sm" variant="ghost" pendingText="…">
                        Unlink
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

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; days?: string; page?: string }> }) {
  await requireUser();
  const params = await searchParams;
  const days = PERIODS.find((d) => String(d) === params.days) ?? 30;
  const sort: Sort = params.sort && params.sort in SORTS ? (params.sort as Sort) : 'sales';
  const [{ products, listings }, accounts, matching, log, stats] = await Promise.all([
    listProductsWithListings(),
    listMarketplaceAccounts(),
    matchingSuggestions(),
    recentStockLog(30),
    productStats(days),
  ]);
  const perf = (id: string): ProductPerformance => stats.byProduct.get(id) ?? emptyPerformance();
  const byProduct = new Map<string, ListingRow[]>();
  for (const l of listings) byProduct.set(l.productId!, [...(byProduct.get(l.productId!) ?? []), l]);
  const productName = new Map(products.map((p) => [p.id, p.name]));

  // Summary
  const sold = products.filter((p) => perf(p.id).units > 0);
  const best = [...sold].sort((a, b) => perf(b.id).units - perf(a.id).units)[0];
  const units = products.reduce((sum, p) => sum + perf(p.id).units, 0);
  const revenue = products.reduce((sum, p) => sum + perf(p.id).revenue, 0);
  const outOfStock = products.filter((p) => p.stock <= 0).length;
  const share = products.length ? sold.length / products.length : 0;

  // List
  const needle = params.q?.toLowerCase().trim();
  const filtered = needle
    ? products.filter((p) => [p.sku, p.name, p.ean ?? '', ...(byProduct.get(p.id) ?? []).map((l) => l.title)].some((v) => v.toLowerCase().includes(needle)))
    : products;
  const sorted = [...filtered].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name, 'pl') : sort === 'stock' ? a.stock - b.stock : perf(b.id).units - perf(a.id).units || a.name.localeCompare(b.name, 'pl'),
  );
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const clear = matching.filter((m) => m.clear).length;
  const busy = listings.some((l) => {
    const acct = accounts.find((a) => a.id === l.accountId);
    const p = products.find((x) => x.id === l.productId);
    return p && acct?.stockSyncEnabled && !acct.stockDryRun && !l.lastPushError && l.lastPushedQty !== Math.max(0, p.stock);
  });
  const dryRun = accounts.filter((a) => a.enabled && a.stockSyncEnabled && a.stockDryRun);

  return (
    <>
      <AutoRefresh active={busy} seconds={10} />
      <PageHeader
        title="Inventory"
        description="Products and photos come from Shopify; Allegro and Empik offers are matched by EAN. One stock number for every platform."
        actions={
          <>
            <ActionForm action={importListingsAction}>
              <SubmitButton variant="secondary" pendingText="Importing…">
                Import listings
              </SubmitButton>
            </ActionForm>
            <ActionForm action={syncAllStockAction}>
              <SubmitButton pendingText="Starting…">
                <RefreshCw className="size-4" /> Sync all stocks
              </SubmitButton>
            </ActionForm>
          </>
        }
      />
      {dryRun.length > 0 && (
        <p className="-mt-2 mb-4 text-xs text-amber-700">
          Dry run on {dryRun.map((a) => a.name).join(', ')}: stock changes are only logged, not sent. Switch it off in Settings → Integrations.
        </p>
      )}

      <Card className="mb-5 grid grid-cols-2 divide-slate-100 md:grid-cols-3 md:divide-x xl:grid-cols-6">
        <Stat label="Products">
          <span className="text-2xl font-semibold tabular-nums">{products.length}</span>
        </Stat>
        <Stat label={`Best seller · ${days} days`} className="col-span-2 md:col-span-1">
          {best ? (
            <>
              <ProductPhoto product={best} size="size-8" />
              <span className="truncate font-semibold" title={best.name}>
                {best.name}
              </span>
            </>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </Stat>
        <Stat label="Products selling">
          <Gauge value={share} tone={share >= 0.5 ? 'excellent' : share > 0 ? 'low' : 'none'} />
          <span className="font-semibold tabular-nums">
            {sold.length} <span className="text-sm font-normal text-slate-500">of {products.length}</span>
          </span>
        </Stat>
        <Stat label={`Units sold · ${days} days`}>
          <span className="text-2xl font-semibold tabular-nums">{units.toLocaleString('pl-PL')}</span>
        </Stat>
        <Stat label={`Revenue · ${days} days`}>
          <span className="text-2xl font-semibold tabular-nums">{pln(revenue)}</span>
          {stats.missingRates.length > 0 && <span className="text-xs text-amber-700">without {stats.missingRates.join(', ')}</span>}
        </Stat>
        <Stat label="Out of stock">
          <PackageX className={cn('size-5', outOfStock ? 'text-red-500' : 'text-slate-300')} />
          <span className={cn('text-2xl font-semibold tabular-nums', outOfStock && 'text-red-700')}>{outOfStock}</span>
        </Stat>
      </Card>

      {matching.length > 0 && (
        <details className="group mb-5 rounded-2xl border border-amber-200 bg-amber-50/40" open={matching.length <= 10}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3">
            <span className="text-sm">
              <span className="font-semibold">Needs matching ({matching.length})</span>
              <span className="ml-2 text-slate-500">Allegro / Empik offers without a matching EAN. Their stock isn’t synced until linked.</span>
            </span>
            <span className="text-xs font-medium text-brand-700 group-open:hidden">Show</span>
          </summary>
          <div className="border-t border-amber-200 bg-white">
            {clear > 0 && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-2.5 text-sm text-slate-600">
                <span>
                  {clear} offer{clear === 1 ? ' has a' : 's have a'} clear match by name.
                </span>
                <ActionForm action={confirmClearSuggestionsAction}>
                  <SubmitButton size="sm" variant="secondary" pendingText="Linking…">
                    Link {clear} clear match{clear === 1 ? '' : 'es'}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {matching.map(({ listing: l, suggestions, clear: isClear }) => {
                const top = suggestions[0] && suggestions[0].score >= SUGGESTION_THRESHOLD ? suggestions[0] : null;
                const suggestedIds = new Set(suggestions.map((s) => s.productId));
                return (
                  <li key={l.id} className="grid grid-cols-1 items-center gap-2 px-5 py-3 lg:grid-cols-[1fr_minmax(0,28rem)]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <MarketplaceBadge marketplace={l.marketplace} />
                        <span>stock {l.lastSeenQty ?? '?'}</span>
                        <span>· {l.ean ? `EAN ${l.ean}` : 'no EAN'}</span>
                      </div>
                      <p className="mt-1 text-sm">{l.title}</p>
                      <p className="text-xs">
                        {top ? (
                          <span className={isClear ? 'text-emerald-700' : 'text-amber-700'}>
                            {isClear ? 'Clear match by name' : 'Possible match'} ({Math.round(top.score * 100)}%) – check it
                          </span>
                        ) : (
                          <span className="text-slate-500">No close match: choose the Shopify product</span>
                        )}
                      </p>
                    </div>
                    <ActionForm action={linkListingAction.bind(null, l.id)} className="flex gap-1.5" showOk={false}>
                      <Select name="productId" className="h-9 min-w-0 flex-1 text-xs" defaultValue={top?.productId ?? ''}>
                        <option value="">Choose Shopify product…</option>
                        {suggestions.length > 0 && (
                          <optgroup label="Closest by name">
                            {suggestions.map((s) => (
                              <option key={s.productId} value={s.productId}>
                                {productName.get(s.productId)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="All products">
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
                        Link
                      </SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      )}

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <form action="/inventory" className="mr-auto">
            {sort !== 'sales' && <input type="hidden" name="sort" value={sort} />}
            {days !== 30 && <input type="hidden" name="days" value={days} />}
            <Input name="q" defaultValue={params.q} placeholder="Search name, SKU, EAN" className="h-8 w-60" />
          </form>
          <div className="flex rounded-full border border-slate-200 p-0.5 text-xs">
            {PERIODS.map((d) => (
              <Link
                key={d}
                href={hrefWith(params, { days: d === 30 ? undefined : String(d), page: undefined })}
                className={cn('rounded-full px-3 py-1', d === days ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
              >
                {d} days
              </Link>
            ))}
          </div>
          <div className="flex rounded-full border border-slate-200 p-0.5 text-xs">
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <Link
                key={s}
                href={hrefWith(params, { sort: s === 'sales' ? undefined : s, page: undefined })}
                className={cn('rounded-full px-3 py-1', s === sort ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
              >
                {SORTS[s]}
              </Link>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <EmptyState title={products.length ? 'No product matches the search' : 'No products yet'}>
            {products.length ? null : 'Press “Import listings” to load your products and photos from Shopify.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => {
                  const own = byProduct.get(p.id) ?? [];
                  const f = perf(p.id);
                  return (
                    <ExpandableRow key={p.id} colSpan={6} label="listings" className="align-middle" details={<ListingDetails listings={own} stock={p.stock} />}>
                      <td className="py-3 pr-4 pl-2">
                        <div className="flex min-w-64 items-center gap-3">
                          <ProductPhoto product={p} />
                          <div className="min-w-0">
                            <p className="font-medium leading-snug">{p.name}</p>
                            <p className="mt-0.5 text-xs">
                              {hasRealSku(p.sku) ? <span className="font-mono text-slate-500">{p.sku}</span> : <Badge tone="amber">No SKU</Badge>}
                              {p.ean && <span className="ml-2 font-mono text-slate-400">{p.ean}</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="border-l border-slate-100 px-4 py-3 whitespace-nowrap">
                        <Label>
                          Performance <span className={cn('ml-1 font-medium', LEVEL_TONE[f.level])}>{LEVEL_LABEL[f.level]}</span>
                        </Label>
                        <p className="mt-1 flex items-center gap-2 text-sm tabular-nums">
                          <TrendingUp className="size-3.5 text-slate-400" /> {f.units}
                          <span className="text-slate-300">·</span>
                          <ShoppingBag className="size-3.5 text-slate-400" /> {pln(f.revenue)}
                        </p>
                      </td>
                      <td className="px-2 py-3">
                        <Gauge value={f.percentile} tone={f.level} className="h-10 w-16" label={`${LEVEL_LABEL[f.level]} performance`} />
                      </td>
                      <td className="border-l border-slate-100 px-4 py-3 whitespace-nowrap">
                        <Label>Sales rank</Label>
                        {f.rank ? (
                          <>
                            <p className="mt-0.5 flex items-center gap-1 text-lg font-semibold tabular-nums">
                              {f.rank === 1 && <Trophy className="size-4 text-amber-500" />}#{f.rank}
                              <span className="text-xs font-normal text-slate-400">of {products.length}</span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {PLATFORMS.filter((m) => f.rankByMarketplace[m])
                                .map((m) => `${PLATFORM_LABEL[m]} #${f.rankByMarketplace[m]}`)
                                .join(' · ')}
                            </p>
                          </>
                        ) : (
                          <p className="mt-0.5 text-lg text-slate-300">—</p>
                        )}
                      </td>
                      <td className="border-l border-slate-100 px-4 py-3">
                        <Label>Stock {p.stock <= 0 && <span className="ml-1 font-medium text-red-600">out of stock</span>}</Label>
                        <ActionForm action={adjustStockAction.bind(null, p.id)} className="mt-1 flex items-center gap-1.5" showOk={false}>
                          <input type="hidden" name="mode" value="set" />
                          <Input
                            name="value"
                            inputMode="numeric"
                            aria-label={`Stock of ${p.name}`}
                            defaultValue={p.stock}
                            key={p.stock}
                            className={cn('h-8 w-20 text-center font-semibold tabular-nums', p.stock <= 0 && 'text-red-700', p.stock > 0 && p.stock < 5 && 'text-amber-700')}
                            required
                          />
                          <SubmitButton size="sm" variant="secondary" pendingText="…">
                            Update all
                          </SubmitButton>
                        </ActionForm>
                        <PlatformDots listings={own} stock={p.stock} />
                      </td>
                    </ExpandableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">Recent stock pushes</summary>
        {log.length === 0 ? (
          <EmptyState title="Nothing sent yet" />
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {log.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-5 py-2">
                <span className="min-w-0 truncate">
                  {e.accountName}: {e.title ?? 'listing'} → <strong>{e.quantity}</strong>
                  {e.error && <span className="ml-1 text-red-700">({e.error})</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {e.dryRun ? <Badge tone="amber">dry run</Badge> : e.ok ? <Badge tone="green">sent</Badge> : <Badge tone="red">failed</Badge>}
                  <span className="text-xs text-slate-400">{timeAgo(e.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
