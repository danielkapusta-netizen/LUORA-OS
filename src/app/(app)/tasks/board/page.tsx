import Link from 'next/link';
import { Board } from '@/components/tasks/board';
import { TaskFilterBar } from '@/components/tasks/filter-bar';
import { today as warsawToday } from '@/lib/tasks/dates';
import { STATUS_LABEL } from '@/lib/tasks/model';
import { requireUser } from '@/server/auth';
import { listTasks } from '@/server/services/tasks';
import { statusColumns } from '../columns';
import { getActiveProjects, getPeople, getTagCounts, link, resolveScope, type TaskParams } from '../params';

export default async function BoardPage({ searchParams }: { searchParams: Promise<TaskParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const now = warsawToday();
  const people = await getPeople();
  const scope = resolveScope(params, user.id, people);
  const allDone = params.done === 'all';
  const [cards, projectCards, tagList] = await Promise.all([
    listTasks({ ...scope, ...(allDone ? {} : { doneWithinDays: 7 }), limit: 600 }),
    getActiveProjects(),
    getTagCounts(),
  ]);
  const dialog = { people, projects: projectCards.map((p) => ({ id: p.project.id, name: p.project.name })), tags: tagList.map((t) => t.tag), meId: user.id };
  const columns = statusColumns({
    cards,
    today: now,
    me: { id: user.id, role: user.role },
    dialog,
    defaults: { projectId: scope.projectId && scope.projectId !== 'none' ? scope.projectId : undefined },
    tagHref: (tag) => link('/tasks/board', params, { tag }),
  });

  return (
    <>
      <TaskFilterBar path="/tasks/board" params={params} people={people} projects={dialog.projects} meId={user.id} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <p>
          {cards.length} {cards.length === 1 ? 'task' : 'tasks'} · {STATUS_LABEL.done} shows the last 7 days.{' '}
          <Link href={link('/tasks/board', params, { done: allDone ? undefined : 'all' })} className="font-medium text-brand-700 hover:underline">
            {allDone ? 'Show only the last week' : 'Show every finished task'}
          </Link>
        </p>
        <p>Drag a card to another column to change its status.</p>
      </div>
      <Board columns={columns} />
    </>
  );
}
