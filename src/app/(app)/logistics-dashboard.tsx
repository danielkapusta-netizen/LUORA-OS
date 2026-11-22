import { Truck } from 'lucide-react';
import { Card, CardBody, CardHeader, td, th } from '@/components/ui';
import { today as warsawToday } from '@/lib/tasks/dates';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/server/auth';
import { ordersToShipByCourier, pickList, statusCounts } from '@/server/services/orders';
import { listTasks } from '@/server/services/tasks';
import { TASK_LIMIT } from '@/components/tasks/my-tasks-heading';
import { Greeting, PickRow, TasksPanel } from './dashboard-parts';
import { getT } from '@/lib/i18n/server';

/**
 * The Dashboard for roles without analytics, built around packing: how many new orders wait, which couriers
 * they go with, and the person's tasks. No money anywhere.
 */
export async function LogisticsDashboard({ user }: { user: SessionUser }) {
  const t = await getT();
  const [counts, couriers, pick, tasks] = await Promise.all([statusCounts(), ordersToShipByCourier(), pickList(), listTasks({ assignee: user.id, status: 'open', limit: TASK_LIMIT })]);
  const todayKey = warsawToday();
  const firstName = user.name.split(' ')[0];

  return (
    <div className="space-y-6 md:space-y-8">
      <Greeting name={firstName} />

      {/* New orders, with what to take off the shelves for them right beside. */}
      <PickRow newOrders={counts.new ?? 0} lines={pick} />

      {/* The couriers the parcels go out with, next to the tasks. */}
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
