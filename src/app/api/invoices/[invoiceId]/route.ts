import { currentUser } from '@/server/auth';
import { getInvoicePdf } from '@/server/services/invoicing';

export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!(await currentUser())) return new Response('Unauthorized', { status: 401 });
  const { invoiceId } = await params;
  const file = await getInvoicePdf(invoiceId);
  if (!file) return new Response('Invoice PDF not found', { status: 404 });
  const name = `faktura-${(file.invoice.number ?? file.invoice.externalId ?? invoiceId).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  return new Response(new Uint8Array(file.content), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
