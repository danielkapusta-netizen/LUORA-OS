'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin } from '@/server/auth';
import type { AnalyticsSettings } from '@/server/db/schema';
import {
  deleteProductCost,
  importCosts,
  importCostsFromSheet,
  importCostsFromShopify,
  LABEL_COST_SERVICES,
  parseAmount,
  parseCostLines,
  saveAnalyticsSettings,
  setProductCost,
  type ImportResult,
} from '@/server/services/costs';

const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
const amount = (fd: FormData, name: string) => parseAmount(text(fd, name));
/** "12" (percent) → 0.12; empty → undefined. */
const percent = (fd: FormData, name: string) => {
  const n = amount(fd, name);
  return n === null ? undefined : n / 100;
};

const MARKETPLACES = ['allegro', 'empik', 'shopify', 'vonhalsky'] as const;

export async function saveProfitSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const fallbackCommission: AnalyticsSettings['fallbackCommission'] = {};
    for (const m of MARKETPLACES) {
      const v = percent(fd, `commission_${m}`);
      if (v !== undefined) fallbackCommission[m] = v;
    }
    const labelCosts: Record<string, number> = {};
    for (const s of LABEL_COST_SERVICES) {
      const v = amount(fd, `label_${s.key}`);
      if (v !== null) labelCosts[s.key] = v;
    }
    await saveAnalyticsSettings({
      fallbackCommission,
      labelCosts,
      defaultLabelCost: amount(fd, 'defaultLabelCost') ?? undefined,
      packagingCost: amount(fd, 'packagingCost') ?? undefined,
      feesVatDeductible: fd.get('feesVatDeductible') === 'on',
      targetMargin: percent(fd, 'targetMargin'),
      healthyMargin: percent(fd, 'healthyMargin'),
      thinMargin: percent(fd, 'thinMargin'),
      criticalMargin: percent(fd, 'criticalMargin'),
    });
    revalidatePath('/settings/costs');
    return 'Saved';
  });
}

export async function saveProductCostAction(productId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  return attempt(async () => {
    await setProductCost(
      productId,
      {
        unitCost: amount(fd, 'unitCost'),
        purchasePrice: amount(fd, 'purchasePrice'),
        purchaseCurrency: text(fd, 'purchaseCurrency') || null,
        freight: amount(fd, 'freight'),
        duty: amount(fd, 'duty'),
        effectiveFrom: text(fd, 'effectiveFrom') || null,
        note: text(fd, 'note') || null,
      },
      user.id,
    );
    revalidatePath('/settings/costs');
    return 'Saved';
  });
}

export async function deleteProductCostAction(costId: string): Promise<void> {
  await requireAdmin();
  await deleteProductCost(costId);
  revalidatePath('/settings/costs');
}

function describe(result: ImportResult & { skipped?: number }): string {
  const parts = [`Saved ${result.saved} cost(s)`];
  if (result.skipped) parts.push(`${result.skipped} skipped (already had a cost)`);
  if (result.skippedBundles) parts.push(`${result.skippedBundles} bundle row(s) skipped`);
  if (result.unmatched.length) {
    const shown = result.unmatched.slice(0, 15).join('; ');
    parts.push(`${result.unmatched.length} not matched to a product: ${shown}${result.unmatched.length > 15 ? '; …' : ''}`);
  }
  return parts.join('. ');
}

export async function pasteCostsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  return attempt(async () => {
    const lines = parseCostLines(text(fd, 'lines'));
    if (!lines.length) throw new Error('No lines with a product and a cost were found');
    const result = await importCosts(lines, { effectiveFrom: text(fd, 'effectiveFrom') || undefined, userId: user.id, source: 'import' });
    revalidatePath('/settings/costs');
    return describe(result);
  });
}

export async function sheetCostsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  return attempt(async () => {
    const result = await importCostsFromSheet(text(fd, 'url'), { effectiveFrom: text(fd, 'effectiveFrom') || undefined, userId: user.id });
    revalidatePath('/settings/costs');
    return describe(result);
  });
}

export async function shopifyCostsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  return attempt(async () => {
    const result = await importCostsFromShopify({ userId: user.id, overwrite: fd.get('overwrite') === 'on' });
    revalidatePath('/settings/costs');
    return describe(result);
  });
}
