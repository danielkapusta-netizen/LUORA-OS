import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Select } from '@/components/ui';
import { MARKETPLACE_LABELS, SERVICE_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { CarrierAccount, PackagePreset, ShippingRule } from '@/server/db/schema';
import { BUYER_CHOICE } from '@/server/integrations/carriers/allegro-shipping/adapter';
import { INPOST_SERVICES } from '@/server/integrations/carriers/inpost/adapter';
import { describeConditions } from '@/server/services/routing';
import { loadRoutingData } from '@/server/services/shipping';
import { createDefaultRulesAction, deletePresetAction, deleteRuleAction, savePresetAction, saveRuleAction } from '../actions';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Shipping rules') };
}

function routeOptions(carriers: CarrierAccount[]) {
  return carriers.flatMap((c) =>
    (c.type === 'inpost' ? INPOST_SERVICES : [{ id: BUYER_CHOICE, name: "Buyer's delivery method" }]).map((s) => ({
      value: `${c.id}|${s.id}`,
      label: `${c.name} – ${s.name}`,
    })),
  );
}

async function RuleForm({ rule, carriers, presets }: { rule?: ShippingRule; carriers: CarrierAccount[]; presets: PackagePreset[] }) {
  const t = await getT();
  const c = rule?.conditions ?? {};
  const yesNo = (v: boolean | undefined) => (v === undefined ? '' : v ? 'yes' : 'no');
  return (
    <ActionForm action={saveRuleAction.bind(null, rule?.id ?? null)} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label={t('Name')} className="sm:col-span-3">
          <Input name="name" defaultValue={rule?.name ?? ''} required />
        </Field>
        <Field label={t('Priority')} hint={t('Lower runs first')}>
          <Input name="priority" type="number" defaultValue={rule?.priority ?? 100} />
        </Field>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">{t('When the order…')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="space-y-1 text-sm">
            <span className="text-xs text-slate-500">{t('comes from (none = any)')}</span>
            {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
              <Checkbox key={value} name="marketplaces" value={value} label={label} defaultChecked={c.marketplaces?.includes(value as 'shopify')} className="flex" />
            ))}
          </div>
          <Field label={t('delivery method contains')}>
            <Input name="deliveryMethodContains" defaultValue={c.deliveryMethodContains ?? ''} placeholder={t('e.g. Paczkomat')} />
          </Field>
          <Field label={t('has a pickup point')}>
            <Select name="hasPickupPoint" defaultValue={yesNo(c.hasPickupPoint)}>
              <option value="">{t('doesn’t matter')}</option>
              <option value="yes">{t('yes')}</option>
              <option value="no">{t('no')}</option>
            </Select>
          </Field>
          <Field label={t('is cash on delivery')}>
            <Select name="cod" defaultValue={yesNo(c.cod)}>
              <option value="">{t('doesn’t matter')}</option>
              <option value="yes">{t('yes')}</option>
              <option value="no">{t('no')}</option>
            </Select>
          </Field>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">{t('…ship it with')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select name="route" defaultValue={rule ? `${rule.carrierAccountId}|${rule.service}` : undefined} required>
            {routeOptions(carriers).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select name="packagePresetId" defaultValue={rule?.packagePresetId ?? ''}>
            <option value="">{t('Default package')}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Checkbox name="enabled" label={t('Enabled')} defaultChecked={rule?.enabled ?? true} />
      <div>
        <SubmitButton variant={rule ? 'secondary' : 'primary'}>{rule ? t('Save rule') : t('Add rule')}</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function PresetForm({ preset }: { preset?: PackagePreset }) {
  const t = await getT();
  return (
    <ActionForm action={savePresetAction.bind(null, preset?.id ?? null)} className="flex flex-wrap items-end gap-2">
      <Field label={t('Name')} className="w-full sm:w-56">
        <Input name="name" defaultValue={preset?.name ?? ''} required />
      </Field>
      <Field label={t('L cm')} className="w-20">
        <Input name="lengthCm" inputMode="numeric" defaultValue={preset?.lengthCm ?? ''} required />
      </Field>
      <Field label={t('W cm')} className="w-20">
        <Input name="widthCm" inputMode="numeric" defaultValue={preset?.widthCm ?? ''} required />
      </Field>
      <Field label={t('H cm')} className="w-20">
        <Input name="heightCm" inputMode="numeric" defaultValue={preset?.heightCm ?? ''} required />
      </Field>
      <Field label={t('kg')} className="w-24">
        <Input name="weightKg" inputMode="decimal" defaultValue={preset?.weightKg ?? ''} required />
      </Field>
      <Field label={t('Locker size')} className="w-24">
        <Select name="inpostTemplate" defaultValue={preset?.inpostTemplate ?? 'small'}>
          <option value="small">A</option>
          <option value="medium">B</option>
          <option value="large">C</option>
        </Select>
      </Field>
      <div className="flex h-9 items-center gap-3">
        <Checkbox name="isDefault" label={t('Default')} defaultChecked={preset?.isDefault ?? false} />
        <SubmitButton size="sm" variant={preset ? 'secondary' : 'primary'}>
          {preset ? 'Save' : 'Add'}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export default async function ShippingSettingsPage() {
  const t = await getT();
  const user = await requireUser();
  const { rules, carriers, presets } = await loadRoutingData();
  const admin = user.role === 'admin';
  const carrierName = (id: string) => carriers.find((c) => c.id === id)?.name ?? t('deleted carrier');

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={t('Shipping rules')}
          description={t('The first enabled rule that matches an order picks its carrier, service and package. Staff can still change it per order.')}
          actions={
            admin &&
            rules.length === 0 && (
              <ActionForm action={createDefaultRulesAction}>
                <SubmitButton size="sm">{t('Add the default rules')}</SubmitButton>
              </ActionForm>
            )
          }
        />
        {rules.length === 0 ? (
          <EmptyState title={t('No rules yet')}>{t('Without rules every label is set up by hand.')}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rules.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <Badge>{r.priority}</Badge>
                    <span className="font-medium">{r.name}</span>
                    {!r.enabled && <Badge tone="gray">{t('disabled')}</Badge>}
                    {!carriers.find((c) => c.id === r.carrierAccountId)?.configured && <Badge tone="red">{t('carrier not configured, rule skipped')}</Badge>}
                    <span className="text-slate-500">
                      {t('if {conditions}', { conditions: describeConditions(r.conditions, t) })} → {carrierName(r.carrierAccountId)}, {SERVICE_LABELS[r.service] ? t(SERVICE_LABELS[r.service]) : r.service}
                    </span>
                  </summary>
                  {admin && (
                    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                      <RuleForm rule={r} carriers={carriers} presets={presets} />
                      <ActionForm action={deleteRuleAction.bind(null, r.id)}>
                        <SubmitButton size="sm" variant="danger" confirm={t('Delete this rule?')}>
                          {t('Delete rule')}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
        {admin && carriers.length > 0 && (
          <CardBody className="border-t border-slate-100">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">{t('Add a rule')}</summary>
              <div className="mt-3">
                <RuleForm carriers={carriers} presets={presets} />
              </div>
            </details>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title={t('Package presets')} description={t('Parcel sizes offered when creating labels. Locker size is used for InPost Paczkomat labels.')} />
        <CardBody className="space-y-3">
          {presets.map((p) => (
            <div key={p.id} className="flex flex-wrap items-end gap-2 border-b border-slate-100 pb-3">
              {admin ? (
                <>
                  <PresetForm preset={p} />
                  <ActionForm action={deletePresetAction.bind(null, p.id)} showOk={false} className="flex h-9 items-center">
                    <SubmitButton size="sm" variant="ghost" confirm={t('Delete this package?')}>
                      {t('Delete')}
                    </SubmitButton>
                  </ActionForm>
                </>
              ) : (
                <p className="text-sm">
                  {p.name}: {p.lengthCm}×{p.widthCm}×{p.heightCm} cm, {p.weightKg} kg
                </p>
              )}
            </div>
          ))}
          {admin && (
            <div>
              <p className="mb-2 text-sm font-medium">{t('New package')}</p>
              <PresetForm />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
