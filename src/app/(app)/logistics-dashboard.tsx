import { Truck } from 'lucide-react';
import { BriefCard } from '@/components/analytics/blocks';
import { Card, CardBody, CardHeader, td, th } from '@/components/ui';
import { buildLogisticsBrief, warsawHour } from '@/lib/logistics-brief';
import { today as warsawToday } from '@/lib/tasks/dates';
import { dueState } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/server/auth';
import { labelReadyCount, ordersToShipByCourier, statusCounts } from '@/server/services/orders';
import { listTasks } from '@/server/services/tasks';
import { TASK_LIMIT } from '@/components/tasks/my-tasks-heading';
import { Greeting, OpenOrderTiles, TasksPanel } from './dashboard-parts';
import { getT } from '@/lib/i18n/server';

/** The Dashboard for roles without analytics: orders to do, tasks, and who is carrying the parcels. No money anywhere. */
export async function LogisticsDashboard({ user }: { user: SessionUser }) {
  const t = await getT();
  const [counts, labelReady, couriers, tasks] = await Promise.all([statusCounts(), labelReadyCount(), ordersToShipByCourier(), listTasks({ assignee: user.id, status: 'open', limit: TASK_LIMIT })]);
  const todayKey = warsawToday();
  const firstName = user.name.split(' ')[0];
  const due = tasks.filter((item) => ['overdue', 'today'].includes(dueState(item, todayKey)));
  const brief = buildLogisticsBrief({ counts, couriers, tasksDue: due.length, tasksOpen: tasks.length }, firstName, warsawHour());

  return (
    <div className="space-y-6 md:space-y-8">
      <Greeting name={firstName} />

      <OpenOrderTiles counts={counts} labelReady={labelReady} />

      <BriefCard brief={brief} atStake={0} />

      <div className="grid grid-cols-1 items-start gap-4 md:gap-5 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader icon={Truck} title={t('Parcels by courier')} description={t('Orders still to be sent, by the delivery method the buyer chose.')} />
          {couriers.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">{t('Nothing is waiting to be sent.')}</p>
            </CardBody>
          ) : (
            <table className="mt-2 w-full">
              <thead>
                <tr>
                  <th className={cn(th, 'pl-5')}>{t('Courier')}</th>
                  <th className={cn(th, 'text-right')}>{t('Orders')}</th>
                  <th className={cn(th, 'pr-5 text-right')}>{t('With label')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] border-t border-black/[0.04]">
                {couriers.map((c) => (
                  <tr key={c.courier}>
                    <td className={cn(td, 'pl-5 font-medium')}>{c.courier}</td>
                    <td className={cn(td, 'text-right font-mono tabular-nums')}>{c.count}</td>
                    <td className={cn(td, 'pr-5 text-right font-mono tabular-nums text-slate-500')}>{c.labelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <TasksPanel tasks={tasks} today={todayKey} limit={TASK_LIMIT} show={6} />
      </div>
    </div>
  );
}
