import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { AvatarStack } from '@/components/tasks/avatars';
import { Board } from '@/components/tasks/board';
import { TaskFilterBar } from '@/components/tasks/filter-bar';
import { ProjectDialog } from '@/components/tasks/project-dialog';
import { NewTaskDialog } from '@/components/tasks/task-dialog';
import { Badge } from '@/components/ui';
import { shortDay, today as warsawToday } from '@/lib/tasks/dates';
import { projectColor } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { getProject, listTasks } from '@/server/services/tasks';
import { archiveProjectAction, deleteProjectAction } from '../../actions';
import { statusColumns } from '../../columns';
import { getActiveProjects, getPeople, getTagCounts, link, resolveScope, type TaskParams } from '../../params';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<TaskParams> }) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const card = await getProject(id);
  if (!card) notFound();
  const now = warsawToday();
  const people = await getPeople();
  const scope = resolveScope(query, user.id, people);
  const allDone = query.done === 'all';
  const [cards, tagList, active] = await Promise.all([
    listTasks({ ...scope, projectId: id, ...(allDone ? {} : { doneWithinDays: 14 }), limit: 600 }),
    getTagCounts(),
    getActiveProjects(),
  ]);
  const { project, open, done, overdue, nextDue, members } = card;
  const total = open + done;
  const color = projectColor(project.color);
  const path = `/tasks/projects/${id}`;
  const dialog = { people, projects: active.map((p) => ({ id: p.project.id, name: p.project.name })), tags: tagList.map((t) => t.tag), meId: user.id };
  const columns = statusColumns({
    cards,
    today: now,
    me: { id: user.id, role: user.role },
    dialog,
    defaults: { projectId: project.archivedAt ? undefined : id },
    tagHref: (tag) => link(path, query, { tag }),
  });
  const owner = people.find((p) => p.id === project.ownerId);

  return (
    <>
      <Link href="/tasks/projects" className="mb-3 inline-block text-sm text-slate-500 hover:text-slate-800">
        ← All projects
      </Link>
      <div className="mb-5 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <span className={cn('block h-1.5 w-full', color.bar)} aria-hidden />
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 max-w-2xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{project.name}</h2>
              {project.archivedAt && <Badge>Archived</Badge>}
            </div>
            {project.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{project.description}</p>}
            <p className="text-xs text-slate-500">
              {owner ? `Owner: ${owner.name}` : 'No owner'}
              {nextDue && ` · next due ${shortDay(nextDue, now)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!project.archivedAt && <NewTaskDialog {...dialog} defaults={{ projectId: id }} />}
            <ProjectDialog people={people} project={{ id, name: project.name, description: project.description, color: project.color, ownerId: project.ownerId }} />
            <form action={archiveProjectAction.bind(null, id, !project.archivedAt)}>
              <SubmitButton variant="secondary" size="md" pendingText="…">
                {project.archivedAt ? 'Restore' : 'Archive'}
              </SubmitButton>
            </form>
            {total === 0 && (
              <ActionForm action={deleteProjectAction.bind(null, id)}>
                <SubmitButton variant="danger" pendingText="Deleting…" confirm="Delete this project?">
                  Delete
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Progress</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{total ? `${Math.round((done / total) * 100)}%` : '—'}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full', color.bar)} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Open</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{open}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Overdue</p>
            <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', overdue > 0 && 'text-red-700')}>{overdue}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">People</p>
            <div className="mt-1.5">{members.length ? <AvatarStack people={members} max={5} /> : <span className="text-sm text-slate-400">Nobody yet</span>}</div>
          </div>
        </div>
      </div>
      <TaskFilterBar path={path} params={query} people={people} meId={user.id} />
      <div className="mb-3 text-xs text-slate-500">
        Finished tasks from the last 14 days.{' '}
        <Link href={link(path, query, { done: allDone ? undefined : 'all' })} className="font-medium text-brand-700 hover:underline">
          {allDone ? 'Show only recent ones' : 'Show every finished task'}
        </Link>
      </div>
      <Board columns={columns} />
    </>
  );
}
