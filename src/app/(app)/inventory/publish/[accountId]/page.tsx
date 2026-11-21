import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, buttonClass, Card, CardBody, CardHeader, Input, PageHeader, Select } from '@/components/ui';
import { requireAdmin } from '@/server/auth';
import { publishPreview, type CatalogueState, type PublishPreview } from '@/server/services/marketplace-offers';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { createOffersAction, refreshFromShopifyAction, saveAllegroCategoryAction, saveAllegroParameterAction } from '../actions';
import { hasRealSku } from '@/lib/sku';
import { MARKETPLACE_LABELS } from '@/lib/utils';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Publish offers') };
}

const CATALOGUE: Record<CatalogueState, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  found: { tone: 'green', label: msg('In catalogue') },
  unverified: { tone: 'amber', label: msg('Catalogue not checked') },
  missing: { tone: 'red', label: msg('Not in catalogue') },
};

export default async function PublishPage({ params }: { params: Promise<{ accountId: string }> }) {
  const t = await getT();
  await requireAdmin();
  const { accountId } = await params;
  const account = (await listMarketplaceAccounts()).find((a) => a.id === accountId && (a.type === 'allegro' || a.type === 'empik' || a.type === 'hebe' || a.type === 'erli'));
  if (!account) notFound();
  const label = MARKETPLACE_LABELS[account.type];
  // Mirakl (Empik, HEBE) takes any product it knows by EAN; its catalogue lookup is only advice.
  const mirakl = account.type === 'empik' || account.type === 'hebe';
  const erli = account.type === 'erli';

  let preview: PublishPreview = { rows: [], setupProblems: [] };
  let error: string | null = null;
  try {
    preview = await publishPreview(account.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const { rows, setupProblems, allegroNew } = preview;
  const settingsHref = `/settings/integrations/marketplace/${account.id}`;
  const markup = account.settings.offerMarkupPercent ?? 0;

  return (
    <>
      <PageHeader
        title={t('Publish to {platform}', { platform: label })}
        description={`${t('Shopify products without an offer in {account}. Price = Shopify + {markup}%.', { account: account.name, markup })} ${erli ? t('Every product is created on Erli with the Shopify title, description, photos and EAN, in the Allegro category of the same product (from the Allegro catalogue or Publish → Allegro), so Erli places it in the same category.') : mirakl ? t('{platform} accepts a product it knows by EAN; if it refuses one, the reason is shown.', { platform: label }) : t('Offers show the Shopify title, description and photos. Products the Allegro catalogue doesn’t know by EAN are proposed as new products, in the category and with the details set up below.')} ${t('Nothing is created until you tick products and press Create.')}`}
        actions={
          <>
            <Link className={buttonClass('secondary')} href="/inventory">
              {t('Back to inventory')}
            </Link>
            <ActionForm action={refreshFromShopifyAction.bind(null, account.id)} popup={t('Reading Shopify')}>
              <SubmitButton variant="secondary" pendingText={t('Reading…')}>
                {t('Refresh from Shopify')}
              </SubmitButton>
            </ActionForm>
            <Link className={buttonClass('secondary')} href={settingsHref}>
              {t('{platform} settings', { platform: label })}
            </Link>
          </>
        }
      />
      {error && <p className="mb-4 text-sm text-red-700">{t('Could not read the products:')} {error}</p>}
      {setupProblems.length > 0 && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <CardBody className="text-sm text-amber-900">
            {t('Before offers can be created:')} {setupProblems.join('; ')}.{' '}
            <Link href={settingsHref} className="font-medium underline">
              {t('Open {platform} settings', { platform: label })}
            </Link>
          </CardBody>
        </Card>
      )}

      {allegroNew && allegroNew.types.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title={t('Categories for new products')}
            description={t('Products the Allegro catalogue doesn’t know go into one category per Shopify product type. Allegro’s suggestion is used until you save one.')}
          />
          <CardBody className="space-y-3">
            {allegroNew.types.map((type) => (
              <ActionForm key={type.productType || '(none)'} action={saveAllegroCategoryAction.bind(null, account.id, type.productType)} className="flex flex-wrap items-center gap-2">
                <span className="w-48 text-sm font-medium">
                  {type.productType || t('(no product type)')} <span className="text-xs font-normal text-slate-500">· {type.products}</span>
                </span>
                <Select name="category" defaultValue={type.saved ? `${type.saved.id}|${type.saved.path}` : type.suggestions[0] ? `${type.suggestions[0].id}|${type.suggestions[0].path}` : ''} className="max-w-xl min-w-0 flex-1">
                  <option value="">{t('Choose…')}</option>
                  {type.saved && !type.suggestions.some((c) => c.id === type.saved!.id) && <option value={`${type.saved.id}|${type.saved.path}`}>{type.saved.path}</option>}
                  {type.suggestions.map((c) => (
                    <option key={c.id} value={`${c.id}|${c.path}`}>
                      {c.path}
                    </option>
                  ))}
                </Select>
                <Input name="categoryIdTyped" placeholder={t('or category id')} className="w-36" inputMode="numeric" />
                <SubmitButton size="sm" variant="secondary">
                  {t('Save')}
                </SubmitButton>
                {type.saved ? <Badge tone="green">{t('Saved')}</Badge> : <Badge tone="amber">{t('Suggested')}</Badge>}
              </ActionForm>
            ))}
          </CardBody>
        </Card>
      )}

      {allegroNew && (allegroNew.missingParameters.length > 0 || allegroNew.sources.length > 0) && (
        <Card className="mb-5">
          <CardHeader
            title={t('Details Allegro needs for new products')}
            description={t('EAN, brand and condition are filled in automatically. For the rest, name a Shopify product metafield (namespace.key), a value that fits every product, or both: the metafield wins when the product has it.')}
          />
          <CardBody className="space-y-3">
            {[
              ...allegroNew.missingParameters.map((p) => ({ name: p.name, products: p.products, metafield: allegroNew.sources.find((s) => s.name === p.name)?.metafield ?? '', fallback: allegroNew.sources.find((s) => s.name === p.name)?.fallback ?? '' })),
              ...allegroNew.sources.filter((s) => !allegroNew.missingParameters.some((p) => p.name === s.name)).map((s) => ({ ...s, products: 0 })),
            ].map((p) => (
              <ActionForm key={p.name} action={saveAllegroParameterAction.bind(null, account.id, p.name)} className="flex flex-wrap items-center gap-2">
                <span className="w-48 text-sm font-medium">
                  {p.name}{' '}
                  {p.products > 0 ? (
                    <span className="text-xs font-normal text-amber-700">· {t.plural(p.products, 'missing on {n} product', 'missing on {n} products')}</span>
                  ) : (
                    <span className="text-xs font-normal text-emerald-700">· {t('set up')}</span>
                  )}
                </span>
                <Input name="metafield" defaultValue={p.metafield} placeholder={t('Shopify metafield, e.g. custom.capacity')} className="w-64" />
                <Input name="fallback" defaultValue={p.fallback} placeholder={t('or the same value for all')} className="w-48" />
                <SubmitButton size="sm" variant="secondary">
                  {t('Save')}
                </SubmitButton>
              </ActionForm>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">{error ? t('Fix the problem above to see the products.') : t('Every Shopify product already has a {platform} offer.', { platform: label })}</p>
          </CardBody>
        ) : (
          <ActionForm action={createOffersAction.bind(null, account.id)} popup={t('Creating {platform} offers', { platform: label })}>
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
                      {hasRealSku(r.sku) ? `SKU ${r.sku}` : t('no SKU in Shopify (the EAN is used)')} · EAN {r.ean ?? '—'}
                    </p>
                    {r.allegro && (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                        <p className="truncate" title={r.allegro.title}>
                          {erli ? t('Erli title:') : t('Allegro title:')} <span className="text-slate-700">{r.allegro.title}</span>
                          {r.allegro.shortened && <span className="text-amber-700"> · {t('shortened to 75 characters')}</span>}
                        </p>
                        <p className="truncate">
                          {r.allegro.photos > 0 ? t('{n} Shopify photos', { n: r.allegro.photos }) : erli ? t('no photo') : t('catalogue photos')} ·{' '}
                          {r.allegro.description ? t('Shopify description') : erli ? t('no description') : t('catalogue description')}
                          {r.allegro.responsiblePerson && <> · {t('Responsible person: {name}', { name: r.allegro.responsiblePerson })}</>}
                          {r.allegro.responsibleProducer && <> · {t('Producer: {name}', { name: r.allegro.responsibleProducer })}</>}
                          {r.allegro.gpsrFromProduct && <> ({t('from the product')})</>}
                        </p>
                        {r.allegro.erliCategory && (
                          <p className="truncate">
                            {r.allegro.erliCategory.source === 'catalogue'
                              ? t('Category: as the Allegro catalogue product')
                              : r.allegro.erliCategory.source === 'shop'
                                ? t('Category: Shopify type “{type}”, matched by Erli', { type: r.allegro.erliCategory.path ?? '' })
                                : r.allegro.erliCategory.source === 'none'
                                  ? t('Category: none, Erli will ask in its panel')
                                  : r.allegro.erliCategory.source === 'later'
                                    ? t('Category: taken from Allegro when the product is created')
                                  : t('Category: {path}', { path: r.allegro.erliCategory.path ?? '' })}
                            {r.allegro.erliCategory.source === 'suggested' && <span className="text-amber-700"> · {t('suggested')}</span>}
                            {r.allegro.erliCategory.attributes > 0 && <> · {t.plural(r.allegro.erliCategory.attributes, '{n} detail from Allegro', '{n} details from Allegro')}</>}
                          </p>
                        )}
                        {r.allegro.newProduct && (
                          <p className="truncate">
                            {t('New product in:')} <span className="text-slate-700">{r.allegro.newProduct.categoryPath ?? t('no category yet')}</span>
                            {r.allegro.newProduct.categoryPath && !r.allegro.newProduct.categorySaved && <span className="text-amber-700"> · {t('suggested')}</span>}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p>{r.price ? `${r.price} zł` : '—'}</p>
                    <p className="text-xs text-slate-500">
                      Shopify {r.shopifyPrice ?? '—'} · {t('stock {n}', { n: r.stock })}
                    </p>
                  </div>
                  <div className="flex w-48 flex-col items-end gap-1">
                    {r.catalogue && (
                      <Badge tone={r.catalogue === 'missing' ? (mirakl ? 'amber' : 'blue') : CATALOGUE[r.catalogue].tone}>
                        {r.catalogue === 'missing'
                          ? mirakl
                            ? t('Not found by {platform}’s lookup · you can still try', { platform: label })
                            : t('New on Allegro')
                          : t(CATALOGUE[r.catalogue].label)}
                      </Badge>
                    )}
                    {r.problems.filter((p) => p !== 'not in the catalogue').length > 0 && <Badge tone="amber">{r.problems.filter((p) => p !== 'not in the catalogue').join(', ')}</Badge>}
                    {r.problems.length === 0 && <Badge tone="green">{t('Ready')}</Badge>}
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
