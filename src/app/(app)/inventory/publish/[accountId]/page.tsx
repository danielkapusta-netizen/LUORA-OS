import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, buttonClass, Card, CardBody, PageHeader } from '@/components/ui';
import { requireAdmin } from '@/server/auth';
import { publishPreview, type CatalogueState, type PublishPreview } from '@/server/services/marketplace-offers';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { createOffersAction } from '../actions';

export const metadata: Metadata = { title: 'Publish offers' };

const CATALOGUE: Record<CatalogueState, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  found: { tone: 'green', label: 'In catalogue' },
  unverified: { tone: 'amber', label: 'Catalogue not checked' },
  missing: { tone: 'red', label: 'Not in catalogue' },
};

export default async function PublishPage({ params }: { params: Promise<{ accountId: string }> }) {
  await requireAdmin();
  const { accountId } = await params;
  const account = (await listMarketplaceAccounts()).find((a) => a.id === accountId && (a.type === 'allegro' || a.type === 'empik'));
  if (!account) notFound();
  const label = account.type === 'allegro' ? 'Allegro' : 'Empik';

  let preview: PublishPreview = { rows: [], setupProblems: [] };
  let error: string | null = null;
  try {
    preview = await publishPreview(account.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const { rows, setupProblems } = preview;
  const settingsHref = `/settings/integrations/marketplace/${account.id}`;
  const markup = account.settings.offerMarkupPercent ?? 0;

  return (
    <>
      <PageHeader
        title={`Publish to ${label}`}
        description={`Shopify products without an offer in ${account.name}. Price = Shopify + ${markup}%. Only products the ${label} catalogue knows by EAN can be listed. Nothing is created until you tick products and press Create.`}
        actions={
          <>
            <Link className={buttonClass('secondary')} href="/inventory">
              Back to inventory
            </Link>
            <Link className={buttonClass('secondary')} href={settingsHref}>
              {label} settings
            </Link>
          </>
        }
      />
      {error && <p className="mb-4 text-sm text-red-700">Could not read the products: {error}</p>}
      {setupProblems.length > 0 && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <CardBody className="text-sm text-amber-900">
            Before offers can be created: {setupProblems.join('; ')}.{' '}
            <Link href={settingsHref} className="font-medium underline">
              Open {label} settings
            </Link>
          </CardBody>
        </Card>
      )}

      <Card>
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">{error ? 'Fix the problem above to see the products.' : `Every Shopify product already has a ${label} offer.`}</p>
          </CardBody>
        ) : (
          <ActionForm action={createOffersAction.bind(null, account.id)} popup={`Creating ${label} offers`}>
            <div className="divide-y divide-slate-100">
              {rows.map((r) => (
                <label key={r.productId} className="flex items-center gap-3 px-5 py-3">
                  <input type="checkbox" name="productId" value={r.productId} disabled={r.problems.length > 0 || setupProblems.length > 0} className="size-4 rounded border-slate-300" />
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
                    <img src={r.imageUrl} alt="" className="size-12 shrink-0 rounded-lg border border-slate-100 bg-white object-contain" />
                  ) : (
                    <span className="size-12 shrink-0 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      SKU {r.sku} · EAN {r.ean ?? '—'}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{r.price ? `${r.price} zł` : '—'}</p>
                    <p className="text-xs text-slate-500">
                      Shopify {r.shopifyPrice ?? '—'} · stock {r.stock}
                    </p>
                  </div>
                  <div className="flex w-48 flex-col items-end gap-1">
                    {r.catalogue && <Badge tone={CATALOGUE[r.catalogue].tone}>{CATALOGUE[r.catalogue].label}</Badge>}
                    {r.problems.filter((p) => p !== 'not in the catalogue').length > 0 && <Badge tone="amber">{r.problems.filter((p) => p !== 'not in the catalogue').join(', ')}</Badge>}
                    {r.problems.length === 0 && <Badge tone="green">Ready</Badge>}
                  </div>
                </label>
              ))}
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <SubmitButton pendingText="Creating…">Create selected offers</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
