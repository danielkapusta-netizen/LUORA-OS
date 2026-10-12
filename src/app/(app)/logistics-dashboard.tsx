import Link from 'next/link';
import { BriefCard } from '@/components/analytics/blocks';
import { Card, CardBody, CardHeader, PageHeader, td, th } from '@/components/ui';
import { buildLogisticsBrief, warsawHour } from '@/lib/logistics-brief';
import { dayLabel, today as warsawToday } from '@/lib/tasks/dates';
import { dueState } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/server/auth';
import { ordersToShipByCourier, statusCounts } from '@/server/services/orders';
import { listTasks } from '@/server/services/tasks';

const TILES = [
  { status: 'new', label: 'New' },
  { status: 'processing', label: 'Processing' },
  { status: 'label_created', label: 'Label created' },
  { status: 'on_hold', label: 'On hold' },
] as const;

/** The Dashboard for roles without analytics: orders to do, tasks, and who is carrying the parcels. No money anywhere. */
export async function LogisticsDashboard({ user }: { user: SessionUser }) {
  const [counts, couriers, tasks] = await Promise.all([statusCounts(), ordersToShipByCourier(), listTasks({ assignee: user.id, status: 'open', limit: 40 })]);
  const todayKey = warsawToday();
  const due = tasks.filter((t) => ['overdue', 'today'].includes(dueState(t, todayKey)));
  const brief = buildLogisticsBrief({ counts, couriers, tasksDue: due.length, tasksOpen: tasks.length }, user.name.split(' ')[0], warsawHour());

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="What is waiting to be sent, and your tasks." />

      <section aria-label="Open orders" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((o) => (
          <Link key={o.status} href={`/orders?status=${o.status}`} className="rounded-2xl border border-black/5 bg-white px-4 py-3 hover:border-brand-500">
            <p className="text-xs font-medium text-slate-500">{o.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{counts[o.status] ?? 0}</p>
          </Link>
        ))}
      </section>

      <BriefCard brief={brief} atStake={0} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader title="Parcels by courier" description="Orders still to be sent, by the delivery method the buyer chose." />
          {couriers.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">Nothing is waiting to be sent.</p>
            </CardBody>
          ) : (
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>Courier</th>
                  <th className={cn(th, 'text-right')}>Orders</th>
                  <th className={cn(th, 'text-right')}>With label</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {couriers.map((c) => (
                  <tr key={c.courier}>
                    <td className={cn(td, 'font-medium')}>{c.courier}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{c.count}</td>
                    <td className={cn(td, 'text-right tabular-nums text-slate-500')}>{c.labelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardBody className="space-y-2">
            <p className="flex items-center justify-between text-sm font-semibold">
              My tasks
              <Link href="/tasks?who=me" className="text-xs font-normal text-brand-700 hover:underline">
                All tasks →
              </Link>
            </p>
            {tasks.length ? (
              <ul className="space-y-1 text-sm">
                {tasks.slice(0, 6).map((task) => {
                  const state = dueState(task, todayKey);
                  return (
                    <li key={task.id} className="flex justify-between gap-3">
                      <Link href={`/tasks/${task.id}`} className="truncate hover:underline">
                        {task.title}
                      </Link>
                      <span className={cn('shrink-0 text-xs text-slate-500', state === 'overdue' && 'font-medium text-red-700', state === 'today' && 'font-medium text-brand-700')}>
                        {task.dueDate ? dayLabel(task.dueDate, todayKey) : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nothing assigned to you.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
