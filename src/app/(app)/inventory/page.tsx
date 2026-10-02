import { RefreshCw } from 'lucide-react';
import type { Metadata } from 'next';
import { AutoRefresh } from '@/components/auto-refresh';
import { MarketplaceBadge } from '@/components/badges';
import { ExpandableRow } from '@/components/expandable-row';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Select, td, th } from '@/components/ui';
import { hasRealSku } from '@/lib/sku';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { Product } from '@/server/db/schema';
import { listProductsWithListings, marketplaceQuantity, matchingSuggestions, recentStockLog } from '@/server/services/inventory';
import { SUGGESTION_THRESHOLD } from '@/server/services/matching';
import { listMarketplaceAccounts } from '@/server/services/settings';
import {
  adjustStockAction,
  confirmClearSuggestionsAction,
  importListingsAction,
  linkListingAction,
  syncAllStockAction,
  unlinkListingAction,
} from './actions';

export const metadata: Metadata = { title: 'Inventory' };

type ListingRow = Awaited<ReturnType<typeof listProductsWithListings>>['listings'][number];

const PLATFORMS = ['shopify', 'allegro', 'empik'] as const;
const PLATFORM_LABEL: Record<string, string> = { shopify: 'Shopify', allegro: 'Allegro', empik: 'Empik' };

function Sku({ sku }: { sku: string }) {
  return hasRealSku(sku) ? <span className="font-mono text-xs text-slate-500">{sku}</span> : <Badge tone="amber">No SKU</Badge>;
}

function ProductPhoto({ product }: { product: Pick<Product, 'imageUrl' | 'name'> }) {
  return product.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
    <img src={product.imageUrl} alt="" className="size-10 shrink-0 rounded-md border border-slate-100 object-cover" />
  ) : (
    <span className="size-10 shrink-0 rounded-md bg-slate-100" />
  );
}

/** "Allegro 19" chip: amber when the platform shows another number than the master stock. */
function PlatformChip({ platform, listings, stock }: { platform: string; listings: ListingRow[]; stock: number }) {
  if (listings.length === 0) return <span className="rounded border border-dashed border-slate-200 px-1.5 py-0.5 text-xs text-slate-400">{PLATFORM_LABEL[platform]} —</span>;
  const quantities = listings.map(marketplaceQuantity);
  const error = listings.some((l) => l.lastPushError);
  const drift = quantities.some((q) => q !== null && q !== Math.max(0, stock));
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 text-xs whitespace-nowrap',
        error ? 'border-red-200 bg-red-50 text-red-700' : drift ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600',
      )}
    >
      {PLATFORM_LABEL[platform]} {quantities.map((q) => q ?? '?').join(' / ')}
    </span>
  );
}

function ListingDetails({ listings, stock }: { listings: ListingRow[]; stock: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
            const drift = qty !== null && qty !== Math.max(0, stock);
            return (
              <tr key={l.id}>
                <td className="px-3 py-2 align-top">
                  <MarketplaceBadge marketplace={l.marketplace} />
                </td>
                <td className="px-3 py-2 align-top">
                  <p>{l.title}</p>
                  {l.sku && l.marketplace !== 'shopify' && <p className="font-mono text-xs text-slate-400">{l.sku}</p>}
                </td>
                <td className={cn('px-3 py-2 text-right align-top font-semibold tabular-nums', drift && 'text-amber-700')}>{qty ?? '?'}</td>
                <td className="px-3 py-2 align-top text-xs text-slate-500">
                  {l.lastPushError ? (
                    <span className="text-red-700">Not sent: {l.lastPushError}</span>
                  ) : l.lastPushedAt ? (
                    <>sent {l.lastPushedQty} · {formatDate(l.lastPushedAt)}</>
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

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q } = await searchParams;
  const [{ products, listings }, accounts, matching, log] = await Promise.all([
    listProductsWithListings(),
    listMarketplaceAccounts(),
    matchingSuggestions(),
    recentStockLog(30),
  ]);
  const byProduct = new Map<string, ListingRow[]>();
  for (const l of listings) byProduct.set(l.productId!, [...(byProduct.get(l.productId!) ?? []), l]);
  const productName = new Map(products.map((p) => [p.id, p.name]));

  const needle = q?.toLowerCase().trim();
  const shown = needle
    ? products.filter((p) =>
        [p.sku, p.name, p.ean ?? '', ...(byProduct.get(p.id) ?? []).map((l) => l.title)].some((v) => v.toLowerCase().includes(needle)),
      )
    : products;
  const clear = matching.filter((m) => m.clear).length;
  const busy = listings.some((l) => {
    const acct = accounts.find((a) => a.id === l.accountId);
    const p = products.find((x) => x.id === l.productId);
    return p && acct?.stockSyncEnabled && !acct.stockDryRun && !l.lastPushError && l.lastPushedQty !== Math.max(0, p.stock);
  });

  return (
    <>
      <AutoRefresh active={busy} seconds={10} />
      <PageHeader
        title="Inventory"
        description="Products come from Shopify. Allegro and Empik listings are matched to them, and the stock here is sent to every platform."
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

      <div className="mb-5 flex flex-wrap gap-2">
        {accounts
          .filter((a) => a.enabled)
          .map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
              <MarketplaceBadge marketplace={a.type} />
              {!a.stockSyncEnabled ? (
                <span className="text-slate-500">stock sync off</span>
              ) : a.stockDryRun ? (
                <span className="text-amber-700">dry run: nothing is sent</span>
              ) : (
                <span className="text-emerald-700">stock sync on</span>
              )}
            </span>
          ))}
      </div>

      {matching.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title={`Needs matching (${matching.length})`}
            description="Allegro and Empik listings not linked to a Shopify product yet. Their stock isn't synced until they are. The closest Shopify product is pre-selected; check it and press Link."
            actions={
              clear > 0 && (
                <ActionForm action={confirmClearSuggestionsAction}>
                  <SubmitButton size="sm" variant="secondary" pendingText="Linking…">
                    Link {clear} clear match{clear === 1 ? '' : 'es'}
                  </SubmitButton>
                </ActionForm>
              )
            }
          />
          <ul className="divide-y divide-slate-100">
            {matching.map(({ listing: l, suggestions, clear: isClear }) => {
              const top = suggestions[0] && suggestions[0].score >= SUGGESTION_THRESHOLD ? suggestions[0] : null;
              const suggestedIds = new Set(suggestions.map((s) => s.productId));
              return (
                <li key={l.id} className="grid grid-cols-1 items-center gap-2 px-4 py-3 lg:grid-cols-[1fr_minmax(0,28rem)]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <MarketplaceBadge marketplace={l.marketplace} />
                      <span className="text-xs text-slate-500">stock {l.lastSeenQty ?? '?'}</span>
                    </div>
                    <p className="mt-1 text-sm">{l.title}</p>
                    <p className="text-xs text-slate-500">
                      {top ? (
                        <span className={isClear ? 'text-emerald-700' : 'text-amber-700'}>
                          {isClear ? 'Clear match' : 'Possible match'} ({Math.round(top.score * 100)}%) – check it
                        </span>
                      ) : (
                        'No close match: choose the Shopify product'
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
        </Card>
      )}

      <Card className="mb-5">
        <CardHeader
          title={`Products (${products.length})`}
          actions={
            <form className="flex gap-2" action="/inventory">
              <Input name="q" defaultValue={q} placeholder="Search name, SKU, EAN" className="h-8 w-56" />
            </form>
          }
        />
        {shown.length === 0 ? (
          <EmptyState title={products.length ? 'No product matches the search' : 'No products yet'}>
            {products.length ? null : 'Press “Import listings” to load your products from Shopify.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-10" />
                  <th className={th}>Product</th>
                  <th className={cn(th, 'text-right')}>Stock</th>
                  <th className={th}>On each platform</th>
                  <th className={th}>Adjust</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => {
                  const own = byProduct.get(p.id) ?? [];
                  return (
                    <ExpandableRow key={p.id} colSpan={5} label="listings" details={<ListingDetails listings={own} stock={p.stock} />}>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <ProductPhoto product={p} />
                          <div className="min-w-0">
                            <p className="font-medium">{p.name}</p>
                            <Sku sku={p.sku} />
                          </div>
                        </div>
                      </td>
                      <td className={cn(td, 'text-right text-base font-semibold tabular-nums', p.stock <= 0 && 'text-red-700', p.stock > 0 && p.stock < 5 && 'text-amber-700')}>
                        {p.stock}
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1.5">
                          {PLATFORMS.map((m) => (
                            <PlatformChip key={m} platform={m} listings={own.filter((l) => l.marketplace === m)} stock={p.stock} />
                          ))}
                        </div>
                      </td>
                      <td className={td}>
                        <ActionForm action={adjustStockAction.bind(null, p.id)} className="flex items-center gap-1.5" showOk={false}>
                          <Select name="mode" className="h-8 w-24 text-xs" defaultValue="set">
                            <option value="set">Set</option>
                            <option value="add">+ / −</option>
                          </Select>
                          <Input name="value" inputMode="numeric" className="h-8 w-20" required placeholder={String(p.stock)} />
                          <SubmitButton size="sm" variant="secondary">
                            Save
                          </SubmitButton>
                        </ActionForm>
                      </td>
                    </ExpandableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent stock pushes" />
        {log.length === 0 ? (
          <EmptyState title="Nothing sent yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {log.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
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
      </Card>
    </>
  );
}
