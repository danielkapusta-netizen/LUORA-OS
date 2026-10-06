import type { Metadata } from 'next';
import Link from 'next/link';
import { formatValue, MARKETPLACE_COLORS } from '@/components/analytics/format';
import { SubmitButton } from '@/components/forms';
import { Card, CardBody, EmptyState } from '@/components/ui';
import { formatDate, MARKETPLACE_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { duplicateSuggestions } from '@/server/services/customers';
import { mergeAction } from '../actions';

export const metadata: Metadata = { title: 'Possible duplicate customers' };

export default async function DuplicatesPage() {
  await requireUser();
  const groups = await duplicateSuggestions();
  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        Allegro and Empik hide buyers&apos; real e-mail, so the same person buying on two marketplaces shows up twice. These look like one person: the same phone
        number, or the same name at the same postcode. Merging keeps the older customer and moves orders, notes and tasks to it.
      </p>
      {groups.length === 0 ? (
        <Card>
          <EmptyState title="No likely duplicates" />
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const [keep, ...rest] = [...g.customers].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            return (
              <Card key={g.customers.map((c) => c.id).join('|')}>
                <CardBody className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{g.reason}</p>
                    {g.customers.map((c) => (
                      <p key={c.id} className="text-sm">
                        <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                          {c.displayName}
                        </Link>{' '}
                        <span className="text-slate-500">
                          {c.marketplaces.map((m) => (
                            <span key={m} className="ml-1 inline-flex items-center gap-1">
                              <span className="inline-block size-2 rounded-sm" style={{ background: MARKETPLACE_COLORS[m] }} aria-hidden />
                              {MARKETPLACE_LABELS[m] ?? m}
                            </span>
                          ))}{' '}
                          · {c.ordersCount} order(s) · {formatValue(c.revenue, 'pln')}
                          {c.lastOrderAt && ` · last ${formatDate(c.lastOrderAt, false)}`}
                          {c.city && ` · ${c.city}`}
                        </span>
                      </p>
                    ))}
                  </div>
                  <form action={mergeAction.bind(null, keep.id, rest.map((c) => c.id))}>
                    <SubmitButton variant="secondary" size="sm" confirm={`Merge into ${keep.displayName}? This can't be undone.`}>
                      Merge into one
                    </SubmitButton>
                  </form>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
