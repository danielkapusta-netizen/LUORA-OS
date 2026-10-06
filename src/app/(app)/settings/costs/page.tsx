import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Select, Textarea, td, th } from '@/components/ui';
import { cn, formatMoney, MARKETPLACE_LABELS } from '@/lib/utils';
import { requireAdmin } from '@/server/auth';
import { costHistory, filterCostRows, LABEL_COST_SERVICES, listCostRows, loadAnalyticsSettings } from '@/server/services/costs';
import { loadAccounting } from '@/server/services/invoicing';
import {
  deleteProductCostAction,
  pasteCostsAction,
  saveProductCostAction,
  saveProfitSettingsAction,
  sheetCostsAction,
  shopifyCostsAction,
} from './actions';

export const metadata: Metadata = { title: 'Costs & margins' };

/** The Apps Script behind the Luora Analytics sheet. */
const LUORA_ANALYTICS_SHEET =
  'https://script.google.com/macros/s/AKfycbxM8GUKKRaprp8MVAP7V5fL1JnBA6l-X8DdKUJsW_y7XGIjsfeo4GBAESTrwB73nB3Fnw/exec';

const pct = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 10000) / 100));
const SOURCES: Record<string, string> = { manual: 'entered', import: 'pasted', sheet: 'sheet', shopify: 'Shopify' };

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ q?: string; missing?: string; history?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const missing = params.missing === '1';
  const [settings, accounting, allRows] = await Promise.all([loadAnalyticsSettings(), loadAccounting(), listCostRows()]);
  const rows = filterCostRows(allRows, { q: params.q, missing });
  const history = params.history ? await costHistory(params.history) : [];
  const withCost = allRows.filter((r) => r.cost).length;
  const revenue = allRows.reduce((s, r) => s + r.revenue90, 0);
  const covered = allRows.filter((r) => r.cost).reduce((s, r) => s + r.revenue90, 0);
  const vat = accounting.settings.defaultVatRate ?? 0.23;
  const link = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: params.q, missing: missing ? '1' : undefined, ...next })) if (v) q.set(k, v);
    const s = q.toString();
    return `/settings/costs${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="How profit is calculated"
          description={
            <>
              Profit = revenue without VAT − marketplace fees − product cost − label and packaging + shipping paid by the buyer − refunds. VAT rates come from{' '}
              <Link href="/settings/accounting" className="underline">
                Accounting
              </Link>{' '}
              (Polish rate {pct(vat)}%, OSS rates for other EU countries).
            </>
          }
        />
        <CardBody>
          <ActionForm action={saveProfitSettingsAction} className="space-y-5">
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Marketplace fees when the marketplace reports none</legend>
              <p className="mb-2 text-xs text-slate-500">
                Real fees are read from Allegro billing, Empik commissions and Shopify Payments. These rates (% of the gross price) are only used for orders
                without a reported fee yet, and such orders are marked as estimated.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['allegro', 'empik', 'shopify', 'vonhalsky'] as const).map((m) => (
                  <Field key={m} label={`${MARKETPLACE_LABELS[m]}, %`}>
                    <Input name={`commission_${m}`} inputMode="decimal" defaultValue={pct(settings.fallbackCommission[m])} />
                  </Field>
                ))}
              </div>
              <Checkbox
                className="mt-3"
                name="feesVatDeductible"
                label="Fees are invoiced with VAT that the company deducts (count them without VAT)"
                defaultChecked={settings.feesVatDeductible}
              />
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Shipping costs per parcel (PLN, without VAT)</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {LABEL_COST_SERVICES.map((s) => (
                  <Field key={s.key} label={s.label} hint={'hint' in s ? s.hint : undefined}>
                    <Input name={`label_${s.key}`} inputMode="decimal" defaultValue={settings.labelCosts[s.key] ?? ''} />
                  </Field>
                ))}
                <Field label="Other parcels" hint="Labels bought outside Luora, and past orders.">
                  <Input name="defaultLabelCost" inputMode="decimal" defaultValue={settings.defaultLabelCost} />
                </Field>
                <Field label="Packaging">
                  <Input name="packagingCost" inputMode="decimal" defaultValue={settings.packagingCost} />
                </Field>
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Margin targets (% of gross revenue)</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Target" hint="Used for price recommendations.">
                  <Input name="targetMargin" inputMode="decimal" defaultValue={pct(settings.targetMargin)} />
                </Field>
                <Field label="Healthy from">
                  <Input name="healthyMargin" inputMode="decimal" defaultValue={pct(settings.healthyMargin)} />
                </Field>
                <Field label="Thin from">
                  <Input name="thinMargin" inputMode="decimal" defaultValue={pct(settings.thinMargin)} />
                </Field>
                <Field label="Critical below">
                  <Input name="criticalMargin" inputMode="decimal" defaultValue={pct(settings.criticalMargin)} />
                </Field>
              </div>
            </fieldset>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Product costs"
          description="Landed cost of one unit in PLN without VAT: purchase price + freight + duty. A cost applies from its date on, so changing it never rewrites past margins."
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              <span className="font-semibold">{withCost}</span> of {allRows.length} products have a cost
            </span>
            <span>
              <span className="font-semibold">{revenue > 0 ? Math.round((covered / revenue) * 100) : 0}%</span> of the last 90 days&apos; revenue is covered
            </span>
          </div>
          {allRows.length === 0 && (
            <Alert tone="blue">
              No products yet. Products come from Shopify: use “Import listings for stock sync” on the Shopify account in{' '}
              <Link href="/settings/integrations" className="underline">
                Integrations
              </Link>
              .
            </Alert>
          )}
          <form className="flex flex-wrap items-end gap-2" action="/settings/costs">
            <Field label="Search" className="w-72">
              <Input name="q" defaultValue={params.q ?? ''} placeholder="Name, SKU, EAN or brand" />
            </Field>
            <Checkbox name="missing" value="1" label="Only products without a cost" defaultChecked={missing} />
            <SubmitButton variant="secondary" size="sm">
              Filter
            </SubmitButton>
          </form>
        </CardBody>
        {rows.length === 0 ? (
          allRows.length > 0 && <EmptyState title={missing ? 'Every product has a cost' : 'No product matches'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-y border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>Product</th>
                  <th className={cn(th, 'text-right')}>Sold, 90 days</th>
                  <th className={cn(th, 'text-right')}>Avg net price</th>
                  <th className={th}>Current cost</th>
                  <th className={th}>Set cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const netPrice = r.units90 > 0 ? r.revenue90 / r.units90 / (1 + vat) : null;
                  const share = netPrice && r.cost ? Number(r.cost.unitCost) / netPrice : null;
                  return (
                    <tr key={r.product.id} id={r.product.id}>
                      <td className={td}>
                        <div className="flex items-start gap-3">
                          {r.product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.product.imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <div className="size-10 shrink-0 rounded-lg bg-slate-100" />
                          )}
                          <div className="min-w-0">
                            <p className="max-w-md truncate font-medium text-slate-900" title={r.product.name}>
                              {r.product.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {r.product.sku}
                              {r.product.brand && ` · ${r.product.brand}`}
                              {r.product.ean && ` · ${r.product.ean}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={cn(td, 'text-right whitespace-nowrap')}>
                        {r.units90 > 0 ? (
                          <>
                            {r.units90} pcs
                            <span className="block text-xs text-slate-500">{formatMoney(r.revenue90)}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className={cn(td, 'text-right whitespace-nowrap')}>{netPrice ? formatMoney(netPrice) : <span className="text-slate-400">–</span>}</td>
                      <td className={cn(td, 'whitespace-nowrap')}>
                        {r.cost ? (
                          <>
                            <span className="font-medium">{formatMoney(Number(r.cost.unitCost))}</span>
                            {share !== null && (
                              <Badge tone={share > 0.7 ? 'red' : share > 0.55 ? 'amber' : 'green'} className="ml-1.5">
                                {Math.round(share * 100)}% of price
                              </Badge>
                            )}
                            <span className="block text-xs text-slate-500">
                              {r.cost.effectiveFrom === '2000-01-01' ? 'always' : `from ${r.cost.effectiveFrom}`} · {SOURCES[r.cost.source] ?? r.cost.source}
                              {r.entries > 1 && (
                                <>
                                  {' · '}
                                  <Link href={`${link({ history: r.product.id })}#${r.product.id}`} className="underline">
                                    {r.entries} entries
                                  </Link>
                                </>
                              )}
                            </span>
                          </>
                        ) : (
                          <Badge tone="amber">No cost</Badge>
                        )}
                        {params.history === r.product.id && (
                          <ul className="mt-2 space-y-1 text-xs">
                            {history.map((h) => (
                              <li key={h.id} className="flex items-center gap-2">
                                <span>
                                  {h.effectiveFrom === '2000-01-01' ? 'always' : h.effectiveFrom}: {formatMoney(Number(h.unitCost))}
                                  {h.purchasePrice && ` (${h.purchasePrice} ${h.purchaseCurrency})`}
                                </span>
                                <form action={deleteProductCostAction.bind(null, h.id)}>
                                  <SubmitButton variant="ghost" size="sm" confirm="Delete this cost entry?">
                                    Delete
                                  </SubmitButton>
                                </form>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className={td}>
                        <ActionForm action={saveProductCostAction.bind(null, r.product.id)} className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Input name="unitCost" inputMode="decimal" placeholder="Cost, PLN" className="h-8 w-24" aria-label="Unit cost in PLN" />
                            <Input name="effectiveFrom" type="date" className="h-8 w-36" aria-label="Valid from" title="Valid from (empty = always)" />
                            <SubmitButton size="sm">Save</SubmitButton>
                          </div>
                          <details className="text-xs text-slate-500">
                            <summary className="cursor-pointer">From purchase price…</summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Input name="purchasePrice" inputMode="decimal" placeholder="Price" className="h-8 w-20" aria-label="Purchase price" />
                              <Select name="purchaseCurrency" className="h-8 w-20" defaultValue="USD" aria-label="Currency">
                                {['PLN', 'USD', 'EUR', 'KRW', 'GBP'].map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </Select>
                              <Input name="freight" inputMode="decimal" placeholder="Freight, PLN" className="h-8 w-24" aria-label="Freight per unit" />
                              <Input name="duty" inputMode="decimal" placeholder="Duty, PLN" className="h-8 w-24" aria-label="Duty per unit" />
                            </div>
                            <p className="mt-1">Leave the cost empty: it is worked out at the NBP rate of the date.</p>
                          </details>
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Paste costs" description="One product per line: SKU, EAN or name, then the cost in PLN. Copy two columns from a spreadsheet." />
          <CardBody>
            <ActionForm action={pasteCostsAction} className="space-y-3">
              <Textarea name="lines" rows={6} placeholder={'LUO-MUG-01;18,40\n5901234567890\t22.10\nCOSRX Snail Mucin 96 Essence 100 ml;31.50'} />
              <Field label="Valid from" hint="Empty = for all past and future sales.">
                <Input name="effectiveFrom" type="date" />
              </Field>
              <SubmitButton>Import</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="From the Luora Analytics sheet" description="Reads the cost tab (landed cost per unit) through its Apps Script and matches each row to a product by name." />
          <CardBody>
            <ActionForm action={sheetCostsAction} className="space-y-3">
              <Field label="Apps Script URL">
                <Input name="url" defaultValue={LUORA_ANALYTICS_SHEET} />
              </Field>
              <Field label="Valid from" hint="Empty = for all past and future sales.">
                <Input name="effectiveFrom" type="date" />
              </Field>
              <SubmitButton pendingText="Importing…">Import from sheet</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="From Shopify" description="Uses each variant's “Cost per item”, converted to PLN at today's NBP rate." />
          <CardBody>
            <ActionForm action={shopifyCostsAction} className="space-y-3">
              <Checkbox name="overwrite" label="Also replace costs already set here (as a new entry from today)" />
              <div>
                <SubmitButton pendingText="Importing…">Import from Shopify</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
