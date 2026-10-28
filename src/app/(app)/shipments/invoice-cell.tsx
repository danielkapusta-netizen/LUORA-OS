import { FileText } from 'lucide-react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { buttonClass } from '@/components/ui';
import { MARKETPLACE_LABELS } from '@/lib/utils';
import type { Invoice } from '@/server/db/schema';
import { createInvoiceForOrderAction, retryInvoiceFromShipmentsAction } from './actions';
import { getT } from '@/lib/i18n/server';

/**
 * The invoice of one order in the Shipments list: a button to create it, then a link to the PDF
 * (like a label). Allegro and Empik invoices are also attached to the order; Shopify's stay a PDF.
 */
export async function InvoiceCell({ orderId, marketplace, invoice, uploads }: { orderId: string; marketplace: string; invoice: Invoice | undefined; uploads: boolean }) {
  const t = await getT();
  const create = (label: string) => (
    <ActionForm action={createInvoiceForOrderAction.bind(null, orderId)} showOk={false}>
      <SubmitButton size="sm" variant="secondary" pendingText={t('Requesting…')}>
        <FileText className="size-3.5" /> {label}
      </SubmitButton>
    </ActionForm>
  );
  const retry = (label: string) => (
    <ActionForm action={retryInvoiceFromShipmentsAction.bind(null, invoice?.id ?? '')} showOk={false}>
      <SubmitButton size="sm" variant="secondary" pendingText="…">
        {label}
      </SubmitButton>
    </ActionForm>
  );

  if (!invoice) return create(t('Create invoice'));

  if (invoice.state === 'pending') return <span className="text-xs text-slate-500">{t('Issuing the invoice…')}</span>;

  if (invoice.state === 'failed' || invoice.state === 'manual') {
    return (
      <div className="space-y-1.5">
        <p className="max-w-56 text-xs text-red-700">
          {invoice.state === 'manual' ? t('Issue by hand:') : t('Not issued:')}{' '}
          {invoice.error}
        </p>
        {invoice.state === 'failed' ? retry(t('Try again')) : null}
      </div>
    );
  }

  // Issued.
  const place = MARKETPLACE_LABELS[marketplace] ?? marketplace;
  const toUpload = uploads && (marketplace === 'allegro' || marketplace === 'empik' || marketplace === 'hebe');
  return (
    <div className="space-y-1">
      {invoice.r2Key ? (
        <a className={buttonClass('secondary', 'sm')} href={`/api/invoices/${invoice.id}`} target="_blank" rel="noreferrer">
          <FileText className="size-3.5" /> {t('Invoice PDF')}
        </a>
      ) : (
        <>
          <p className="max-w-56 text-xs text-amber-700">{invoice.error ?? t('Issued in ifirma, fetching the PDF…')}</p>
          {retry(t('Retry'))}
        </>
      )}
      <p className="text-xs">
        {invoice.number && <span className="text-slate-500">{invoice.number} · </span>}
        {!toUpload ? (
          <span className="text-slate-500">{invoice.r2Key ? t('PDF ready') : ''}</span>
        ) : invoice.uploadedAt ? (
          <span className="text-emerald-700">{t('sent to {account}', { account: place })}</span>
        ) : invoice.uploadError ? (
          <span className="text-red-700">{t('not sent to {account}:', { account: place })} {invoice.uploadError}</span>
        ) : (
          <span className="text-slate-500">{t('sending to {account}…', { account: place })}</span>
        )}
      </p>
      {toUpload && invoice.uploadError && !invoice.uploadedAt ? retry(t('Retry sending')) : null}
    </div>
  );
}
