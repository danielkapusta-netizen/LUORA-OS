import Link from 'next/link';
import { BriefCard } from '@/components/analytics/blocks';
import { Card, CardBody, CardHeader, PageHeader, td, th } from '@/components/ui';
import { buildLogisticsBrief, warsawHour } from '@/lib/logistics-brief';
import { dayLabel, today as warsawToday } from '@/lib/tasks/dates';
import { dueState } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/server/auth';
import { labelReadyCount, ordersToShipByCourier, statusCounts } from '@/server/services/orders';
import { listTasks } from '@/server/services/tasks';
import { MyTasksHeading, TASK_LIMIT, tasksCardTone } from '@/components/tasks/my-tasks-heading';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

const TILES = [
  { status: 'new', label: msg('New') },
  { status: 'processing', label: msg('Processing') },
  { status: 'label_created', label: msg('Label created') },
  { status: 'on_hold', label: msg('On hold') },
] as const;

/** The Dashboard for roles without analytics: orders to do, tasks, and who is carrying the parcels. No money anywhere. */
export async function LogisticsDashboard({ user }: { user: SessionUser }) {
  const t = await getT();
  const [counts, labelReady, couriers, tasks] = await Promise.all([statusCounts(), labelReadyCount(), ordersToShipByCourier(), listTasks({ assignee: user.id, status: 'open', limit: TASK_LIMIT })]);
  const todayKey = warsawToday();
  const due = tasks.filter((item) => ['overdue', 'today'].includes(dueState(item, todayKey)));
  const brief = buildLogisticsBrief({ counts, couriers, tasksDue: due.length, tasksOpen: tasks.length }, user.name.split(' ')[0], warsawHour());

  return (
    <div className="space-y-6">
      <PageHeader title={t('Dashboard')} description={t('What is waiting to be sent, and your tasks.')} />

      <section aria-label={t('Open orders')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((o) => (
          <Link key={o.status} href={`/orders?status=${o.status}`} className="rounded-2xl border border-black/5 bg-white px-4 py-3 hover:border-brand-500">
            <p className="text-xs font-medium text-slate-500">{t(o.label)}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{o.status === 'label_created' ? labelReady : (counts[o.status] ?? 0)}</p>
          </Link>
        ))}
      </section>

      <BriefCard brief={brief} atStake={0} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader title={t('Parcels by courier')} description={t('Orders still to be sent, by the delivery method the buyer chose.')} />
          {couriers.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">{t('Nothing is waiting to be sent.')}</p>
            </CardBody>
          ) : (
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>{t('Courier')}</th>
                  <th className={cn(th, 'text-right')}>{t('Orders')}</th>
                  <th className={cn(th, 'text-right')}>{t('With label')}</th>
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

        <Card className={tasksCardTone(tasks.length)}>
          <CardBody className="space-y-2">
            <MyTasksHeading count={tasks.length} limit={TASK_LIMIT} />
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
                        {task.dueDate ? dayLabel(task.dueDate, todayKey, t) : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{t('Nothing assigned to you.')}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
