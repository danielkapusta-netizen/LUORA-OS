import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, Select } from '@/components/ui';
import { CARRIER_LABELS } from '@/lib/utils';
import { requireAdmin } from '@/server/auth';
import type { CarrierAccount } from '@/server/db/schema';
import { loadCarrierAccount } from '@/server/services/accounts';
import { carrierRuleNames, listMarketplaceAccounts, publicCredentialFields, storedCredentialKeys } from '@/server/services/settings';
import { addDpdEmpikRuleAction, deleteCarrierAction, saveCarrierAction } from '../../../actions';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Carrier account') };
}

export default async function CarrierAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
  const t = await getT();
  await requireAdmin();
  const { id } = await params;
  const { type: typeParam } = await searchParams;
  let account: CarrierAccount | null = null;
  if (id !== 'new') {
    try {
      account = await loadCarrierAccount(id);
    } catch {
      notFound();
    }
  }
  const type = (account?.type ?? typeParam) as 'inpost' | 'allegro_shipping' | 'dpd';
  if (!CARRIER_LABELS[type]) notFound();
  const stored = storedCredentialKeys(account?.credentials ?? null);
  const pub = publicCredentialFields(account?.credentials ?? null);
  const allegroAccounts = (await listMarketplaceAccounts()).filter((a) => a.type === 'allegro');
  const sender = account?.sender;
  const rules = account?.type === 'dpd' ? await carrierRuleNames(account.id) : [];
  const s = account?.settings ?? {};

  return (
    <div className="max-w-3xl">
      <Link href="/settings/integrations" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {t('Integrations')}
      </Link>
      <Card>
        <CardHeader title={account ? account.name : t('New {carrier} account', { carrier: CARRIER_LABELS[type] })} />
        <CardBody>
          <ActionForm action={saveCarrierAction.bind(null, account?.id ?? null)} className="space-y-5">
            <input type="hidden" name="type" value={type} />
            <Field label={t('Name')}>
              <Input name="name" defaultValue={account?.name ?? CARRIER_LABELS[type]} required />
            </Field>

            {type === 'inpost' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('InPost ShipX')}</legend>
                <p className="text-xs text-slate-500">{t('Generate the API token and find the organization ID in InPost Manager Paczek → My account → API.')}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('API token')}>
                    <Input name="apiToken" type="password" autoComplete="off" placeholder={stored.includes('apiToken') ? t('•••••••• saved – leave blank to keep') : ''} />
                  </Field>
                  <Field label={t('Organization ID')}>
                    <Input name="organizationId" defaultValue={typeof pub.organizationId === 'string' ? pub.organizationId : ''} required />
                  </Field>
                  <Field label={t('How parcels reach InPost')}>
                    <Select name="sendingMethod" defaultValue={s.sendingMethod ?? 'dispatch_order'}>
                      <option value="dispatch_order">{t('Courier picks them up')}</option>
                      <option value="parcel_locker">{t('I drop them at a Paczkomat')}</option>
                      <option value="pop">{t('I drop them at a PaczkoPunkt')}</option>
                    </Select>
                  </Field>
                  <Field label={t('Drop-off point')} hint={t('The Paczkomat or PaczkoPunkt where you drop parcels, e.g. ZOF01M. Required when you drop them off yourself.')}>
                    <Input name="dropoffPoint" defaultValue={s.dropoffPoint ?? ''} placeholder={t('e.g. ZOF01M')} />
                  </Field>
                </div>
                <Checkbox name="sandbox" label={t('Use the ShipX sandbox')} defaultChecked={pub.sandbox === true} />
              </fieldset>
            )}

            {type === 'dpd' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('DPD web services (DPDServices)')}</legend>
                <p className="text-xs text-slate-500">
                  {t('Enter the web-service access DPD sent you. Create one account for your own DPD contract and a second one for parcels under the Empik agreement (Empik salons): each has its own login and FID.')}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('Login')}>
                    <Input name="login" defaultValue={typeof pub.login === 'string' ? pub.login : ''} autoComplete="off" required />
                  </Field>
                  <Field label={t('Password')}>
                    <Input name="password" type="password" autoComplete="new-password" placeholder={stored.includes('password') ? t('•••••••• saved – leave blank to keep') : ''} />
                  </Field>
                  <Field label={t('Master FID')}>
                    <Input name="masterFid" inputMode="numeric" defaultValue={typeof pub.masterFid === 'string' ? pub.masterFid : ''} required />
                  </Field>
                  <Field label={t('FID parcels are sent from')} hint={t('The “fidy DPDServices” number; usually the same as the master FID.')}>
                    <Input name="fid" inputMode="numeric" defaultValue={typeof pub.fid === 'string' ? pub.fid : ''} required />
                  </Field>
                </div>
                <p className="text-xs text-slate-500">{t('The courier is ordered from Orders → Courier pickup, where the handover protocol is printed too.')}</p>
              </fieldset>
            )}

            {type === 'allegro_shipping' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('Allegro Delivery (Wysyłam z Allegro)')}</legend>
                <p className="text-xs text-slate-500">{t('Uses the connection of an Allegro account; labels are billed by Allegro.')}</p>
                <Field label={t('Allegro account')}>
                  <Select name="marketplaceAccountId" defaultValue={account?.marketplaceAccountId ?? allegroAccounts[0]?.id ?? ''} required>
                    {allegroAccounts.length === 0 && <option value="">{t('Add an Allegro account first')}</option>}
                    {allegroAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('IBAN for cash on delivery (usually not needed)')} hint={t('Only for delivery services that pay COD by bank transfer. For most Allegro methods the money goes to your Allegro balance; leave this empty. If set, it must match your Allegro payout settings.')}>
                    <Input name="codIban" defaultValue={s.codIban ?? ''} placeholder={t('PL…')} />
                  </Field>
                  <Field label={t('Account holder')}>
                    <Input name="codOwnerName" defaultValue={s.codOwnerName ?? ''} />
                  </Field>
                </div>
              </fieldset>
            )}

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">{t('Sender (printed on labels)')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('Name')}>
                  <Input name="senderName" defaultValue={sender?.name ?? ''} required />
                </Field>
                <Field label={t('Company')}>
                  <Input name="senderCompany" defaultValue={sender?.company ?? ''} />
                </Field>
                <Field label={t('Street and number')} className="sm:col-span-2">
                  <Input name="senderStreet" defaultValue={sender?.street ?? ''} required />
                </Field>
                <Field label={t('Postal code')}>
                  <Input name="senderPostalCode" defaultValue={sender?.postalCode ?? ''} required />
                </Field>
                <Field label={t('City')}>
                  <Input name="senderCity" defaultValue={sender?.city ?? ''} required />
                </Field>
                <Field label={t('Country')}>
                  <Input name="senderCountryCode" defaultValue={sender?.countryCode ?? 'PL'} maxLength={2} />
                </Field>
                <Field label={t('Phone')} hint={t('With country code, e.g. +48600123456')}>
                  <Input name="senderPhone" defaultValue={sender?.phone ?? ''} required />
                </Field>
                <Field label={t('Email')} className="sm:col-span-2">
                  <Input name="senderEmail" type="email" defaultValue={sender?.email ?? ''} required />
                </Field>
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-2 gap-3 sm:w-1/2">
              <Field label={t('Label format')}>
                <Select name="labelFormat" defaultValue={s.labelFormat ?? 'pdf'}>
                  <option value="pdf">PDF</option>
                  <option value="zpl">{t('ZPL (thermal printer)')}</option>
                </Select>
              </Field>
              <Field label={t('Label size')}>
                <Select name="labelSize" defaultValue={s.labelSize ?? 'A6'}>
                  <option value="A6">A6</option>
                  <option value="A4">A4</option>
                </Select>
              </Field>
            </fieldset>
            <Checkbox
              name="productsInReference"
              label={t('Add product names to the label reference (after the order number)')}
              defaultChecked={s.productsInReference !== false}
            />
            <Checkbox name="enabled" label={t('Enabled')} defaultChecked={account?.enabled ?? true} />
            <div>
              <SubmitButton>{account ? t('Save') : t('Create account')}</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      {account?.type === 'dpd' && (
        <Card className="mt-5">
          <CardHeader
            title={t('Send Empik orders with this account')}
            description={t('Adds a shipping rule ahead of the InPost Paczkomat rule. Empik courier orders stay on InPost courier.')}
          />
          <CardBody className="flex flex-wrap gap-2">
            {rules.length === 0 ? (
              <p className="w-full text-sm text-amber-800">{t('No orders are sent with this account yet: press a button below. Until then Empik DPD orders wait without a label.')}</p>
            ) : (
              <p className="w-full text-sm text-slate-600">{t('Rules using this account: {rules}', { rules: rules.join(', ') })}</p>
            )}
            <ActionForm action={addDpdEmpikRuleAction.bind(null, account.id, 'pickup')}>
              <SubmitButton variant="secondary">{t('Route Empik “DPD PICKUP” orders here')}</SubmitButton>
            </ActionForm>
            <ActionForm action={addDpdEmpikRuleAction.bind(null, account.id, 'salon')}>
              <SubmitButton variant="secondary">{t('Route Empik salon orders here (Empik agreement)')}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
      {account && (
        <form action={deleteCarrierAction.bind(null, account.id)} className="mt-5">
          <SubmitButton variant="danger" confirm={t('Delete this carrier account? Its shipping rules are deleted too.')}>
            {t('Delete account')}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
