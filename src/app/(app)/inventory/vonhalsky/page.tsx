import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, Select } from '@/components/ui';
import { requireAdmin } from '@/server/auth';
import { offerPreview, type OfferRow } from '@/server/services/vonhalsky-offers';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { createOffersAction, loadCategoriesAction, saveCategoryAction, syncPricesAction } from './actions';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Von Halsky offers') };
}

export default async function VonHalskyOffersPage() {
  const t = await getT();
  await requireAdmin();
  const account = (await listMarketplaceAccounts()).find((a) => a.type === 'vonhalsky' && a.enabled);
  if (!account) {
    return (
      <>
        <PageHeader title={t('Von Halsky offers')} />
        <EmptyState title={t('No Von Halsky account yet')}>{t('Add and connect one in Settings → Integrations.')}</EmptyState>
      </>
    );
  }
  let rows: OfferRow[] = [];
  let error: string | null = null;
  try {
    rows = await offerPreview(account.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const categories = account.settings.vhCategories?.items ?? [];
  const types = [...new Set(rows.map((r) => r.productType))].sort();
  const ready = rows.filter((r) => r.problems.length === 0);

  return (
    <>
      <PageHeader
        title={t('Von Halsky offers')}
        description={`Shopify products without an offer in ${account.name}. Price = Shopify + ${account.settings.vhMarkupPercent ?? 10}%. Nothing is created until you tick products and press Create. Offers whose price was set on the Pricing page keep it.`}
        actions={
          <>
            <Link className={buttonClass('secondary')} href="/inventory">
              {t('Back to inventory')}
            </Link>
            <ActionForm action={syncPricesAction.bind(null, account.id)} popup={t('Price update')}>
              <SubmitButton variant="secondary" pendingText={t('Updating…')}>
                {t('Update prices of Luora offers')}
              </SubmitButton>
            </ActionForm>
          </>
        }
      />
      {error && <p className="mb-4 text-sm text-red-700">{t('Could not read the products:')} {error}</p>}

      <Card className="mb-5">
        <CardHeader
          title={t('Categories')}
          description={categories.length ? `${categories.length} cosmetics categories loaded from InPost.` : 'Load the category list from InPost before creating offers.'}
          actions={
            <ActionForm action={loadCategoriesAction.bind(null, account.id)} popup={t('Loading categories')}>
              <SubmitButton variant="secondary" size="sm" pendingText={t('Loading…')}>
                {categories.length ? 'Reload categories' : 'Load categories'}
              </SubmitButton>
            </ActionForm>
          }
        />
        {categories.length > 0 && types.length > 0 && (
          <CardBody className="space-y-3">
            <p className="text-xs text-slate-500">{t('One category per Shopify product type. The suggestion is only a guess: choose and save to fix it.')}</p>
            {types.map((type) => {
              const sample = rows.find((r) => r.productType === type);
              return (
                <ActionForm key={type || '(none)'} action={saveCategoryAction.bind(null, account.id, type)} className="flex flex-wrap items-center gap-2">
                  <span className="w-48 text-sm font-medium">{type || '(no product type)'}</span>
                  <Select name="categoryId" defaultValue={sample?.categoryId ?? ''} className="max-w-xl flex-1">
                    <option value="">{t('Choose…')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.path}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton size="sm" variant="secondary">
                    {t('Save')}
                  </SubmitButton>
                  {sample?.categoryChosen && <Badge tone="green">{t('Saved')}</Badge>}
                </ActionForm>
              );
            })}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title={`${rows.length} products without an offer`} description={`${ready.length} ready. Start with three, check them in the InPost app, then create the rest.`} />
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">{t('Every Shopify product already has a Von Halsky offer.')}</p>
          </CardBody>
        ) : (
          <ActionForm action={createOffersAction.bind(null, account.id)} popup={t('Creating Von Halsky offers')}>
            <div className="divide-y divide-slate-100">
              {rows.map((r) => (
                <label key={r.productId} className="flex items-center gap-3 px-5 py-3">
                  <input type="checkbox" name="productId" value={r.productId} disabled={r.problems.length > 0} className="size-4 rounded border-slate-300" />
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers
                    <img src={r.imageUrl} alt="" className="size-12 shrink-0 rounded-lg border border-slate-100 bg-white object-contain" />
                  ) : (
                    <span className="size-12 shrink-0 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      EAN {r.ean ?? '—'} · {r.categoryPath ?? 'no category'}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{r.price ? `${r.price} zł` : '—'}</p>
                    <p className="text-xs text-slate-500">
                      Shopify {r.shopifyPrice ?? '—'} · stock {r.stock}
                    </p>
                  </div>
                  <div className="w-40 text-right">
                    {r.problems.length === 0 ? <Badge tone="green">{t('Ready')}</Badge> : <Badge tone="amber">{r.problems.join(', ')}</Badge>}
                  </div>
                </label>
              ))}
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <SubmitButton pendingText={t('Creating…')}>{t('Create selected offers')}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
