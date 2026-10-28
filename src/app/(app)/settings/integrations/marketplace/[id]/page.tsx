import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, buttonClass, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { formatDate, MARKETPLACE_LABELS } from '@/lib/utils';
import { requireAdmin } from '@/server/auth';
import type { MarketplaceAccount } from '@/server/db/schema';
import { env } from '@/server/env';
import { DEFAULT_SAFETY_TEXT } from '@/server/integrations/marketplaces/allegro/adapter';
import { ALLEGRO_REDIRECT_PATH } from '@/server/integrations/marketplaces/allegro/client';
import { EMPIK_CARRIER_CODES } from '@/server/integrations/marketplaces/empik/adapter';
import { resolveMiraklCarrier } from '@/server/integrations/marketplaces/mirakl/adapter';
import { VON_HALSKY_REDIRECT_PATH } from '@/server/integrations/marketplaces/vonhalsky/client';
import { DEFAULT_SHOPIFY_API_VERSION } from '@/server/integrations/marketplaces/shopify/client';
import { DEFAULT_PICKUP_POINT_KEYS } from '@/server/integrations/marketplaces/shopify/mapper';
import type { MarketplaceSettings } from '@/server/db/schema';
import { loadMarketplaceAccount } from '@/server/services/accounts';
import { miraklCarriers, publicCredentialFields, storedCredentialKeys } from '@/server/services/settings';
import {
  deleteMarketplaceAction,
  importListingsAction,
  refreshMiraklCarriersAction,
  refreshMiraklOfferFieldsAction,
  saveMarketplaceAction,
  startHistoryAction,
  stopHistoryAction,
  syncFeesAction,
} from '../../../actions';
import { loadAllegroOptionsAction } from '../../../../inventory/publish/actions';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Marketplace account') };
}

function Secret({ name, label, stored, hint }: { name: string; label: string; stored: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input name={name} type="password" autoComplete="off" placeholder={stored ? '•••••••• saved – leave blank to keep' : ''} />
    </Field>
  );
}

const PROVINCES = [
  'DOLNOSLASKIE',
  'KUJAWSKO_POMORSKIE',
  'LUBELSKIE',
  'LUBUSKIE',
  'LODZKIE',
  'MALOPOLSKIE',
  'MAZOWIECKIE',
  'OPOLSKIE',
  'PODKARPACKIE',
  'PODLASKIE',
  'POMORSKIE',
  'SLASKIE',
  'SWIETOKRZYSKIE',
  'WARMINSKO_MAZURSKIE',
  'WIELKOPOLSKIE',
  'ZACHODNIOPOMORSKIE',
];

/** Markup, rounding and handling time of offers created from Shopify. */
async function OfferPricing({ s }: { s: MarketplaceSettings }) {
  const t = await getT();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label={t('Markup on the Shopify price (%)')} hint={t('Use it to cover this marketplace\'s commission')}>
        <Input name="offerMarkupPercent" inputMode="decimal" defaultValue={String(s.offerMarkupPercent ?? 0)} />
      </Field>
      <Field label={t('Round the price to')}>
        <Select name="offerRounding" defaultValue={s.offerRounding ?? 'x.99'}>
          <option value="x.99">…99 (e.g. 89.99)</option>
          <option value="x.00">{t('whole zloty (e.g. 90.00)')}</option>
          <option value="none">{t('no rounding')}</option>
        </Select>
      </Field>
      <Field label={t('Days to ship')}>
        <Input name="offerHandlingDays" inputMode="numeric" defaultValue={String(s.offerHandlingDays ?? 1)} />
      </Field>
    </div>
  );
}

/** A list read from Allegro to pick from; before it is loaded the saved id can still be seen and kept. */
function AllegroChoice({ name, label, selected, items, optional, hint }: { name: string; label: string; selected?: string; items?: { id: string; name: string }[]; optional?: boolean; hint?: string }) {
  const known = items?.some((i) => i.id === selected);
  return (
    <Field label={label} hint={items ? hint : 'Press “Load choices from Allegro” below first'}>
      <Select name={name} defaultValue={selected ?? ''}>
        <option value="">{optional ? 'None' : 'Choose…'}</option>
        {selected && !known && <option value={selected}>{selected} (saved)</option>}
        {(items ?? []).map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export default async function MarketplaceAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
  const t = await getT();
  await requireAdmin();
  const { id } = await params;
  const { type: typeParam } = await searchParams;
  let account: MarketplaceAccount | null = null;
  if (id !== 'new') {
    try {
      account = await loadMarketplaceAccount(id);
    } catch {
      notFound();
    }
  }
  const type = (account?.type ?? typeParam) as MarketplaceAccount['type'];
  if (!MARKETPLACE_LABELS[type]) notFound();
  const stored = storedCredentialKeys(account?.credentials ?? null);
  const pub = publicCredentialFields(account?.credentials ?? null);
  const s = account?.settings ?? {};
  // Empik and HEBE both run on Mirakl and share one form; only Empik documents its carrier codes.
  const mirakl = type === 'empik' || type === 'hebe';
  const label = MARKETPLACE_LABELS[type];
  const documented = type === 'empik' ? EMPIK_CARRIER_CODES : null;
  let carrierList: { code: string; label: string }[] = [];
  let carrierError: string | null = null;
  if (account && mirakl) {
    try {
      carrierList = await miraklCarriers(account.id);
    } catch (err) {
      carrierError = err instanceof Error ? err.message : String(err);
    }
  }
  const lockerCarrier = carrierList.length
    ? resolveMiraklCarrier([s.carrierCodes?.inpostLocker, documented?.inpostLocker], carrierList, 'inpostLocker')?.code
    : s.carrierCodes?.inpostLocker;
  const courierCarrier = carrierList.length
    ? resolveMiraklCarrier([s.carrierCodes?.inpostCourier, documented?.inpostCourier], carrierList, 'inpostCourier')?.code
    : s.carrierCodes?.inpostCourier;
  const offerFields = mirakl ? (s.offerFieldCache?.fields ?? []) : [];
  const str = (key: string) => (typeof pub[key] === 'string' ? (pub[key] as string) : '');

  return (
    <div className="max-w-3xl">
      <Link href="/settings/integrations" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {t('Integrations')}
      </Link>
      <Card>
        <CardHeader title={account ? `${account.name}` : `New ${MARKETPLACE_LABELS[type]} account`} />
        <CardBody>
          <ActionForm action={saveMarketplaceAction.bind(null, account?.id ?? null)} className="space-y-5">
            <input type="hidden" name="type" value={type} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('Name')}>
                <Input name="name" defaultValue={account?.name ?? `${MARKETPLACE_LABELS[type]} – main`} required />
              </Field>
              <Field label={t('History to import on first sync (days)')}>
                <Input name="initialSyncDays" type="number" min={1} max={90} defaultValue={s.initialSyncDays ?? 14} />
              </Field>
            </div>

            {type === 'shopify' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('Shopify connection')}</legend>
                <p className="text-xs text-slate-500">
                  {t('Create an app in the Shopify Dev Dashboard, install it on the store, and paste its Client ID and secret. Scopes needed: read_orders, read_products, write_products (to change prices on the Pricing page), read_locations, write_inventory, write_merchant_managed_fulfillment_orders. A legacy Admin API token (shpat_…) also works.')}
                </p>
                <Field label={t('Shop domain')}>
                  <Input name="shopDomain" defaultValue={str('shopDomain')} placeholder={t('my-shop.myshopify.com')} required />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Secret name="clientId" label={t('Client ID')} stored={stored.includes('clientId')} />
                  <Secret name="clientSecret" label={t('Client secret')} stored={stored.includes('clientSecret')} hint={t('Also used to verify webhooks.')} />
                </div>
                <Secret name="accessToken" label={t('Legacy Admin API token (optional)')} stored={stored.includes('accessToken') && !stored.includes('clientId')} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('API version')}>
                    <Input name="apiVersion" defaultValue={s.apiVersion ?? DEFAULT_SHOPIFY_API_VERSION} />
                  </Field>
                  <Field label={t('Location ID for stock (optional)')} hint={t('Defaults to the first active location.')}>
                    <Input name="locationId" defaultValue={s.locationId ?? ''} placeholder={t('gid://shopify/Location/…')} />
                  </Field>
                </div>
                <Field label={t('Note attributes that hold the Paczkomat code')} hint={t('Comma separated; matched case-insensitively.')}>
                  <Input name="pickupPointKeys" defaultValue={(s.pickupPointKeys ?? DEFAULT_PICKUP_POINT_KEYS).join(', ')} />
                </Field>
                <Checkbox name="notifyCustomer" label={t('Email the buyer when tracking is added')} defaultChecked={s.notifyCustomer ?? true} />
              </fieldset>
            )}

            {type === 'allegro' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('Allegro connection')}</legend>
                <p className="text-xs text-slate-500">
                  Register an app at apps.developer.allegro.pl (or the sandbox) with redirect URI{' '}
                  <code className="select-all">{`${env().APP_URL}${ALLEGRO_REDIRECT_PATH}`}</code>, save its Client ID and secret here, then press
                  “Connect Allegro” on the Integrations page.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Secret name="clientId" label={t('Client ID')} stored={stored.includes('clientId')} />
                  <Secret name="clientSecret" label={t('Client secret')} stored={stored.includes('clientSecret')} />
                </div>
                <Checkbox name="sandbox" label={t('Use the Allegro sandbox')} defaultChecked={pub.sandbox === true} />
                <p className="pt-2 text-sm font-semibold">{t('Offers created from Shopify')}</p>
                <p className="text-xs text-slate-500">
                  {t('Creating offers needs the Allegro app to have the permissions “Offers: read and write” and “Seller settings: read”; reconnect Allegro after enabling them. Press “Load choices from Allegro” below the form, then pick them here.')}
                </p>
                <OfferPricing s={s} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <AllegroChoice name="allegroShippingRateId" label={t('Shipping rates')} selected={s.allegroShippingRateId} items={s.allegroOptions?.shippingRates} />
                  <AllegroChoice name="allegroReturnPolicyId" label={t('Return policy')} selected={s.allegroReturnPolicyId} items={s.allegroOptions?.returnPolicies} />
                  <AllegroChoice name="allegroImpliedWarrantyId" label={t('Implied warranty (complaints)')} selected={s.allegroImpliedWarrantyId} items={s.allegroOptions?.impliedWarranties} />
                  <AllegroChoice name="allegroWarrantyId" label={t('Warranty (optional)')} selected={s.allegroWarrantyId} items={s.allegroOptions?.warranties} optional />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label={t('Goods are sent from: province')}>
                    <Select name="allegroProvince" defaultValue={s.allegroLocation?.province ?? ''}>
                      <option value="">{t('Choose…')}</option>
                      {PROVINCES.map((p) => (
                        <option key={p} value={p}>
                          {p.replace(/_/g, '-').toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('City')}>
                    <Input name="allegroCity" defaultValue={s.allegroLocation?.city ?? ''} />
                  </Field>
                  <Field label={t('Postcode')}>
                    <Input name="allegroPostCode" defaultValue={s.allegroLocation?.postCode ?? ''} placeholder="00-000" />
                  </Field>
                </div>
                <AllegroChoice
                  name="allegroResponsibleProducerId"
                  label={t('Responsible producer (GPSR)')}
                  selected={s.allegroResponsibleProducerId}
                  items={s.allegroOptions?.responsibleProducers}
                  hint={t('Required by Allegro on every offer. If the list is empty, add the producer first in Allegro (My Allegro → Product safety) and load the choices again.')}
                />
                <AllegroChoice
                  name="allegroResponsiblePersonId"
                  label={t('Responsible person (GPSR)')}
                  selected={s.allegroResponsiblePersonId}
                  items={s.allegroOptions?.responsiblePersons}
                  hint={t('Required by Allegro on every offer. If the list is empty, add the person first in Allegro (My Allegro → Product safety) and load the choices again.')}
                />
                <Field label={t('Safety information shown on every offer')} hint={t('Allegro refuses offers without it. Leave blank for a standard cosmetics text.')}>
                  <Textarea name="allegroSafetyText" rows={3} defaultValue={s.allegroSafetyText ?? ''} placeholder={DEFAULT_SAFETY_TEXT} />
                </Field>
                <Checkbox name="allegroCreateAsDraft" label={t('Create offers as inactive drafts instead of publishing them at once')} defaultChecked={s.allegroCreateAsDraft ?? false} />
              </fieldset>
            )}

            {type === 'vonhalsky' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('InPost Von Halsky connection')}</legend>
                <p className="text-xs text-slate-500">
                  {t('In the InPost Merchant Portal open Integrations → API, press “Create App” and tick exactly these permissions: Categories (read), Offers (read), Offers (write), Orders (read), Orders (write). Copy the organisation id, the Client ID and the Client secret here (the secret is shown only once). Create the app with the “Authorization Code” method and register this exact Redirect URL:')}{' '}
                  <code className="select-all">{`${env().APP_URL}${VON_HALSKY_REDIRECT_PATH}`}</code>. Save here, then press “Connect Von Halsky” on the
                  Integrations page and approve access at InPost.
                </p>
                <Field label={t('Organisation ID')} hint={t('The brand/store created for this integration (a UUID).')}>
                  <Input name="organizationId" defaultValue={str('organizationId')} placeholder="00000000-0000-0000-0000-000000000000" required />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Secret name="clientId" label={t('Client ID')} stored={stored.includes('clientId')} />
                  <Secret name="clientSecret" label={t('Client secret')} stored={stored.includes('clientSecret')} />
                </div>
                <Checkbox name="sandbox" label={t('Use InPost\'s stage (test) environment')} defaultChecked={pub.sandbox === true} />
                <p className="pt-2 text-sm font-semibold">{t('Offers created from Shopify')}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label={t('Markup on the Shopify price (%)')}>
                    <Input name="vhMarkupPercent" inputMode="decimal" defaultValue={String(s.vhMarkupPercent ?? 10)} />
                  </Field>
                  <Field label={t('Round the price to')}>
                    <Select name="vhRounding" defaultValue={s.vhRounding ?? 'x.99'}>
                      <option value="x.99">…99 (e.g. 89.99)</option>
                      <option value="x.00">{t('whole zloty (e.g. 90.00)')}</option>
                      <option value="none">{t('no rounding')}</option>
                    </Select>
                  </Field>
                  <Field label={t('Days to ship')}>
                    <Input name="vhDaysToShip" inputMode="numeric" defaultValue={String(s.vhDaysToShip ?? 1)} />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t('Default box width (cm)')}>
                    <Input name="vhBoxWidth" inputMode="decimal" defaultValue={String(s.vhBox?.width ?? 10)} />
                  </Field>
                  <Field label={t('Height (cm)')}>
                    <Input name="vhBoxHeight" inputMode="decimal" defaultValue={String(s.vhBox?.height ?? 10)} />
                  </Field>
                  <Field label={t('Length (cm)')}>
                    <Input name="vhBoxLength" inputMode="decimal" defaultValue={String(s.vhBox?.length ?? 5)} />
                  </Field>
                </div>
                <p className="text-xs text-slate-500">
                  {t('Shipments are made with your InPost account (labels), not here: InPost links the label to the order through the buyer’s e-mail.')}
                </p>
              </fieldset>
            )}

            {mirakl && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{label} Marketplace connection</legend>
                {type === 'empik' ? (
                  <p className="text-xs text-slate-500">{t('Empik runs on Mirakl. Generate an API key in the seller panel (My account → API key).')}</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    {t('HEBE runs on Mirakl. In the HEBE seller panel open your user menu → API key and generate a key. The Marketplace URL is the address of that seller panel (the Mirakl front, often https://…mirakl.net), without /api.')}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('Marketplace URL')}>
                    <Input
                      name="baseUrl"
                      defaultValue={str('baseUrl') || (type === 'empik' ? 'https://marketplace.empik.com' : '')}
                      placeholder={type === 'hebe' ? 'https://…mirakl.net' : undefined}
                      required
                    />
                  </Field>
                  <Secret name="apiKey" label={t('API key')} stored={stored.includes('apiKey')} />
                  <Field label={t('Shop ID (optional)')}>
                    <Input name="shopId" defaultValue={str('shopId')} />
                  </Field>
                  {(
                    [
                      ['carrierCodeInpostLocker', `${label} carrier for InPost Paczkomat labels`, lockerCarrier, documented?.inpostLocker],
                      ['carrierCodeInpostCourier', `${label} carrier for InPost courier labels`, courierCarrier, documented?.inpostCourier],
                    ] as const
                  ).map(([name, fieldLabel, selected, fallback]) =>
                    carrierList.length ? (
                      <Field key={name} label={fieldLabel} hint={`From ${label}'s carrier list (SH21)`}>
                        <Select name={name} defaultValue={selected ?? ''}>
                          <option value="">{t('Pick automatically')}</option>
                          {carrierList.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.label} ({c.code})
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : (
                      <Field
                        key={name}
                        label={fieldLabel}
                        hint={fallback ? `${label}'s carrier code; leave blank for ${fallback}` : `${label}'s carrier code; leave blank to pick it from ${label}'s carrier list`}
                      >
                        <Input name={name} defaultValue={selected ?? ''} placeholder={fallback} />
                      </Field>
                    ),
                  )}
                </div>
                <Checkbox name="autoAccept" label={t('Accept new orders automatically when stock covers them')} defaultChecked={s.autoAccept ?? false} />
                <p className="pt-2 text-sm font-semibold">{t('Offers created from Shopify')}</p>
                <OfferPricing s={s} />
                <Field label={t('Offer state code')} hint={`${label}'s code for “new” (11 on most Mirakl shops)`}>
                  <Input name="empikOfferState" defaultValue={s.empikOfferState ?? '11'} />
                </Field>
                <p className="pt-2 text-sm font-semibold">Extra offer fields required by {label}</p>
                {offerFields.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    None loaded yet. Save the connection, then press “Load {label} offer fields” below the form. Fields {label} asks for on every offer (for example the
                    responsible person) appear here, and each can be read from a Shopify product metafield.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {offerFields.map((f) => {
                      const source = s.offerFieldSources?.[f.code];
                      return (
                        <div key={f.code} className="rounded-md border border-slate-200 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {f.label}
                            <code className="text-xs font-normal text-slate-500">{f.code}</code>
                            {f.required && <Badge tone="red">{t('required')}</Badge>}
                          </div>
                          {f.description && <p className="mt-0.5 text-xs text-slate-500">{f.description}</p>}
                          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label={t('Shopify product metafield')} hint={t('namespace.key of a product metafield. Name several, separated by commas, to join their values (e.g. a name and an address)')}>
                              <Input name={`offerFieldMetafield:${f.code}`} defaultValue={source?.metafield ?? ''} placeholder={t('custom.responsible_person, custom.responsible_person_address')} />
                            </Field>
                            <Field label={t('Fixed value when the product has none')} hint={f.defaultValue ? `${label} fills in “${f.defaultValue}” if this is empty` : undefined}>
                              {f.acceptedValues ? (
                                <Select name={`offerFieldFallback:${f.code}`} defaultValue={source?.fallback ?? ''}>
                                  <option value="">{t('None')}</option>
                                  {f.acceptedValues.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                <Input name={`offerFieldFallback:${f.code}`} defaultValue={source?.fallback ?? ''} />
                              )}
                            </Field>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">{t('Sync')}</legend>
              <Checkbox name="enabled" label={t('Sync orders from this account')} defaultChecked={account?.enabled ?? true} />
              <Checkbox name="stockSyncEnabled" label={t('Keep stock in sync with the Inventory page')} defaultChecked={account?.stockSyncEnabled ?? false} />
              <Checkbox name="stockDryRun" label={t('Dry run: log stock changes but don\'t send them')} defaultChecked={account?.stockDryRun ?? true} />
            </fieldset>

            <SubmitButton>{account ? 'Save' : 'Create account'}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      {account && <HistoryAndFees account={account} />}

      {account && (
        <div className="mt-5 flex flex-wrap gap-2">
          {mirakl && (
            <ActionForm action={refreshMiraklCarriersAction.bind(null, account.id)}>
              <SubmitButton variant="secondary">Refresh {label} carrier list</SubmitButton>
              {carrierError && (
                <p className="mt-1 text-sm text-red-700">
                  Could not load {label} {t('carriers:')} {carrierError}
                </p>
              )}
            </ActionForm>
          )}
          {mirakl && (
            <ActionForm action={refreshMiraklOfferFieldsAction.bind(null, account.id)}>
              <SubmitButton variant="secondary">Load {label} offer fields</SubmitButton>
            </ActionForm>
          )}
          {type === 'allegro' && (
            <ActionForm action={loadAllegroOptionsAction.bind(null, account.id)}>
              <SubmitButton variant="secondary">{t('Load choices from Allegro')}</SubmitButton>
            </ActionForm>
          )}
          {(type === 'allegro' || mirakl) && (
            <Link href={`/inventory/publish/${account.id}`} className={buttonClass('secondary')}>
              Publish products to {label}
            </Link>
          )}
          <ActionForm action={importListingsAction.bind(null, account.id)}>
            <SubmitButton variant="secondary">{t('Import listings for stock sync')}</SubmitButton>
          </ActionForm>
          <form action={deleteMarketplaceAction.bind(null, account.id)}>
            <SubmitButton variant="danger" confirm={t('Delete this account and all of its orders?')}>
              {t('Delete account')}
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

const HISTORY_STATE = {
  idle: { label: 'Not imported', tone: 'gray' },
  running: { label: 'Importing…', tone: 'blue' },
  done: { label: 'Imported', tone: 'green' },
  error: { label: 'Stopped', tone: 'red' },
} as const;

/** The one-off import of past orders and, for Allegro, the billing fee feed. */
async function HistoryAndFees({ account }: { account: MarketplaceAccount }) {
  const t = await getT();
  const state = HISTORY_STATE[account.historyState];
  return (
    <Card className="mt-5">
      <CardHeader
        title={t('Past orders and fees (for analytics)')}
        description={t('Imports every past order once, so analytics and margins cover your whole history. Past orders are stored as closed: they never get labels, invoices or stock changes.')}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={state.tone}>{state.label}</Badge>
          <span>{account.historyImported} past order(s) imported</span>
          {account.historyUpdatedAt && <span className="text-xs text-slate-500">last step {formatDate(account.historyUpdatedAt, true, t.locale)}</span>}
        </div>
        {account.historyError && <p className="text-sm text-red-700">{account.historyError}</p>}
        {account.type === 'shopify' && (
          <p className="text-xs text-slate-500">
            Shopify only returns orders older than 60 days when the app has the <code>{t('read_all_orders')}</code> scope (ask for it in the Shopify Dev Dashboard).
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {account.historyState === 'running' ? (
            <ActionForm action={stopHistoryAction.bind(null, account.id)}>
              <SubmitButton variant="secondary">{t('Stop')}</SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={startHistoryAction.bind(null, account.id)}>
              {account.historyState === 'error' && account.historyCursor ? (
                <SubmitButton>{t('Resume import')}</SubmitButton>
              ) : (
                <SubmitButton>{account.historyState === 'done' ? 'Import again' : 'Import past orders'}</SubmitButton>
              )}
            </ActionForm>
          )}
          {account.historyState === 'error' && account.historyCursor && (
            <ActionForm action={startHistoryAction.bind(null, account.id)}>
              <input type="hidden" name="restart" value="1" />
              <SubmitButton variant="secondary">{t('Start over')}</SubmitButton>
            </ActionForm>
          )}
        </div>

        {account.type === 'allegro' && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold">{t('Allegro fees and refunds')}</p>
            <p className="text-xs text-slate-500">
              {t('Commission, Smart delivery and promotion charges are read from Allegro billing every two hours, and payment refunds with them. The Allegro app needs the “Billing (read)” and “Payments (read)” permissions; after enabling them press “Connect Allegro” again.')}
            </p>
            <p className="text-sm">
              {account.feesSyncedAt ? (
                <>
                  Read up to {account.feesCursor ? formatDate(new Date(account.feesCursor), true, t.locale) : '–'} · last run {formatDate(account.feesSyncedAt, true, t.locale)}
                </>
              ) : (
                'Not read yet.'
              )}
            </p>
            {account.feesError && <p className="text-sm text-red-700">{account.feesError}</p>}
            <div className="flex flex-wrap gap-2">
              <ActionForm action={syncFeesAction.bind(null, account.id)}>
                <SubmitButton variant="secondary">{t('Read fees now')}</SubmitButton>
              </ActionForm>
              <ActionForm action={syncFeesAction.bind(null, account.id)}>
                <input type="hidden" name="fromStart" value="1" />
                <SubmitButton variant="secondary">{t('Read all fees again')}</SubmitButton>
              </ActionForm>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
