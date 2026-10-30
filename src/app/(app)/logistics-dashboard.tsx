import { Inbox, Truck } from 'lucide-react';
import { Card, CardBody, CardHeader, StatTile, td, th } from '@/components/ui';
import { today as warsawToday } from '@/lib/tasks/dates';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/server/auth';
import { ordersToShipByCourier, statusCounts } from '@/server/services/orders';
import { listTasks } from '@/server/services/tasks';
import { TASK_LIMIT } from '@/components/tasks/my-tasks-heading';
import { Greeting, TasksPanel } from './dashboard-parts';
import { getT } from '@/lib/i18n/server';

/**
 * The Dashboard for roles without analytics, built around packing: how many new orders wait, which couriers
 * they go with, and the person's tasks. No money anywhere.
 */
export async function LogisticsDashboard({ user }: { user: SessionUser }) {
  const t = await getT();
  const [counts, couriers, tasks] = await Promise.all([statusCounts(), ordersToShipByCourier(), listTasks({ assignee: user.id, status: 'open', limit: TASK_LIMIT })]);
  const todayKey = warsawToday();
  const firstName = user.name.split(' ')[0];

  return (
    <div className="space-y-6 md:space-y-8">
      <Greeting name={firstName} />

      {/* New orders to pack, with the couriers they go out with right beside them. */}
      <div className="grid grid-cols-1 items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <StatTile href="/orders?status=new" tone="sky" icon={Inbox} label={t('New')} value={counts.new ?? 0} caption={t('Waiting to be picked up')} />
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
      </div>

      <TasksPanel tasks={tasks} today={todayKey} limit={TASK_LIMIT} show={6} />
    </div>
  );
}
