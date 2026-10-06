import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, Select } from '@/components/ui';
import { MARKETPLACE_LABELS } from '@/lib/utils';
import { requireAdmin } from '@/server/auth';
import type { MarketplaceAccount } from '@/server/db/schema';
import { env } from '@/server/env';
import { ALLEGRO_REDIRECT_PATH } from '@/server/integrations/marketplaces/allegro/client';
import { EMPIK_CARRIER_CODES, resolveEmpikCarrier } from '@/server/integrations/marketplaces/empik/adapter';
import { VON_HALSKY_REDIRECT_PATH } from '@/server/integrations/marketplaces/vonhalsky/client';
import { DEFAULT_SHOPIFY_API_VERSION } from '@/server/integrations/marketplaces/shopify/client';
import { DEFAULT_PICKUP_POINT_KEYS } from '@/server/integrations/marketplaces/shopify/mapper';
import { loadMarketplaceAccount } from '@/server/services/accounts';
import { empikCarriers, publicCredentialFields, storedCredentialKeys } from '@/server/services/settings';
import { deleteMarketplaceAction, importListingsAction, inspectVonHalskyAction, refreshEmpikCarriersAction, saveMarketplaceAction } from '../../../actions';

export const metadata: Metadata = { title: 'Marketplace account' };

function Secret({ name, label, stored, hint }: { name: string; label: string; stored: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input name={name} type="password" autoComplete="off" placeholder={stored ? '•••••••• saved – leave blank to keep' : ''} />
    </Field>
  );
}

export default async function MarketplaceAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
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
  const type = (account?.type ?? typeParam) as 'shopify' | 'allegro' | 'empik' | 'vonhalsky';
  if (!MARKETPLACE_LABELS[type]) notFound();
  const stored = storedCredentialKeys(account?.credentials ?? null);
  const pub = publicCredentialFields(account?.credentials ?? null);
  const s = account?.settings ?? {};
  let empikList: { code: string; label: string }[] = [];
  let empikError: string | null = null;
  if (account && type === 'empik') {
    try {
      empikList = await empikCarriers(account.id);
    } catch (err) {
      empikError = err instanceof Error ? err.message : String(err);
    }
  }
  const lockerCarrier = empikList.length
    ? resolveEmpikCarrier([s.carrierCodes?.inpostLocker, EMPIK_CARRIER_CODES.inpostLocker], empikList, 'inpostLocker')?.code
    : s.carrierCodes?.inpostLocker;
  const courierCarrier = empikList.length
    ? resolveEmpikCarrier([s.carrierCodes?.inpostCourier, EMPIK_CARRIER_CODES.inpostCourier], empikList, 'inpostCourier')?.code
    : s.carrierCodes?.inpostCourier;
  const str = (key: string) => (typeof pub[key] === 'string' ? (pub[key] as string) : '');

  return (
    <div className="max-w-3xl">
      <Link href="/settings/integrations" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Integrations
      </Link>
      <Card>
        <CardHeader title={account ? `${account.name}` : `New ${MARKETPLACE_LABELS[type]} account`} />
        <CardBody>
          <ActionForm action={saveMarketplaceAction.bind(null, account?.id ?? null)} className="space-y-5">
            <input type="hidden" name="type" value={type} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" defaultValue={account?.name ?? `${MARKETPLACE_LABELS[type]} – main`} required />
              </Field>
              <Field label="History to import on first sync (days)">
                <Input name="initialSyncDays" type="number" min={1} max={90} defaultValue={s.initialSyncDays ?? 14} />
              </Field>
            </div>

            {type === 'shopify' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">Shopify connection</legend>
                <p className="text-xs text-slate-500">
                  Create an app in the Shopify Dev Dashboard, install it on the store, and paste its Client ID and secret. Scopes needed: read_orders,
                  read_products, read_locations, write_inventory, write_merchant_managed_fulfillment_orders. A legacy Admin API token (shpat_…) also works.
                </p>
                <Field label="Shop domain">
                  <Input name="shopDomain" defaultValue={str('shopDomain')} placeholder="my-shop.myshopify.com" required />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Secret name="clientId" label="Client ID" stored={stored.includes('clientId')} />
                  <Secret name="clientSecret" label="Client secret" stored={stored.includes('clientSecret')} hint="Also used to verify webhooks." />
                </div>
                <Secret name="accessToken" label="Legacy Admin API token (optional)" stored={stored.includes('accessToken') && !stored.includes('clientId')} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="API version">
                    <Input name="apiVersion" defaultValue={s.apiVersion ?? DEFAULT_SHOPIFY_API_VERSION} />
                  </Field>
                  <Field label="Location ID for stock (optional)" hint="Defaults to the first active location.">
                    <Input name="locationId" defaultValue={s.locationId ?? ''} placeholder="gid://shopify/Location/…" />
                  </Field>
                </div>
                <Field label="Note attributes that hold the Paczkomat code" hint="Comma separated; matched case-insensitively.">
                  <Input name="pickupPointKeys" defaultValue={(s.pickupPointKeys ?? DEFAULT_PICKUP_POINT_KEYS).join(', ')} />
                </Field>
                <Checkbox name="notifyCustomer" label="Email the buyer when tracking is added" defaultChecked={s.notifyCustomer ?? true} />
              </fieldset>
            )}

            {type === 'allegro' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">Allegro connection</legend>
                <p className="text-xs text-slate-500">
                  Register an app at apps.developer.allegro.pl (or the sandbox) with redirect URI{' '}
                  <code className="select-all">{`${env().APP_URL}${ALLEGRO_REDIRECT_PATH}`}</code>, save its Client ID and secret here, then press
                  “Connect Allegro” on the Integrations page.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Secret name="clientId" label="Client ID" stored={stored.includes('clientId')} />
                  <Secret name="clientSecret" label="Client secret" stored={stored.includes('clientSecret')} />
                </div>
                <Checkbox name="sandbox" label="Use the Allegro sandbox" defaultChecked={pub.sandbox === true} />
              </fieldset>
            )}

            {type === 'vonhalsky' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">InPost Von Halsky connection</legend>
                <p className="text-xs text-slate-500">
                  In the InPost Merchant Portal open Integrations → API, press “Create App” and tick exactly these permissions: Categories (read),
                  Offers (read), Offers (write), Orders (read), Orders (write). Copy the organisation id, the Client ID and the Client secret here
                  (the secret is shown only once). Create the app with the “Authorization Code” method and register this exact Redirect URL:{' '}
                  <code className="select-all">{`${env().APP_URL}${VON_HALSKY_REDIRECT_PATH}`}</code>. Save here, then press “Connect Von Halsky” on the
                  Integrations page and approve access at InPost.
                </p>
                <Field label="Organisation ID" hint="The brand/store created for this integration (a UUID).">
                  <Input name="organizationId" defaultValue={str('organizationId')} placeholder="00000000-0000-0000-0000-000000000000" required />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Secret name="clientId" label="Client ID" stored={stored.includes('clientId')} />
                  <Secret name="clientSecret" label="Client secret" stored={stored.includes('clientSecret')} />
                </div>
                <Checkbox name="sandbox" label="Use InPost's stage (test) environment" defaultChecked={pub.sandbox === true} />
                <p className="text-xs text-slate-500">
                  Shipments are made with your InPost account (labels), not here: InPost links the label to the order through the buyer’s e-mail.
                </p>
              </fieldset>
            )}

            {type === 'empik' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">Empik Marketplace connection</legend>
                <p className="text-xs text-slate-500">Empik runs on Mirakl. Generate an API key in the seller panel (My account → API key).</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Marketplace URL">
                    <Input name="baseUrl" defaultValue={str('baseUrl') || 'https://marketplace.empik.com'} required />
                  </Field>
                  <Secret name="apiKey" label="API key" stored={stored.includes('apiKey')} />
                  <Field label="Shop ID (optional)">
                    <Input name="shopId" defaultValue={str('shopId')} />
                  </Field>
                  {(
                    [
                      ['carrierCodeInpostLocker', 'Empik carrier for InPost Paczkomat labels', lockerCarrier, EMPIK_CARRIER_CODES.inpostLocker],
                      ['carrierCodeInpostCourier', 'Empik carrier for InPost courier labels', courierCarrier, EMPIK_CARRIER_CODES.inpostCourier],
                    ] as const
                  ).map(([name, label, selected, fallback]) =>
                    empikList.length ? (
                      <Field key={name} label={label} hint="From Empik's carrier list (SH21)">
                        <Select name={name} defaultValue={selected ?? ''}>
                          <option value="">Pick automatically</option>
                          {empikList.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.label} ({c.code})
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : (
                      <Field key={name} label={label} hint={`Empik's carrier code; leave blank for ${fallback}`}>
                        <Input name={name} defaultValue={selected ?? ''} placeholder={fallback} />
                      </Field>
                    ),
                  )}
                </div>
                <Checkbox name="autoAccept" label="Accept new orders automatically when stock covers them" defaultChecked={s.autoAccept ?? false} />
              </fieldset>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">Sync</legend>
              <Checkbox name="enabled" label="Sync orders from this account" defaultChecked={account?.enabled ?? true} />
              <Checkbox name="stockSyncEnabled" label="Keep stock in sync with the Inventory page" defaultChecked={account?.stockSyncEnabled ?? false} />
              <Checkbox name="stockDryRun" label="Dry run: log stock changes but don't send them" defaultChecked={account?.stockDryRun ?? true} />
            </fieldset>

            <SubmitButton>{account ? 'Save' : 'Create account'}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      {account && (
        <div className="mt-5 flex flex-wrap gap-2">
          {type === 'empik' && (
            <ActionForm action={refreshEmpikCarriersAction.bind(null, account.id)}>
              <SubmitButton variant="secondary">Refresh Empik carrier list</SubmitButton>
              {empikError && <p className="mt-1 text-sm text-red-700">Could not load Empik carriers: {empikError}</p>}
            </ActionForm>
          )}
          <ActionForm action={importListingsAction.bind(null, account.id)}>
            <SubmitButton variant="secondary">Import listings for stock sync</SubmitButton>
          </ActionForm>
          {type === 'vonhalsky' && (
            <ActionForm action={inspectVonHalskyAction.bind(null, account.id)}>
              <SubmitButton variant="secondary">Read InPost offer format (read-only)</SubmitButton>
            </ActionForm>
          )}
          <form action={deleteMarketplaceAction.bind(null, account.id)}>
            <SubmitButton variant="danger" confirm="Delete this account and all of its orders?">
              Delete account
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
