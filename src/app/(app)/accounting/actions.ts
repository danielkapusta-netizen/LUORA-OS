'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin, requireUser } from '@/server/auth';
import type { AccountingSettings } from '@/server/db/schema';
import { checkAccountingConnection, markInvoicedElsewhere, requestInvoice, retryInvoice, saveAccounting, undoInvoicedElsewhere } from '@/server/services/invoicing';

const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
const bool = (fd: FormData, name: string) => fd.get(name) === 'on';

function refresh() {
  revalidatePath('/accounting');
  revalidatePath('/orders', 'layout');
}

export async function createInvoiceAction(orderId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await requestInvoice(orderId, user.id);
    refresh();
    return 'Invoice requested – it appears here in a few seconds.';
  });
}

export async function retryInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await retryInvoice(invoiceId, user.id);
    refresh();
    return 'Trying again – refresh in a few seconds.';
  });
}

export async function markInvoicedElsewhereAction(orderId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await markInvoicedElsewhere(orderId, user.id);
    refresh();
    return 'Marked as already invoiced';
  });
}

export async function undoInvoicedElsewhereAction(invoiceId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await undoInvoicedElsewhere(invoiceId, user.id);
    refresh();
    return 'Back in “To issue”';
  });
}

/** Percent ("23" or "23%") → fraction (0.23); empty → undefined. */
function rate(value: string): number | undefined {
  const n = Number(value.replace('%', '').replace(',', '.'));
  if (!value || !Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 10000;
}

/** "CZ=21, HU=27" → { CZ: 0.21, HU: 0.27 }. */
function ossRates(value: string): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const part of value.split(/[,;\n]/)) {
    const m = part.trim().match(/^([A-Za-z]{2})\s*[=:]\s*([\d.,]+)\s*%?$/);
    if (!m) continue;
    const r = rate(m[2]);
    if (r !== undefined) out[m[1].toUpperCase()] = r;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function saveAccountingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const settings: AccountingSettings = {
    autoOnShipped: fd.get('mode') === 'auto',
    uploadAllegro: bool(fd, 'uploadAllegro'),
    uploadEmpik: bool(fd, 'uploadEmpik'),
    sendB2bToKsef: bool(fd, 'sendB2bToKsef'),
    numberingSeries: text(fd, 'numberingSeries') || undefined,
    placeOfIssue: text(fd, 'placeOfIssue') || undefined,
    issuerSignature: text(fd, 'issuerSignature') || undefined,
    defaultVatRate: rate(text(fd, 'defaultVatRate')) ?? 0.23,
    ossRates: ossRates(text(fd, 'ossRates')),
  };
  return attempt(async () => {
    await saveAccounting({ enabled: bool(fd, 'enabled'), login: text(fd, 'login'), invoiceKey: text(fd, 'invoiceKey') || null, settings });
    revalidatePath('/settings/accounting');
    revalidatePath('/accounting');
    return 'Saved';
  });
}

export async function testAccountingAction(): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => `Connected: ${await checkAccountingConnection()}`);
}
