import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { MonthGrid } from '@/components/tasks/month-grid';
import { TaskFilterBar } from '@/components/tasks/filter-bar';
import { TaskCardView } from '@/components/tasks/task-card';
import { NewTaskDialog } from '@/components/tasks/task-dialog';
import { Card, CardBody, EmptyState } from '@/components/ui';
import { addMonths, dayLabel, isDay, monthGrid, monthTitle, shortDay, today as warsawToday } from '@/lib/tasks/dates';
import { requireUser } from '@/server/auth';
import { listTasks, type TaskCard } from '@/server/services/tasks';
import { getActiveProjects, getPeople, getTagCounts, link, resolveScope, type TaskParams } from '../params';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<TaskParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const now = warsawToday();
  const month = isDay(params.month) ? params.month : now;
  const people = await getPeople();
  const scope = resolveScope(params, user.id, people);
  const weeks = monthGrid(month);
  const [cards, projectCards, tagList] = await Promise.all([
    listTasks({ ...scope, from: weeks[0][0].day, to: weeks[weeks.length - 1][6].day, limit: 800 }),
    getActiveProjects(),
    getTagCounts(),
  ]);
  const tasksByDay: Record<string, TaskCard[]> = {};
  for (const c of cards) if (c.dueDate) (tasksByDay[c.dueDate] ??= []).push(c);
  // The day panel shows the picked day, or today when it is in the month on screen.
  const selected = isDay(params.day) ? params.day : month.slice(0, 7) === now.slice(0, 7) ? now : null;
  const me = { id: user.id, role: user.role };
  const dialog = { people, projects: projectCards.map((p) => ({ id: p.project.id, name: p.project.name })), tags: tagList.map((t) => t.tag), meId: user.id };
  const here = (change: Partial<Record<keyof TaskParams, string | undefined>>) => link('/tasks/calendar', params, change);
  const onThisDay = selected ? (tasksByDay[selected] ?? []) : [];

  return (
    <>
      <TaskFilterBar path="/tasks/calendar" params={params} people={people} projects={dialog.projects} meId={user.id} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={here({ month: addMonths(month, -1), day: undefined })} aria-label="Previous month" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronLeft className="size-4" />
          </Link>
          <h2 className="min-w-40 text-center text-xl font-semibold tracking-tight text-slate-900">{monthTitle(month)}</h2>
          <Link href={here({ month: addMonths(month, 1), day: undefined })} aria-label="Next month" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <ChevronRight className="size-4" />
          </Link>
          {month.slice(0, 7) !== now.slice(0, 7) && (
            <Link href={here({ month: undefined, day: undefined })} className="ml-2 text-xs font-medium text-brand-700 hover:underline">
              Back to today
            </Link>
          )}
        </div>
        <NewTaskDialog {...dialog} defaults={{ dueDate: selected ?? undefined }} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <MonthGrid weeks={weeks} today={now} selected={selected} tasksByDay={tasksByDay} dayHref={(d) => here({ day: d })} />
        <aside aria-label="The picked day" className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            {selected ? dayLabel(selected, now) : 'Pick a day'}
            {selected && ['Today', 'Tomorrow', 'Yesterday'].includes(dayLabel(selected, now)) && <span className="ml-2 text-sm font-normal text-slate-500">{shortDay(selected, now)}</span>}
          </h2>
          {selected === null ? (
            <Card>
              <CardBody className="text-sm text-slate-500">Choose a day in the calendar to see its tasks here.</CardBody>
            </Card>
          ) : onThisDay.length === 0 ? (
            <Card>
              <EmptyState title="Nothing planned for this day">
                <span className="mt-2 block">
                  <NewTaskDialog {...dialog} defaults={{ dueDate: selected }} label="Add a task" variant="secondary" size="sm" />
                </span>
              </EmptyState>
            </Card>
          ) : (
            onThisDay.map((c) => <TaskCardView key={c.id} card={c} today={now} me={me} variant="card" due="time" tagHref={(tag) => link('/tasks/calendar', params, { tag })} />)
          )}
        </aside>
      </div>
    </>
  );
}
