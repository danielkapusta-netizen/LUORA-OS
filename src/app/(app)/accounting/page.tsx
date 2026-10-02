import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { MarketplaceBadge, StatusBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Alert, Badge, buttonClass, Card, EmptyState, PageHeader, td, th } from '@/components/ui';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { Invoice } from '@/server/db/schema';
import type { InvoiceRequest } from '@/server/integrations/types';
import { accountingCounts, listInvoices, loadAccounting, ordersAwaitingInvoice, type AccountingTab } from '@/server/services/invoicing';
import { createInvoiceAction, retryInvoiceAction } from './actions';

export const metadata: Metadata = { title: 'Accounting' };

const TABS: { value: AccountingTab; label: string }[] = [
  { value: 'to_issue', label: 'To issue' },
  { value: 'issued', label: 'Issued' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'all', label: 'All invoices' },
];

function Buyer({ req }: { req: InvoiceRequest | null }) {
  if (!req) return <span className="text-slate-400">—</span>;
  return (
    <>
      <p className="font-medium">{req.name}</p>
      <p className="text-xs text-slate-500">
        {req.taxId ? `NIP ${req.euPrefix && req.euPrefix !== 'PL' ? req.euPrefix : ''}${req.taxId}` : 'Private buyer'} · {req.city}, {req.countryCode}
      </p>
    </>
  );
}

function InvoiceState({ invoice, cancelled }: { invoice: Invoice; cancelled: boolean }) {
  if (invoice.state === 'pending') return <Badge tone="blue">Being issued</Badge>;
  if (invoice.state === 'failed') return <Badge tone="red">Not issued</Badge>;
  if (invoice.state === 'manual') return <Badge tone="amber">Issue by hand</Badge>;
  return cancelled ? <Badge tone="red">Order cancelled</Badge> : <Badge tone="green">Issued</Badge>;
}

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser();
  const { tab: tabParam } = await searchParams;
  const tab = (TABS.find((t) => t.value === tabParam)?.value ?? 'to_issue') as AccountingTab;
  const [accounting, counts] = await Promise.all([loadAccounting(), accountingCounts()]);
  const awaiting = tab === 'to_issue' ? await ordersAwaitingInvoice() : [];
  const rows = tab === 'to_issue' ? [] : await listInvoices(tab);
  const busy = rows.some((r) => r.invoice.state === 'pending' || (r.invoice.state === 'issued' && !r.invoice.uploadedAt && !r.invoice.uploadError));

  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader
        title="Accounting"
        description="Invoices from ifirma for Allegro and Empik orders whose buyer asked for one. They're attached to the marketplace order, and companies' invoices go to KSeF."
      />
      {(!accounting.enabled || !accounting.configured) && (
        <div className="mb-4">
          <Alert>
            {!accounting.configured ? 'ifirma is not connected yet.' : 'Invoicing is switched off.'}{' '}
            <Link href="/settings/accounting" className="font-medium underline">
              Open Settings → Accounting
            </Link>
          </Alert>
        </div>
      )}
      {accounting.enabled && !accounting.settings.autoOnShipped && (
        <p className="mb-3 text-sm text-slate-500">Automatic invoicing is off: press “Create invoice” on each order, or switch it on in Settings → Accounting.</p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = t.value === 'to_issue' ? counts.toIssue : t.value === 'attention' ? counts.attention : undefined;
          return (
            <Link
              key={t.value}
              href={t.value === 'to_issue' ? '/accounting' : `/accounting?tab=${t.value}`}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium',
                tab === t.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {t.label}
              {count ? <span className={cn('ml-1.5', tab === t.value ? 'text-white/80' : t.value === 'attention' ? 'text-red-600' : 'text-slate-400')}>{count}</span> : null}
            </Link>
          );
        })}
      </div>

      <Card>
        {tab === 'to_issue' ? (
          awaiting.length === 0 ? (
            <EmptyState title="Nothing to invoice">Orders whose buyer asks for an invoice appear here.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Invoice for</th>
                    <th className={th}>Order</th>
                    <th className={cn(th, 'text-right')}>Amount</th>
                    <th className={cn(th, 'text-right')} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {awaiting.map(({ order }) => (
                    <tr key={order.id}>
                      <td className={td}>
                        <Buyer req={order.invoiceRequest} />
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <MarketplaceBadge marketplace={order.marketplace} />
                          <Link href={`/orders?order=${order.id}`} className="text-brand-700 hover:underline">
                            {order.externalNumber}
                          </Link>
                          <StatusBadge status={order.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">placed {formatDate(order.placedAt, false)}</p>
                      </td>
                      <td className={cn(td, 'text-right tabular-nums whitespace-nowrap')}>{formatMoney(order.totalAmount, order.currency)}</td>
                      <td className={cn(td, 'text-right')}>
                        <ActionForm action={createInvoiceAction.bind(null, order.id)}>
                          <SubmitButton size="sm" pendingText="Requesting…">
                            <FileText className="size-3.5" /> Create invoice
                          </SubmitButton>
                        </ActionForm>
                        {!['shipped', 'delivered'].includes(order.status) && <p className="mt-1 text-xs text-slate-400">Not shipped yet</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : rows.length === 0 ? (
          <EmptyState title={tab === 'attention' ? 'Nothing needs attention' : 'No invoices yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Invoice for</th>
                  <th className={th}>Order</th>
                  <th className={cn(th, 'text-right')}>Amount</th>
                  <th className={th}>Marketplace / KSeF</th>
                  <th className={cn(th, 'text-right')} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ invoice: i, order, accountName }) => {
                  const cancelled = order.status === 'cancelled';
                  const retry = i.state === 'failed' || i.state === 'manual' || Boolean(i.uploadError || i.ksefError) || (i.state === 'issued' && !i.r2Key);
                  return (
                    <tr key={i.id}>
                      <td className={td}>
                        <p className="font-medium">{i.number ?? (i.externalId ? `ifirma #${i.externalId}` : '—')}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <InvoiceState invoice={i} cancelled={cancelled} />
                          <span className="text-xs text-slate-500">{i.kind === 'oss' ? 'OSS' : 'Domestic'} · {formatDate(i.createdAt)}</span>
                        </div>
                        {i.error && <p className="mt-1 max-w-96 text-xs text-red-700">{i.error}</p>}
                        {cancelled && i.state === 'issued' && <p className="mt-1 max-w-96 text-xs text-red-700">Issue a correction invoice in ifirma.</p>}
                      </td>
                      <td className={td}>
                        <Buyer req={order.invoiceRequest} />
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <MarketplaceBadge marketplace={order.marketplace} />
                          <Link href={`/orders?order=${order.id}`} className="text-brand-700 hover:underline">
                            {order.externalNumber}
                          </Link>
                        </div>
                      </td>
                      <td className={cn(td, 'text-right tabular-nums whitespace-nowrap')}>{formatMoney(i.grossAmount, i.currency)}</td>
                      <td className={cn(td, 'text-xs')}>
                        {i.state !== 'issued' ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <>
                            {i.uploadedAt ? (
                              <p className="text-emerald-700">Sent to {accountName}</p>
                            ) : i.uploadError ? (
                              <p className="max-w-72 text-red-700">Not sent to {accountName}: {i.uploadError}</p>
                            ) : (
                              <p className="text-slate-500">Sending to {accountName}…</p>
                            )}
                            {order.invoiceRequest?.taxId && i.kind === 'domestic' && (
                              <p className={cn('mt-0.5', i.ksefError ? 'text-red-700' : 'text-slate-500')}>
                                KSeF: {i.ksefError ? i.ksefError : i.ksefStatus ?? (i.ksefSentAt ? 'sent' : 'not sent yet')}
                              </p>
                            )}
                          </>
                        )}
                      </td>
                      <td className={cn(td, 'text-right')}>
                        <div className="flex flex-col items-end gap-1.5">
                          {i.r2Key && (
                            <a className={buttonClass('secondary', 'sm')} href={`/api/invoices/${i.id}`} target="_blank" rel="noreferrer">
                              <FileText className="size-3.5" /> PDF
                            </a>
                          )}
                          {retry && !cancelled && (
                            <ActionForm action={retryInvoiceAction.bind(null, i.id)}>
                              <SubmitButton size="sm" variant="secondary" pendingText="…">
                                {i.state === 'failed' || i.state === 'manual' ? 'Try again' : 'Retry'}
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
