'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, Input, Select } from '@/components/ui';
import type { ActionResult } from '@/lib/action-result';
import { useT } from '@/lib/i18n/client';

interface Preset {
  id: string;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: string;
  inpostTemplate: string | null;
}

export interface LabelFormProps {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  carriers: { id: string; name: string; type: string; labelFormat: string; labelSize: string }[];
  services: Record<string, { id: string; name: string; requiresPickupPoint?: boolean }[]>;
  presets: Preset[];
  defaults: { carrierAccountId: string | null; service: string | null; presetId: string | null; ruleName: string | null };
  order: { codAmount: string | null; pickupPointId: string | null; currency: string; totalAmount: string };
}

export function LabelForm({ action, carriers, services, presets, defaults, order }: LabelFormProps) {
  const t = useT();
  const [carrierId, setCarrierId] = useState(defaults.carrierAccountId ?? carriers[0]?.id ?? '');
  const carrierServices = services[carrierId] ?? [];
  const [service, setService] = useState(defaults.service ?? carrierServices[0]?.id ?? '');
  const initialPreset = presets.find((p) => p.id === defaults.presetId) ?? presets[0];
  const [dims, setDims] = useState({
    lengthCm: String(initialPreset?.lengthCm ?? ''),
    widthCm: String(initialPreset?.widthCm ?? ''),
    heightCm: String(initialPreset?.heightCm ?? ''),
    weightKg: String(initialPreset?.weightKg ?? ''),
    inpostTemplate: initialPreset?.inpostTemplate ?? 'small',
  });
  const carrier = carriers.find((c) => c.id === carrierId);
  const needsPoint = carrierServices.find((s) => s.id === service)?.requiresPickupPoint;

  if (carriers.length === 0) {
    return <p className="text-sm text-slate-500">{t('No carrier account can ship this order. Add one in Settings → Integrations.')}</p>;
  }

  return (
    <ActionForm action={action} className="space-y-3">
      {defaults.ruleName && (
        <p className="text-xs text-slate-500">
          {t('Suggested by rule')} <span className="font-medium text-slate-700">{defaults.ruleName}</span>. {t('You can change anything below.')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('Carrier')}>
          <Select
            name="carrierAccountId"
            value={carrierId}
            onChange={(e) => {
              setCarrierId(e.target.value);
              setService(services[e.target.value]?.[0]?.id ?? '');
            }}
          >
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Service')}>
          <Select name="service" value={service} onChange={(e) => setService(e.target.value)}>
            {carrierServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {carrierServices.length === 0 && <option value="">{t('No services (check the account)')}</option>}
          </Select>
        </Field>
      </div>

      <Field label={t('Package')}>
        <Select
          defaultValue={initialPreset?.id}
          onChange={(e) => {
            const p = presets.find((x) => x.id === e.target.value);
            if (p)
              setDims({
                lengthCm: String(p.lengthCm),
                widthCm: String(p.widthCm),
                heightCm: String(p.heightCm),
                weightKg: String(p.weightKg),
                inpostTemplate: p.inpostTemplate ?? 'small',
              });
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(['lengthCm', 'widthCm', 'heightCm'] as const).map((k) => (
          <Field key={k} label={{ lengthCm: t('Length cm'), widthCm: t('Width cm'), heightCm: t('Height cm') }[k]}>
            <Input name={k} inputMode="numeric" value={dims[k]} onChange={(e) => setDims({ ...dims, [k]: e.target.value })} required />
          </Field>
        ))}
        <Field label={t('Weight kg')}>
          <Input name="weightKg" inputMode="decimal" value={dims.weightKg} onChange={(e) => setDims({ ...dims, weightKg: e.target.value })} required />
        </Field>
        <Field label={t('Locker size')}>
          <Select name="inpostTemplate" value={dims.inpostTemplate} onChange={(e) => setDims({ ...dims, inpostTemplate: e.target.value })}>
            <option value="small">{t('A (small)')}</option>
            <option value="medium">{t('B (medium)')}</option>
            <option value="large">{t('C (large)')}</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={needsPoint ? t('Pickup point (required)') : t('Pickup point')}>
          <Input name="pickupPointId" defaultValue={order.pickupPointId ?? ''} placeholder={t('e.g. KRA010')} required={needsPoint} />
        </Field>
        <Field label={t('COD ({currency})', { currency: order.currency })}>
          <Input name="codAmount" inputMode="decimal" defaultValue={order.codAmount ?? ''} placeholder={t('none')} />
        </Field>
        <Field label={t('Insurance ({currency})', { currency: order.currency })}>
          <Input name="insuranceAmount" inputMode="decimal" placeholder={t('none')} />
        </Field>
        <Field label={t('Label')}>
          <div className="flex gap-1.5">
            <Select name="labelFormat" defaultValue={carrier?.labelFormat ?? 'pdf'} key={`f-${carrierId}`}>
              <option value="pdf">PDF</option>
              <option value="zpl">ZPL</option>
            </Select>
            <Select name="labelSize" defaultValue={carrier?.labelSize ?? 'A6'} key={`s-${carrierId}`}>
              <option value="A6">A6</option>
              <option value="A4">A4</option>
            </Select>
          </div>
        </Field>
      </div>
      <SubmitButton pendingText={t('Requesting label…')}>{t('Create label')}</SubmitButton>
    </ActionForm>
  );
}
