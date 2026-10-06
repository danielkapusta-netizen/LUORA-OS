import type { Metadata } from 'next';
import Link from 'next/link';
import { Heatmap, SectionTitle } from '@/components/analytics/blocks';
import { formatValue } from '@/components/analytics/format';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, td, th } from '@/components/ui';
import { cohorts, overdueCustomers, repeatStats, SEGMENT_ORDER, SEGMENTS, segmentCustomers, segmentTag } from '@/lib/crm/segments';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { loadCrmSettings, pendingTagChanges } from '@/server/services/crm-sync';
import { allCustomers, orderDatesByCustomer } from '@/server/services/customers';
import { runCrmSyncAction, saveCrmSettingsAction } from '../actions';

export const metadata: Metadata = { title: 'Customer segments' };

export default async function SegmentsPage() {
  const user = await requireUser();
  const [list, dates, settings] = await Promise.all([allCustomers(), orderDatesByCustomer(), loadCrmSettings()]);
  const segments = segmentCustomers(list);
  const stats = repeatStats(list, dates);
  const totalRevenue = list.reduce((s, c) => s + c.revenue, 0);
  const groups = SEGMENT_ORDER.map((key) => {
    const members = list.filter((c) => segments.get(c.id)?.segment === key);
    const revenue = members.reduce((s, c) => s + c.revenue, 0);
    return { key, members, revenue, orders: members.reduce((s, c) => s + c.ordersCount, 0) };
  });
  const cohortRows = cohorts(dates, 12);
  const byId = new Map(list.map((c) => [c.id, c]));
  const overdue = overdueCustomers(dates)
    .map((o) => ({ ...o, customer: byId.get(o.id)! }))
    .filter((o) => o.customer)
    .sort((a, b) => b.customer.revenue - a.customer.revenue)
    .slice(0, 15);
  const pending = user.role === 'admin' ? await pendingTagChanges(settings) : [];
  const shopifyCustomers = list.filter((c) => c.email && c.marketplaces.includes('shopify')).length;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          title="Segments"
          description={`By how recently, how often and how much each customer bought. ${Math.round(stats.repeatRate * 100)}% of customers came back for a second order${stats.medianDaysToSecond !== null ? `, typically after ${stats.medianDaysToSecond} days` : ''}.`}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {groups.map((g) => (
            <Link key={g.key} href={`/customers?segment=${g.key}`} className="rounded-2xl border border-black/5 bg-white p-4 hover:border-brand-500">
              <div className="flex items-center justify-between">
                <Badge tone={SEGMENTS[g.key].tone}>{SEGMENTS[g.key].label}</Badge>
                <span className="text-xl font-semibold tabular-nums">{g.members.length}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{SEGMENTS[g.key].description}</p>
              <p className="mt-2 text-sm tabular-nums text-slate-700">
                {formatValue(g.revenue, 'pln')} · {totalRevenue > 0 ? Math.round((g.revenue / totalRevenue) * 100) : 0}% of revenue
              </p>
              <p className="mt-1 text-xs text-slate-600">{SEGMENTS[g.key].action}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title="Do they come back?" description="Each row is the customers whose first order fell in that month; each cell is the share who ordered again that many months later." />
        <Card>
          <CardBody>
            {cohortRows.length ? (
              <Heatmap
                rows={cohortRows.map((c) => `${c.month} (${c.size})`)}
                columns={Array.from({ length: 12 }, (_, k) => `M${k}`)}
                cells={cohortRows.flatMap((c) =>
                  c.retention.map((v, k) => ({ row: `${c.month} (${c.size})`, column: `M${k}`, value: v === null ? 0 : v, intensity: v === null || k === 0 ? 0 : Math.min(1, v * 3) })),
                )}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            ) : (
              <p className="text-sm text-slate-500">No orders yet.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">M0 is the month of the first order. Empty cells are months that haven&apos;t happened yet.</p>
          </CardBody>
        </Card>
      </section>

      <section>
        <SectionTitle title="Regulars who went quiet" description="Customers with two or more orders who are now over twice their usual gap since the last one, biggest spenders first." />
        <Card className="overflow-x-auto">
          {overdue.length ? (
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>Customer</th>
                  <th className={cn(th, 'text-right')}>Usually every</th>
                  <th className={cn(th, 'text-right')}>Last order</th>
                  <th className={cn(th, 'text-right')}>Lifetime revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overdue.map((o) => (
                  <tr key={o.id}>
                    <td className={td}>
                      <Link href={`/customers/${o.id}`} className="font-medium hover:underline">
                        {o.customer.displayName}
                      </Link>
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{o.usualGapDays} days</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{o.daysSince} days ago</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(o.customer.revenue, 'pln')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-4 text-sm text-slate-500">Nobody is overdue.</p>
          )}
        </Card>
      </section>

      {user.role === 'admin' && (
        <Card>
          <CardHeader
            title="Write segments to Shopify"
            description="Adds a tag such as luora-vip to the matching Shopify customers, so Shopify Email, Klaviyo and similar tools can target them. Only customers who bought on Shopify: Allegro and Empik buyer data may not be used for your own marketing."
            actions={
              <ActionForm action={runCrmSyncAction} popup="Shopify tag sync">
                <SubmitButton size="sm" variant="secondary">
                  Sync now
                </SubmitButton>
              </ActionForm>
            }
          />
          <CardBody className="space-y-4">
            <Alert tone="blue">
              The Shopify app needs the <code>read_customers</code> and <code>write_customers</code> scopes. {shopifyCustomers} customer(s) can be synced;{' '}
              {pending.length} would change with the settings below{settings.dryRun ? ' (dry run: nothing is sent yet)' : ''}.
            </Alert>
            <ActionForm action={saveCrmSettingsAction} className="space-y-4">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Segments to tag</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SEGMENT_ORDER.map((key) => (
                    <Checkbox
                      key={key}
                      name="syncSegments"
                      value={key}
                      defaultChecked={settings.syncSegments.includes(key)}
                      label={
                        <>
                          {SEGMENTS[key].label} <code className="text-xs text-slate-500">{segmentTag(key)}</code>
                        </>
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-col gap-2">
                <Checkbox name="syncManualTags" label="Also write the tags staff add to customers" defaultChecked={settings.syncManualTags} />
                <Checkbox name="dryRun" label="Dry run: count the changes but don't send them" defaultChecked={settings.dryRun} />
              </div>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
