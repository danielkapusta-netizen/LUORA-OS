// Invoices for orders whose buyer asked for one: issued in ifirma, stored in R2, attached to the
// Allegro / Empik order, and sent to KSeF for companies.
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { getCfEnv } from '../cf';
import { encryptJson } from '../crypto';
import { getDb } from '../db/client';
import {
  accountingSettings,
  invoices,
  marketplaceAccounts,
  orderItems,
  orders,
  type AccountingSettings,
  type Invoice,
  type Order,
} from '../db/schema';
import { isMockMode } from '../env';
import { IfirmaClient, type IfirmaCredentials } from '../integrations/accounting/ifirma/client';
import { buildDomesticPayload, buildOssPayload, planInvoice, warsawDate } from '../integrations/accounting/ifirma/mapper';
import { MockInvoicingAdapter } from '../integrations/accounting/mock';
import { nbpRateBefore } from '../integrations/accounting/nbp';
import type { InvoiceKind, InvoicingAdapter } from '../integrations/accounting/types';
import { enqueue, JOBS } from '../jobs/queue';
import { getMarketplaceAdapter, loadMarketplaceAccount, readCredentials } from './accounts';
import { logEvent } from './events';
import { orderRef } from './orders';
import { isUniqueViolation } from './shipping';

export class InvoicingError extends Error {}

/** Marketplaces whose invoice requests are handled here. */
export const INVOICED_MARKETPLACES = ['allegro', 'empik'] as const;

export const DEFAULT_ACCOUNTING_SETTINGS: Required<Pick<AccountingSettings, 'autoOnShipped' | 'uploadAllegro' | 'uploadEmpik' | 'sendB2bToKsef' | 'defaultVatRate'>> = {
  autoOnShipped: false,
  uploadAllegro: true,
  uploadEmpik: true,
  sendB2bToKsef: true,
  defaultVatRate: 0.23,
};

// ---------------------------------------------------------------- settings

export async function loadAccounting() {
  const [row] = await getDb().select().from(accountingSettings).where(eq(accountingSettings.id, 'main'));
  const creds = readCredentials<IfirmaCredentials>(row?.credentials ?? null);
  return {
    enabled: row?.enabled ?? false,
    settings: { ...DEFAULT_ACCOUNTING_SETTINGS, ...(row?.settings ?? {}) },
    login: creds?.login ?? null,
    hasKey: Boolean(creds?.invoiceKey),
    configured: isMockMode() || Boolean(creds?.login && creds.invoiceKey),
  };
}

export async function saveAccounting(input: { enabled: boolean; login: string; invoiceKey: string | null; settings: AccountingSettings }): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(accountingSettings).where(eq(accountingSettings.id, 'main'));
  const previous = readCredentials<IfirmaCredentials>(row?.credentials ?? null);
  const invoiceKey = input.invoiceKey?.trim() || previous?.invoiceKey || '';
  if (invoiceKey && !/^[0-9a-fA-F]+$/.test(invoiceKey)) throw new InvoicingError('The ifirma key should be the hex code shown in ifirma (letters A–F and digits)');
  const credentials = input.login || invoiceKey ? encryptJson({ login: input.login.trim(), invoiceKey }) : null;
  await db
    .insert(accountingSettings)
    .values({ id: 'main', enabled: input.enabled, credentials, settings: input.settings })
    .onConflictDoUpdate({ target: accountingSettings.id, set: { enabled: input.enabled, credentials, settings: input.settings, updatedAt: new Date() } });
}

export async function getInvoicingAdapter(): Promise<InvoicingAdapter> {
  if (isMockMode()) return new MockInvoicingAdapter();
  const [row] = await getDb().select().from(accountingSettings).where(eq(accountingSettings.id, 'main'));
  const creds = readCredentials<IfirmaCredentials>(row?.credentials ?? null);
  if (!creds?.login || !creds.invoiceKey) throw new InvoicingError('ifirma is not connected yet. Add the login and API key in Settings → Accounting.');
  return new IfirmaClient(creds);
}

export async function checkAccountingConnection(): Promise<string> {
  return (await getInvoicingAdapter()).checkConnection();
}

// ---------------------------------------------------------------- issuing

async function liveInvoice(orderId: string): Promise<Invoice | null> {
  const [row] = await getDb()
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), inArray(invoices.state, ['pending', 'issued'])));
  return row ?? null;
}

async function orderLines(orderId: string) {
  return getDb()
    .select({ name: orderItems.name, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.externalLineId);
}

/**
 * Queues the invoice for one order. Orders that need a person (foreign company, discount, …) get a
 * "manual" entry with the reason instead. Returns the invoice id.
 */
export async function requestInvoice(orderId: string, userId: string | null): Promise<string> {
  const db = getDb();
  const accounting = await loadAccounting();
  if (!accounting.enabled) throw new InvoicingError('Invoicing is switched off in Settings → Accounting');
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new InvoicingError('Order not found');
  if (!(INVOICED_MARKETPLACES as readonly string[]).includes(order.marketplace)) throw new InvoicingError('Invoices are only issued for Allegro and Empik orders');
  if (!order.invoiceRequest) throw new InvoicingError(`The buyer of order ${order.externalNumber} did not ask for an invoice`);
  if (order.status === 'cancelled') throw new InvoicingError(`Order ${order.externalNumber} is cancelled`);
  if (await liveInvoice(orderId)) throw new InvoicingError(`Order ${order.externalNumber} already has an invoice`);

  const plan = planInvoice(order, await orderLines(orderId), order.invoiceRequest);
  // A previous "manual" entry is replaced, so the list shows only the latest reason.
  await db.delete(invoices).where(and(eq(invoices.orderId, orderId), eq(invoices.state, 'manual')));
  if (plan.kind === 'manual') {
    const [row] = await db
      .insert(invoices)
      .values({ orderId, kind: 'domestic', state: 'manual', grossAmount: order.totalAmount, currency: order.currency, error: plan.reason, createdBy: userId })
      .returning({ id: invoices.id });
    await logEvent(db, orderId, 'invoice', `Invoice needs to be issued by hand: ${plan.reason}`, { userId });
    return row.id;
  }

  let id: string;
  try {
    const [row] = await db
      .insert(invoices)
      .values({ orderId, kind: plan.kind, grossAmount: order.totalAmount, currency: order.currency, createdBy: userId })
      .returning({ id: invoices.id });
    id = row.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new InvoicingError(`Order ${order.externalNumber} already has an invoice`);
    throw err;
  }
  await logEvent(db, orderId, 'invoice', `Invoice requested (${plan.kind === 'oss' ? 'OSS' : 'domestic'})`, { userId });
  await enqueue(JOBS.invoiceCreate, { invoiceId: id });
  return id;
}

/** Job, when an order becomes Shipped: issues its invoice if the buyer asked and auto-invoicing is on. */
export async function autoInvoice(orderId: string): Promise<void> {
  const accounting = await loadAccounting();
  if (!accounting.enabled || !accounting.settings.autoOnShipped) return;
  const [order] = await getDb().select().from(orders).where(eq(orders.id, orderId));
  if (!order?.invoiceRequest || !(INVOICED_MARKETPLACES as readonly string[]).includes(order.marketplace)) return;
  const [existing] = await getDb().select({ id: invoices.id }).from(invoices).where(eq(invoices.orderId, orderId));
  if (existing) return;
  await requestInvoice(orderId, null);
}

async function payloadFor(order: Order, kind: InvoiceKind, adapter: InvoicingAdapter, settings: AccountingSettings) {
  const req = order.invoiceRequest!;
  const issueDate = warsawDate(new Date());
  const saleDate = warsawDate(order.shippedAt ?? new Date());
  const items = await orderLines(order.id);
  if (kind === 'domestic') {
    return buildDomesticPayload(order, items, req, { issueDate, saleDate, settings, vatRate: settings.defaultVatRate ?? 0.23 });
  }
  const dest = order.shippingAddress.countryCode.toUpperCase();
  const vatRate = settings.ossRates?.[dest] ?? (await adapter.standardVatRate(dest));
  const exchangeRate = order.currency === 'PLN' ? null : (await nbpRateBefore(order.currency, issueDate)).rate;
  return buildOssPayload(order, items, req, { issueDate, saleDate, settings, vatRate, exchangeRate });
}

/** Job: issues the invoice in ifirma, then fetches its number and PDF. */
export async function runCreateInvoice(invoiceId: string): Promise<void> {
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice || invoice.state !== 'pending') return;
  const [order] = await db.select().from(orders).where(eq(orders.id, invoice.orderId));
  const accounting = await loadAccounting();
  const adapter = await getInvoicingAdapter();

  if (!invoice.externalId) {
    try {
      const payload = await payloadFor(order, invoice.kind, adapter, accounting.settings);
      const issued = await adapter.create(invoice.kind, payload);
      // Saved at once, so a retry continues with this invoice instead of issuing a second one.
      await db.update(invoices).set({ externalId: issued.externalId, error: null }).where(eq(invoices.id, invoice.id));
      invoice.externalId = issued.externalId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(invoices).set({ state: 'failed', error: message }).where(eq(invoices.id, invoice.id));
      await logEvent(db, order.id, 'error', `Invoice not issued: ${message}`);
      return;
    }
  }
  await db.update(invoices).set({ state: 'issued' }).where(eq(invoices.id, invoice.id));
  await fetchDocument({ ...invoice, state: 'issued' }, adapter);
  const [fresh] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
  await logEvent(db, order.id, 'invoice', `Invoice ${fresh.number ?? fresh.externalId} issued in ifirma`);

  const marketplaceOn = order.marketplace === 'allegro' ? accounting.settings.uploadAllegro : order.marketplace === 'empik' ? accounting.settings.uploadEmpik : false;
  if (marketplaceOn) await enqueue(JOBS.invoiceUpload, { invoiceId: invoice.id });
  if (invoice.kind === 'domestic' && order.invoiceRequest?.taxId && accounting.settings.sendB2bToKsef) {
    await enqueue(JOBS.invoiceKsef, { invoiceId: invoice.id });
  }
}

/** Gets the number and PDF of an issued invoice; problems are saved on the invoice for a later retry. */
async function fetchDocument(invoice: Invoice, adapter: InvoicingAdapter): Promise<void> {
  const db = getDb();
  try {
    const details = invoice.number ? null : await adapter.getDetails(invoice.externalId!, warsawDate(invoice.createdAt));
    const r2Key = `invoices/${invoice.id}.pdf`;
    if (!invoice.r2Key) {
      const pdf = await adapter.getPdf(invoice.kind, invoice.externalId!);
      await getCfEnv().LABELS.put(r2Key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
    }
    await db
      .update(invoices)
      .set({ number: invoice.number ?? details?.number ?? null, r2Key, ksefStatus: details?.ksefStatus ?? invoice.ksefStatus, error: null })
      .where(eq(invoices.id, invoice.id));
  } catch (err) {
    const message = `Issued in ifirma, but the PDF could not be fetched yet: ${err instanceof Error ? err.message : String(err)}`;
    await db.update(invoices).set({ error: message }).where(eq(invoices.id, invoice.id));
  }
}

async function readPdf(invoice: Invoice): Promise<Buffer | null> {
  if (!invoice.r2Key) return null;
  const object = await getCfEnv().LABELS.get(invoice.r2Key);
  return object ? Buffer.from(await object.arrayBuffer()) : null;
}

/** Job: attaches the PDF to the Allegro / Empik order. Throws so the queue retries. */
export async function runUploadInvoice(invoiceId: string): Promise<void> {
  const db = getDb();
  let [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice || invoice.state !== 'issued' || invoice.uploadedAt) return;
  if (!invoice.r2Key || !invoice.number) {
    await fetchDocument(invoice, await getInvoicingAdapter());
    [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  }
  const pdf = await readPdf(invoice);
  try {
    if (!pdf) throw new InvoicingError(invoice.error ?? 'The invoice PDF is not available yet');
    const [order] = await db.select().from(orders).where(eq(orders.id, invoice.orderId));
    const account = await loadMarketplaceAccount(order.accountId);
    const adapter = getMarketplaceAdapter(account);
    if (!adapter.uploadInvoice) throw new InvoicingError(`${account.name} does not accept invoices`);
    await adapter.uploadInvoice(await orderRef(order.id), { number: invoice.number ?? invoice.externalId!, pdf });
    await db.update(invoices).set({ uploadedAt: new Date(), uploadError: null }).where(eq(invoices.id, invoice.id));
    await logEvent(db, order.id, 'invoice', `Invoice ${invoice.number ?? invoice.externalId} sent to ${account.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(invoices).set({ uploadError: message }).where(eq(invoices.id, invoice.id));
    throw err;
  }
}

/** Job: sends a company's invoice to KSeF through ifirma. */
export async function runSendKsef(invoiceId: string): Promise<void> {
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice || invoice.state !== 'issued' || invoice.ksefSentAt || !invoice.externalId) return;
  const adapter = await getInvoicingAdapter();
  try {
    await adapter.sendToKsef(invoice.kind, invoice.externalId);
    const details = await adapter.getDetails(invoice.externalId, warsawDate(invoice.createdAt)).catch(() => null);
    await db
      .update(invoices)
      .set({ ksefSentAt: new Date(), ksefError: null, ksefStatus: details?.ksefStatus ?? 'sent' })
      .where(eq(invoices.id, invoice.id));
    await logEvent(db, invoice.orderId, 'invoice', `Invoice ${invoice.number ?? invoice.externalId} sent to KSeF`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(invoices).set({ ksefError: message }).where(eq(invoices.id, invoice.id));
    throw err;
  }
}

/** Re-queues whatever is unfinished for an invoice: a failed issue, a missing upload or KSeF send. */
export async function retryInvoice(invoiceId: string, userId: string): Promise<void> {
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new InvoicingError('Invoice not found');
  if (invoice.state === 'failed' || invoice.state === 'manual') {
    await requestInvoice(invoice.orderId, userId);
    return;
  }
  if (invoice.state === 'pending') {
    await enqueue(JOBS.invoiceCreate, { invoiceId });
    return;
  }
  const [order] = await db.select().from(orders).where(eq(orders.id, invoice.orderId));
  if (!invoice.uploadedAt) {
    await db.update(invoices).set({ uploadError: null }).where(eq(invoices.id, invoiceId));
    await enqueue(JOBS.invoiceUpload, { invoiceId });
  }
  if (invoice.kind === 'domestic' && order.invoiceRequest?.taxId && !invoice.ksefSentAt) {
    await db.update(invoices).set({ ksefError: null }).where(eq(invoices.id, invoiceId));
    await enqueue(JOBS.invoiceKsef, { invoiceId });
  }
}

export async function getInvoicePdf(invoiceId: string) {
  const [invoice] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return null;
  const content = await readPdf(invoice);
  return content ? { invoice, content } : null;
}

// ---------------------------------------------------------------- lists

export type AccountingTab = 'to_issue' | 'issued' | 'attention' | 'all';

/** Requested invoices with no invoice yet (the order may still be on its way to Shipped). */
export async function ordersAwaitingInvoice() {
  const db = getDb();
  return db
    .select({ order: orders, accountName: marketplaceAccounts.name })
    .from(orders)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, orders.accountId))
    .where(
      and(
        isNotNull(orders.invoiceRequest),
        inArray(orders.marketplace, [...INVOICED_MARKETPLACES]),
        ne(orders.status, 'cancelled'),
        sql`not exists (select 1 from ${invoices} i where i.order_id = ${orders.id})`,
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(200);
}

/** Invoices for the Accounting page. "Needs attention" = not issued, not uploaded, KSeF failed, or the order was cancelled. */
export async function listInvoices(tab: Exclude<AccountingTab, 'to_issue'>) {
  const db = getDb();
  const attention = or(
    inArray(invoices.state, ['failed', 'manual']),
    and(eq(invoices.state, 'issued'), or(isNotNull(invoices.uploadError), isNotNull(invoices.ksefError), isNotNull(invoices.error), eq(orders.status, 'cancelled'))),
  );
  const where = tab === 'issued' ? and(eq(invoices.state, 'issued'), isNull(invoices.uploadError), ne(orders.status, 'cancelled')) : tab === 'attention' ? attention : undefined;
  return db
    .select({ invoice: invoices, order: orders, accountName: marketplaceAccounts.name })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, orders.accountId))
    .where(where)
    .orderBy(desc(invoices.createdAt))
    .limit(200);
}

export async function accountingCounts() {
  const [toIssue, attention] = await Promise.all([ordersAwaitingInvoice(), listInvoices('attention')]);
  return { toIssue: toIssue.length, attention: attention.length };
}

export async function invoicesForOrder(orderId: string) {
  return getDb().select().from(invoices).where(eq(invoices.orderId, orderId)).orderBy(desc(invoices.createdAt));
}
