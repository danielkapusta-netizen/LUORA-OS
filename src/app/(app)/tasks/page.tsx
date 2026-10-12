import { ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import Link from 'next/link';
import { Pills } from '@/components/analytics/blocks';
import { TagChip } from '@/components/tasks/chips';
import { ProductivityCard } from '@/components/tasks/productivity';
import { ProjectCardView } from '@/components/tasks/project-card';
import { ProjectDialog } from '@/components/tasks/project-dialog';
import { TaskCardView } from '@/components/tasks/task-card';
import { NewTaskDialog } from '@/components/tasks/task-dialog';
import { TaskFilterBar } from '@/components/tasks/filter-bar';
import { WeekStrip } from '@/components/tasks/week-strip';
import { Card, EmptyState } from '@/components/ui';
import { addDays, dayLabel, isDay, today as warsawToday, weekDays } from '@/lib/tasks/dates';
import { compareTasks, groupForDay } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { calendarCounts, listTasks, productivity } from '@/server/services/tasks';
import { getActiveProjects, getPeople, getTagCounts, link, resolveScope, type TaskParams } from './params';

const SHOWN_TAGS = 12;
const UNDATED_SHOWN = 8;
const COMING_UP_SHOWN = 10;

export default async function TasksOverviewPage({ searchParams }: { searchParams: Promise<TaskParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const now = warsawToday();
  const day = isDay(params.day) ? params.day : now;
  const people = await getPeople();
  const scope = resolveScope(params, user.id, people);
  const week = weekDays(day);
  const [open, projectCards, tagList, counts, figures] = await Promise.all([
    listTasks({ ...scope, openOrDay: day }),
    getActiveProjects(),
    getTagCounts(),
    calendarCounts(week[0], week[6], scope.assignee),
    productivity({ assignee: scope.assignee }),
  ]);

  const groups = groupForDay(open, day, now);
  const shownIds = new Set([...groups.overdue, ...groups.planned].map((t) => t.id));
  const allPriorities = params.prio === 'all';
  const comingUp = open
    .filter((t) => t.status !== 'done' && !shownIds.has(t.id) && (allPriorities || t.priority === 'high' || t.priority === 'urgent'))
    .sort(compareTasks)
    .slice(0, COMING_UP_SHOWN);
  const dayTags = new Map<string, number>();
  for (const t of [...groups.overdue, ...groups.planned]) for (const tag of t.tags) dayTags.set(tag, (dayTags.get(tag) ?? 0) + 1);
  const compact = params.view === 'compact';
  const me = { id: user.id, role: user.role };
  const dialog = {
    people,
    projects: projectCards.map((p) => ({ id: p.project.id, name: p.project.name })),
    tags: tagList.map((t) => t.tag),
    meId: user.id,
  };
  const here = (change: Partial<Record<keyof TaskParams, string | undefined>> = {}) => link('/tasks', params, change);
  const tileProjects = [...projectCards].sort((a, b) => b.open - a.open).slice(0, 4);
  const allTags = params.tags === 'all';
  const tagHref = (tag: string) => here({ tag: params.tag === tag ? undefined : tag });

  return (
    <>
      <TaskFilterBar path="/tasks" params={params} people={people} projects={dialog.projects} meId={user.id} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[17rem_minmax(0,1fr)_14rem]">
        {/* Projects and tags */}
        <aside className="order-3 space-y-6 xl:order-none">
          <section aria-label="Projects">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Projects</h2>
              <Link href="/tasks/projects" className="text-xs text-slate-600 hover:text-slate-900 hover:underline">
                All projects →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
              {tileProjects.map((p) => (
                <ProjectCardView key={p.project.id} card={p} today={now} />
              ))}
              {tileProjects.length < 4 && (
                <ProjectDialog
                  people={people}
                  variant="ghost"
                  label="New project"
                  buttonClassName="h-auto min-h-32 flex-col justify-center rounded-2xl border border-dashed border-slate-300 bg-white/50 text-slate-500 hover:border-brand-500 hover:bg-white hover:text-brand-700"
                />
              )}
            </div>
          </section>
          <section aria-label="Tags">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Tags</h2>
              {tagList.length > SHOWN_TAGS && (
                <Link href={here({ tags: allTags ? undefined : 'all' })} className="text-xs text-slate-600 hover:text-slate-900 hover:underline">
                  {allTags ? 'Fewer tags' : 'All tags →'}
                </Link>
              )}
            </div>
            {tagList.length === 0 ? (
              <p className="text-sm text-slate-500">Tags group tasks across projects, e.g. #posters. Add them when you create a task.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tagList.slice(0, allTags ? undefined : SHOWN_TAGS).map((t) => (
                  <TagChip key={t.tag} tag={t.tag} href={here({ tag: params.tag === t.tag ? undefined : t.tag })} active={params.tag === t.tag} />
                ))}
              </div>
            )}
          </section>
        </aside>

        {/* The day's tasks */}
        <div className="order-1 min-w-0 space-y-5 xl:order-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Link href={here({ day: addDays(day, -1) })} aria-label="Previous day" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
                <ChevronLeft className="size-4" />
              </Link>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{day === now ? 'Tasks for today' : `Tasks for ${dayLabel(day, now)}`}</h2>
              <Link href={here({ day: addDays(day, 1) })} aria-label="Next day" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
                <ChevronRight className="size-4" />
              </Link>
              {day !== now && (
                <Link href={here({ day: undefined })} className="ml-1 text-xs font-medium text-brand-700 hover:underline">
                  Back to today
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
                <Link href={here({ view: undefined })} aria-label="Cards" aria-current={!compact ? 'true' : undefined} className={cn('rounded-full p-1.5', !compact ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                  <LayoutGrid className="size-3.5" />
                </Link>
                <Link href={here({ view: 'compact' })} aria-label="Compact list" aria-current={compact ? 'true' : undefined} className={cn('rounded-full p-1.5', compact ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                  <List className="size-3.5" />
                </Link>
              </div>
              <NewTaskDialog {...dialog} defaults={{ dueDate: day }} />
            </div>
          </div>

          {dayTags.size > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Tags in this list">
              {[...dayTags]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([tag]) => (
                  <TagChip key={tag} tag={tag} href={here({ tag: params.tag === tag ? undefined : tag })} active={params.tag === tag} />
                ))}
            </div>
          )}

          {groups.overdue.length > 0 && (
            <section aria-label="Overdue" className="space-y-2.5">
              <h3 className="text-sm font-semibold text-red-700">Overdue · {groups.overdue.length}</h3>
              {groups.overdue.map((t) => (
                <TaskCardView key={t.id} card={t} today={now} me={me} due="day" compact={compact} tagHref={tagHref} />
              ))}
            </section>
          )}

          <section aria-label="Planned for the day" className="space-y-2.5">
            {groups.overdue.length > 0 && <h3 className="text-sm font-semibold text-slate-700">{day === now ? 'Today' : dayLabel(day, now)}</h3>}
            {groups.planned.length === 0 ? (
              <Card>
                <EmptyState title={day === now ? 'Nothing planned for today' : 'Nothing planned for this day'}>
                  Add a task for it, or pick another day in the calendar.
                </EmptyState>
              </Card>
            ) : (
              groups.planned.map((t) => <TaskCardView key={t.id} card={t} today={now} me={me} due="time" compact={compact} tagHref={tagHref} />)
            )}
          </section>

          {groups.undated.length > 0 && (
            <section aria-label="No day set" className="space-y-2.5">
              <h3 className="text-sm font-semibold text-slate-700">No day set · {groups.undated.length}</h3>
              {groups.undated.slice(0, UNDATED_SHOWN).map((t) => (
                <TaskCardView key={t.id} card={t} today={now} me={me} due="day" compact={compact} tagHref={tagHref} />
              ))}
              {groups.undated.length > UNDATED_SHOWN && (
                <Link href={link('/tasks/board', params)} className="inline-block text-xs font-medium text-brand-700 hover:underline">
                  {groups.undated.length - UNDATED_SHOWN} more on the board
                </Link>
              )}
            </section>
          )}

          <section aria-label="Coming up" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Coming up</h3>
              <Pills
                label="Which tasks"
                options={[
                  { value: 'high', label: 'High priority' },
                  { value: 'all', label: 'Everything open' },
                ]}
                active={allPriorities ? 'all' : 'high'}
                href={(v) => here({ prio: v === 'all' ? 'all' : undefined })}
              />
            </div>
            {comingUp.length === 0 ? (
              <Card>
                <EmptyState title={allPriorities ? 'Nothing else is open' : 'No high priority tasks waiting'} />
              </Card>
            ) : (
              comingUp.map((t) => <TaskCardView key={t.id} card={t} today={now} me={me} due="day" compact={compact} tagHref={tagHref} />)
            )}
          </section>

          <ProductivityCard data={figures} now={now} />
        </div>

        {/* The week */}
        <aside className="order-2 xl:order-none">
          <WeekStrip
            days={week}
            selected={day}
            today={now}
            counts={Object.fromEntries(counts)}
            href={(d) => here({ day: d === now ? undefined : d })}
            previousHref={here({ day: addDays(day, -7) })}
            nextHref={here({ day: addDays(day, 7) })}
            monthHref={link('/tasks/calendar', { who: params.who }, { month: day })}
          />
        </aside>
      </div>
    </>
  );
}
