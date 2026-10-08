import { requireAdmin } from '@/server/auth';
import { customerRows, customersCsv } from '@/server/services/customer-list';

/** CSV of the customers matching the list's filters (admins only: it holds personal data). */
export async function GET(request: Request) {
  await requireAdmin();
  const p = new URL(request.url).searchParams;
  const { rows } = await customerRows({
    q: p.get('q') ?? undefined,
    segment: p.get('segment') ?? undefined,
    marketplace: p.get('marketplace') ?? undefined,
    tag: p.get('tag') ?? undefined,
    sort: p.get('sort') ?? undefined,
  });
  return new Response(customersCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
