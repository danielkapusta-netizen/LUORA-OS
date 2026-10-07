import { FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { ProjectCardView } from '@/components/tasks/project-card';
import { ProjectDialog } from '@/components/tasks/project-dialog';
import { Card, EmptyState } from '@/components/ui';
import { today as warsawToday } from '@/lib/tasks/dates';
import { requireUser } from '@/server/auth';
import { countTasks, listProjects } from '@/server/services/tasks';
import { getPeople, link, type TaskParams } from '../params';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<TaskParams> }) {
  await requireUser();
  const params = await searchParams;
  const now = warsawToday();
  const showArchived = params.archived === '1';
  const [people, cards, loose] = await Promise.all([getPeople(), listProjects({ includeArchived: showArchived }), countTasks({ projectId: 'none', status: 'open' })]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {cards.length} {cards.length === 1 ? 'project' : 'projects'}.{' '}
          <Link href={link('/tasks/projects', params, { archived: showArchived ? undefined : '1' })} className="font-medium text-brand-700 hover:underline">
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Link>
        </p>
        <ProjectDialog people={people} variant="primary" />
      </div>
      {cards.length === 0 ? (
        <Card>
          <EmptyState title="No projects yet">A project groups tasks around one goal, such as a campaign or a launch. Create the first one to start.</EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <ProjectCardView key={c.project.id} card={c} size="large" today={now} />
          ))}
          <Link
            href="/tasks/board?project=none"
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/50 p-5 text-center text-slate-500 transition-colors hover:border-brand-500 hover:bg-white hover:text-slate-800"
          >
            <FolderKanban className="size-5" aria-hidden />
            <span className="text-sm font-medium">Tasks without a project</span>
            <span className="text-xs">{loose} open</span>
          </Link>
        </div>
      )}
    </>
  );
}
