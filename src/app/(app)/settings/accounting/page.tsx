import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, CardBody, CardHeader, Checkbox, Field, Input } from '@/components/ui';
import { requireAdmin } from '@/server/auth';
import { loadAccounting } from '@/server/services/invoicing';
import { saveAccountingAction, testAccountingAction } from '../../accounting/actions';
import { msg } from '@/lib/i18n/msg';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Accounting settings') };
}

const MODES = [
  { value: 'manual', label: msg('Manual'), hint: msg('Nothing is issued until you press “Create invoice” on the Accounting page or on the order.') },
  { value: 'auto', label: msg('Automatic'), hint: msg('The invoice is issued as soon as a requested order becomes Shipped (packed + tracking sent).') },
] as const;

const percent = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 10000) / 100));

export default async function AccountingSettingsPage() {
  const t = await getT();
  await requireAdmin();
  const { enabled, settings: s, login, hasKey } = await loadAccounting();
  const oss = Object.entries(s.ossRates ?? {})
    .map(([country, r]) => `${country}=${percent(r)}`)
    .join(', ');

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader
          title={t('ifirma')}
          description={t('Invoices are issued in ifirma for Allegro, Empik and HEBE orders whose buyer asked for one, then attached to the order on the marketplace.')}
          actions={
            hasKey && (
              <ActionForm action={testAccountingAction}>
                <SubmitButton size="sm" variant="secondary" pendingText={t('Checking…')}>
                  {t('Test connection')}
                </SubmitButton>
              </ActionForm>
            )
          }
        />
        <CardBody>
          <ActionForm action={saveAccountingAction} className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">{t('Connection')}</legend>
              <p className="text-xs text-slate-500">
                {t('In ifirma open Konfiguracja → API, generate the “faktura” key and paste it here with your ifirma login.')}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('ifirma login')}>
                  <Input name="login" defaultValue={login ?? ''} autoComplete="off" />
                </Field>
                <Field label={t('API key “faktura”')}>
                  <Input name="invoiceKey" type="password" autoComplete="off" placeholder={hasKey ? t('•••••••• saved – leave blank to keep') : t('e.g. EAB0D8ACF3308F3B')} />
                </Field>
              </div>
              <Checkbox name="enabled" label={t('Invoicing is on')} defaultChecked={enabled} />
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-sm font-semibold">{t('Invoicing mode')}</legend>
              <p className="mb-2 text-xs text-slate-500">{t('Start with Manual and check the first few invoices in ifirma, then switch to Automatic.')}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MODES.map((m) => (
                  <label
                    key={m.value}
                    className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                  >
                    <input type="radio" name="mode" value={m.value} defaultChecked={(s.autoOnShipped ? 'auto' : 'manual') === m.value} className="mt-0.5 size-4 text-brand-600" />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{t(m.label)}</span>
                      <span className="block text-xs text-slate-500">{t(m.hint)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col items-start gap-2">
              <legend className="mb-1 text-sm font-semibold">{t('After an invoice is issued')}</legend>
              <Checkbox name="uploadAllegro" label={t('Attach the invoice to the Allegro order')} defaultChecked={s.uploadAllegro} />
              <Checkbox name="uploadEmpik" label={t('Attach the invoice to the Empik order')} defaultChecked={s.uploadEmpik} />
              <Checkbox name="uploadHebe" label={t('Attach the invoice to the HEBE order')} defaultChecked={s.uploadHebe} />
              <Checkbox name="sendB2bToKsef" label={t('Send invoices for companies (with a NIP) to KSeF')} defaultChecked={s.sendB2bToKsef} />
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">{t('On the invoice')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('Numbering series')} hint={t('Leave empty for the default series in ifirma.')}>
                  <Input name="numberingSeries" defaultValue={s.numberingSeries ?? ''} />
                </Field>
                <Field label={t('Place of issue')}>
                  <Input name="placeOfIssue" defaultValue={s.placeOfIssue ?? ''} placeholder={t('e.g. Warszawa')} />
                </Field>
                <Field label={t('Issued by (signature)')}>
                  <Input name="issuerSignature" defaultValue={s.issuerSignature ?? ''} />
                </Field>
                <Field label={t('Polish VAT rate, %')} hint={t('For products and shipping on domestic invoices.')}>
                  <Input name="defaultVatRate" inputMode="decimal" defaultValue={percent(s.defaultVatRate)} />
                </Field>
                <Field label={t('OSS VAT rates, % (optional)')} hint={t('Only to override ifirma\'s standard rate per country, e.g. CZ=21, HU=27.')} className="sm:col-span-2">
                  <Input name="ossRates" defaultValue={oss} placeholder={t('CZ=21, HU=27')} />
                </Field>
              </div>
            </fieldset>
            <SubmitButton>{t('Save')}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
