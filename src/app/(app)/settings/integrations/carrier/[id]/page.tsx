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
import { listMarketplaceAccounts, publicCredentialFields, storedCredentialKeys } from '@/server/services/settings';
import { deleteCarrierAction, saveCarrierAction } from '../../../actions';

export const metadata: Metadata = { title: 'Carrier account' };

export default async function CarrierAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
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
  const type = (account?.type ?? typeParam) as 'inpost' | 'allegro_shipping';
  if (!CARRIER_LABELS[type]) notFound();
  const stored = storedCredentialKeys(account?.credentials ?? null);
  const pub = publicCredentialFields(account?.credentials ?? null);
  const allegroAccounts = (await listMarketplaceAccounts()).filter((a) => a.type === 'allegro');
  const sender = account?.sender;
  const s = account?.settings ?? {};

  return (
    <div className="max-w-3xl">
      <Link href="/settings/integrations" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Integrations
      </Link>
      <Card>
        <CardHeader title={account ? account.name : `New ${CARRIER_LABELS[type]} account`} />
        <CardBody>
          <ActionForm action={saveCarrierAction.bind(null, account?.id ?? null)} className="space-y-5">
            <input type="hidden" name="type" value={type} />
            <Field label="Name">
              <Input name="name" defaultValue={account?.name ?? CARRIER_LABELS[type]} required />
            </Field>

            {type === 'inpost' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">InPost ShipX</legend>
                <p className="text-xs text-slate-500">Generate the API token and find the organization ID in InPost Manager Paczek → My account → API.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="API token">
                    <Input name="apiToken" type="password" autoComplete="off" placeholder={stored.includes('apiToken') ? '•••••••• saved – leave blank to keep' : ''} />
                  </Field>
                  <Field label="Organization ID">
                    <Input name="organizationId" defaultValue={typeof pub.organizationId === 'string' ? pub.organizationId : ''} required />
                  </Field>
                  <Field label="How parcels reach InPost">
                    <Select name="sendingMethod" defaultValue={s.sendingMethod ?? 'dispatch_order'}>
                      <option value="dispatch_order">Courier picks them up</option>
                      <option value="parcel_locker">I drop them at a Paczkomat</option>
                      <option value="pop">I drop them at a PaczkoPunkt</option>
                    </Select>
                  </Field>
                  <Field label="Drop-off point" hint="The Paczkomat or PaczkoPunkt where you drop parcels, e.g. ZOF01M. Required when you drop them off yourself.">
                    <Input name="dropoffPoint" defaultValue={s.dropoffPoint ?? ''} placeholder="e.g. ZOF01M" />
                  </Field>
                </div>
                <Checkbox name="sandbox" label="Use the ShipX sandbox" defaultChecked={pub.sandbox === true} />
              </fieldset>
            )}

            {type === 'allegro_shipping' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">Allegro Delivery (Wysyłam z Allegro)</legend>
                <p className="text-xs text-slate-500">Uses the connection of an Allegro account; labels are billed by Allegro.</p>
                <Field label="Allegro account">
                  <Select name="marketplaceAccountId" defaultValue={account?.marketplaceAccountId ?? allegroAccounts[0]?.id ?? ''} required>
                    {allegroAccounts.length === 0 && <option value="">Add an Allegro account first</option>}
                    {allegroAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="IBAN for cash on delivery (usually not needed)" hint="Only for delivery services that pay COD by bank transfer. For most Allegro methods the money goes to your Allegro balance; leave this empty. If set, it must match your Allegro payout settings.">
                    <Input name="codIban" defaultValue={s.codIban ?? ''} placeholder="PL…" />
                  </Field>
                  <Field label="Account holder">
                    <Input name="codOwnerName" defaultValue={s.codOwnerName ?? ''} />
                  </Field>
                </div>
              </fieldset>
            )}

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">Sender (printed on labels)</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input name="senderName" defaultValue={sender?.name ?? ''} required />
                </Field>
                <Field label="Company">
                  <Input name="senderCompany" defaultValue={sender?.company ?? ''} />
                </Field>
                <Field label="Street and number" className="sm:col-span-2">
                  <Input name="senderStreet" defaultValue={sender?.street ?? ''} required />
                </Field>
                <Field label="Postal code">
                  <Input name="senderPostalCode" defaultValue={sender?.postalCode ?? ''} required />
                </Field>
                <Field label="City">
                  <Input name="senderCity" defaultValue={sender?.city ?? ''} required />
                </Field>
                <Field label="Country">
                  <Input name="senderCountryCode" defaultValue={sender?.countryCode ?? 'PL'} maxLength={2} />
                </Field>
                <Field label="Phone" hint="With country code, e.g. +48600123456">
                  <Input name="senderPhone" defaultValue={sender?.phone ?? ''} required />
                </Field>
                <Field label="Email" className="sm:col-span-2">
                  <Input name="senderEmail" type="email" defaultValue={sender?.email ?? ''} required />
                </Field>
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-2 gap-3 sm:w-1/2">
              <Field label="Label format">
                <Select name="labelFormat" defaultValue={s.labelFormat ?? 'pdf'}>
                  <option value="pdf">PDF</option>
                  <option value="zpl">ZPL (thermal printer)</option>
                </Select>
              </Field>
              <Field label="Label size">
                <Select name="labelSize" defaultValue={s.labelSize ?? 'A6'}>
                  <option value="A6">A6</option>
                  <option value="A4">A4</option>
                </Select>
              </Field>
            </fieldset>
            <Checkbox
              name="productsInReference"
              label="Add product names to the label reference (after the order number)"
              defaultChecked={s.productsInReference !== false}
            />
            <Checkbox name="enabled" label="Enabled" defaultChecked={account?.enabled ?? true} />
            <div>
              <SubmitButton>{account ? 'Save' : 'Create account'}</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      {account && (
        <form action={deleteCarrierAction.bind(null, account.id)} className="mt-5">
          <SubmitButton variant="danger" confirm="Delete this carrier account? Its shipping rules are deleted too.">
            Delete account
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
