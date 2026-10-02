import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, CardBody, CardHeader, Checkbox, Field, Input } from '@/components/ui';
import { requireAdmin } from '@/server/auth';
import { loadAccounting } from '@/server/services/invoicing';
import { saveAccountingAction, testAccountingAction } from '../../accounting/actions';

export const metadata: Metadata = { title: 'Accounting settings' };

const percent = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 10000) / 100));

export default async function AccountingSettingsPage() {
  await requireAdmin();
  const { enabled, settings: s, login, hasKey } = await loadAccounting();
  const oss = Object.entries(s.ossRates ?? {})
    .map(([country, r]) => `${country}=${percent(r)}`)
    .join(', ');

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader
          title="ifirma"
          description="Invoices are issued in ifirma for Allegro and Empik orders whose buyer asked for one, then attached to the order on the marketplace."
          actions={
            hasKey && (
              <ActionForm action={testAccountingAction}>
                <SubmitButton size="sm" variant="secondary" pendingText="Checking…">
                  Test connection
                </SubmitButton>
              </ActionForm>
            )
          }
        />
        <CardBody>
          <ActionForm action={saveAccountingAction} className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">Connection</legend>
              <p className="text-xs text-slate-500">
                In ifirma open Konfiguracja → API, generate the <span className="font-medium">faktura</span> key and paste it here with your ifirma login.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="ifirma login">
                  <Input name="login" defaultValue={login ?? ''} autoComplete="off" />
                </Field>
                <Field label="API key “faktura”">
                  <Input name="invoiceKey" type="password" autoComplete="off" placeholder={hasKey ? '•••••••• saved – leave blank to keep' : 'e.g. EAB0D8ACF3308F3B'} />
                </Field>
              </div>
              <Checkbox name="enabled" label="Invoicing is on" defaultChecked={enabled} />
            </fieldset>

            <fieldset className="flex flex-col items-start gap-2">
              <legend className="mb-1 text-sm font-semibold">What happens automatically</legend>
              <Checkbox name="autoOnShipped" label="Issue the invoice when a requested order becomes Shipped (packed + tracking sent)" defaultChecked={s.autoOnShipped} />
              <Checkbox name="uploadAllegro" label="Attach the invoice to the Allegro order" defaultChecked={s.uploadAllegro} />
              <Checkbox name="uploadEmpik" label="Attach the invoice to the Empik order" defaultChecked={s.uploadEmpik} />
              <Checkbox name="sendB2bToKsef" label="Send invoices for companies (with a NIP) to KSeF" defaultChecked={s.sendB2bToKsef} />
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">On the invoice</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Numbering series" hint="Leave empty for the default series in ifirma.">
                  <Input name="numberingSeries" defaultValue={s.numberingSeries ?? ''} />
                </Field>
                <Field label="Place of issue">
                  <Input name="placeOfIssue" defaultValue={s.placeOfIssue ?? ''} placeholder="e.g. Warszawa" />
                </Field>
                <Field label="Issued by (signature)">
                  <Input name="issuerSignature" defaultValue={s.issuerSignature ?? ''} />
                </Field>
                <Field label="Polish VAT rate, %" hint="For products and shipping on domestic invoices.">
                  <Input name="defaultVatRate" inputMode="decimal" defaultValue={percent(s.defaultVatRate)} />
                </Field>
                <Field label="OSS VAT rates, % (optional)" hint="Only to override ifirma's standard rate per country, e.g. CZ=21, HU=27." className="sm:col-span-2">
                  <Input name="ossRates" defaultValue={oss} placeholder="CZ=21, HU=27" />
                </Field>
              </div>
            </fieldset>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
