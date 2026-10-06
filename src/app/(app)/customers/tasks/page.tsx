import { Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hrefWith, Pills } from '@/components/analytics/blocks';
import { Card, EmptyState, td, th } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { openTasks } from '@/server/services/customers';
import { toggleTaskAction } from '../actions';

export const metadata: Metadata = { title: 'Customer tasks' };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const user = await requireUser();
  const { who } = await searchParams;
  const mine = who !== 'all';
  const tasks = await openTasks(mine ? user.id : undefined);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="mb-4">
        <Pills
          label="Whose tasks"
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'all', label: 'Everyone' },
          ]}
          active={mine ? 'mine' : 'all'}
          href={(v) => hrefWith('/customers/tasks', {}, { who: v === 'all' ? 'all' : undefined })}
        />
      </div>
      <Card className="overflow-x-auto">
        {tasks.length === 0 ? (
          <EmptyState title="No open tasks">Add tasks on a customer&apos;s page.</EmptyState>
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="w-10" />
                <th className={th}>Task</th>
                <th className={th}>Customer</th>
                <th className={th}>Due</th>
                <th className={th}>For</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map(({ task, customerName, assigneeName }) => {
                const late = task.dueAt && task.dueAt.toISOString().slice(0, 10) < today;
                return (
                  <tr key={task.id}>
                    <td className="py-2 pl-4">
                      <form action={toggleTaskAction.bind(null, task.id, true, '/customers/tasks')}>
                        <button aria-label="Mark as done" className="text-slate-400 hover:text-brand-600">
                          <Circle className="size-4" />
                        </button>
                      </form>
                    </td>
                    <td className={td}>{task.title}</td>
                    <td className={td}>
                      <Link href={`/customers/${task.customerId}`} className="hover:underline">
                        {customerName}
                      </Link>
                    </td>
                    <td className={cn(td, late && 'font-medium text-red-700')}>{task.dueAt ? formatDate(task.dueAt, false) : '—'}</td>
                    <td className={td}>{assigneeName ?? 'Anyone'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
