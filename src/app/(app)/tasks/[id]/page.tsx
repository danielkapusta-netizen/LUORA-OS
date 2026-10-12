import { Check, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Avatar } from '@/components/tasks/avatars';
import { DueChip, ProjectChip } from '@/components/tasks/chips';
import { PeoplePicker } from '@/components/tasks/people-picker';
import { Badge, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { today as warsawToday } from '@/lib/tasks/dates';
import { PRIORITY_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/tasks/model';
import { cn, formatDate } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { getTask } from '@/server/services/tasks';
import { addChecklistItemAction, addCommentAction, deleteTaskAndLeaveAction, removeChecklistItemAction, saveTaskAction, toggleChecklistItemAction } from '../actions';
import { getActiveProjects, getPeople } from '../params';

export const metadata: Metadata = { title: 'Task' };

const STATUS_TONE = { todo: 'gray', in_progress: 'amber', done: 'green' } as const;

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [data, people, projectCards] = await Promise.all([getTask(id), getPeople(), getActiveProjects()]);
  if (!data) notFound();
  const { card: t, comments, createdByName } = data;
  const now = warsawToday();
  // The task's own project stays selectable even when it has been archived.
  const projects = projectCards.map((p) => ({ id: p.project.id, name: p.project.name }));
  if (t.project && !projects.some((p) => p.id === t.project!.id)) projects.push({ id: t.project.id, name: `${t.project.name} (archived)` });
  const canDelete = !t.createdBy || t.createdBy === user.id || user.role === 'admin';
  const progress = t.progress.total ? (t.progress.done / t.progress.total) * 100 : 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/tasks" className="text-sm text-slate-500 hover:text-slate-800">
          ← All tasks
        </Link>
        <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
        {t.project && <ProjectChip project={t.project} />}
        <DueChip task={t} today={now} />
      </div>

      <ActionForm action={saveTaskAction.bind(null, t.id)} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] [&>p]:col-span-full">
        <Card>
          <CardBody className="space-y-4">
            <Field label="Title">
              <Input name="title" required maxLength={200} defaultValue={t.title} className="h-11 text-base font-medium" />
            </Field>
            <Field label="Description">
              <Textarea name="description" rows={7} maxLength={5000} defaultValue={t.description ?? ''} placeholder="What needs doing, and anything the person should know" />
            </Field>
            <Field label="Tags" hint="Separate with commas, e.g. posters, ideas">
              <Input name="tags" defaultValue={t.tags.join(', ')} />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select name="status" defaultValue={t.status}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority">
                <Select name="priority" defaultValue={t.priority}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Project">
              <Select name="projectId" defaultValue={t.projectId ?? ''}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day" className="col-span-2">
                <Input name="dueDate" type="date" defaultValue={t.dueDate ?? ''} />
              </Field>
              <Field label="From">
                <Input name="startTime" type="time" defaultValue={t.startTime ?? ''} />
              </Field>
              <Field label="Until">
                <Input name="endTime" type="time" defaultValue={t.endTime ?? ''} />
              </Field>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Who is it for?</span>
              <PeoplePicker people={people} selected={t.assignees.map((a) => a.id)} />
            </div>
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </CardBody>
        </Card>
      </ActionForm>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Checklist" description={t.progress.total ? `${t.progress.done} of ${t.progress.total} done` : 'Break the task into small steps'} />
            <CardBody className="space-y-3">
              {t.progress.total > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-900" style={{ width: `${progress}%` }} />
                </div>
              )}
              <ul className="space-y-1">
                {t.checklist.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <form action={toggleChecklistItemAction.bind(null, t.id, item.id)}>
                      <button aria-label={`${item.done ? 'Untick' : 'Tick'}: ${item.text}`} className="flex size-5 items-center justify-center">
                        <span className={cn('flex size-4 items-center justify-center rounded-full border-2', item.done ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:border-brand-600')}>
                          {item.done && <Check className="size-2.5" strokeWidth={4} aria-hidden />}
                        </span>
                      </button>
                    </form>
                    <span className={cn('min-w-0 flex-1 text-sm', item.done && 'text-slate-400 line-through')}>{item.text}</span>
                    <form action={removeChecklistItemAction.bind(null, t.id, item.id)}>
                      <button aria-label={`Remove: ${item.text}`} className="rounded p-1 text-slate-300 hover:text-red-600">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              <ActionForm action={addChecklistItemAction.bind(null, t.id)} resetOnSuccess showOk={false} className="flex gap-2">
                <Input name="text" placeholder="Add a step" maxLength={200} aria-label="New checklist item" required />
                <SubmitButton size="sm" variant="secondary" pendingText="…">
                  Add
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Comments and activity" />
            <CardBody className="space-y-4">
              <ActionForm action={addCommentAction.bind(null, t.id)} resetOnSuccess showOk={false} className="space-y-2">
                <Textarea name="body" rows={2} placeholder="Write a comment…" maxLength={2000} required aria-label="Comment" />
                <SubmitButton size="sm" pendingText="Posting…">
                  Comment
                </SubmitButton>
              </ActionForm>
              <ol className="space-y-3">
                {[...comments].reverse().map((c) =>
                  c.kind === 'event' ? (
                    <li key={c.id} className="flex items-start gap-2 text-xs text-slate-500">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden />
                      <span>
                        <span className="font-medium text-slate-700">{c.userName ?? 'Someone'}</span> {c.body} · {formatDate(c.createdAt)}
                      </span>
                    </li>
                  ) : (
                    <li key={c.id} className="flex gap-3">
                      <Avatar person={{ id: c.userId ?? c.id, name: c.userName ?? '?' }} />
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="font-medium text-slate-900">{c.userName ?? 'Someone'}</span> <span className="text-xs text-slate-500">{formatDate(c.createdAt)}</span>
                        </p>
                        <p className="whitespace-pre-wrap text-sm text-slate-800">{c.body}</p>
                      </div>
                    </li>
                  ),
                )}
              </ol>
            </CardBody>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="About" />
          <CardBody className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-slate-500">Created</dt>
              <dd>
                {createdByName ?? 'Someone'} · {formatDate(t.createdAt)}
              </dd>
              {t.doneAt && (
                <>
                  <dt className="text-slate-500">Finished</dt>
                  <dd>{formatDate(t.doneAt)}</dd>
                </>
              )}
              {t.customer && (
                <>
                  <dt className="text-slate-500">Customer</dt>
                  <dd>
                    <Link href={`/customers/${t.customer.id}`} className="hover:underline">
                      {t.customer.name}
                    </Link>
                  </dd>
                </>
              )}
              {t.order && (
                <>
                  <dt className="text-slate-500">Order</dt>
                  <dd>
                    <Link href={`/orders/${t.order.id}`} className="hover:underline">
                      {t.order.number}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
            {canDelete && (
              <ActionForm action={deleteTaskAndLeaveAction.bind(null, t.id)}>
                <SubmitButton variant="danger" size="sm" pendingText="Deleting…" confirm="Delete this task? This cannot be undone.">
                  Delete task
                </SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
