// Pieces both Dashboards share: the greeting, the four open-order tiles and the tasks panel.
import { CircleDashed, Inbox, PauseCircle, SquareCheckBig, Tag } from 'lucide-react';
import { Card, CardBody, CardHeader, DatePill, Eyebrow, ListRow, PanelLink, StatTile, type Tone } from '@/components/ui';
import { dayLabel } from '@/lib/tasks/dates';
import { dueState } from '@/lib/tasks/model';
import { intlTag } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';
import type { TaskCard } from '@/server/services/tasks';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

/** Today's date over a serif "Welcome back", with anything else (a period control) on the right. */
export async function Greeting({ name, actions }: { name: string; actions?: React.ReactNode }) {
  const t = await getT();
  const date = new Intl.DateTimeFormat(intlTag(t.locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' }).format(new Date());
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:mb-10">
      <div className="min-w-0">
        <Eyebrow className="mb-2">{date}</Eyebrow>
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight text-ink md:text-5xl">{t('Welcome back, {name}', { name })}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TILES: { status: string; label: string; caption: string; tone: Tone; icon: typeof Inbox }[] = [
  { status: 'new', label: msg('New'), caption: msg('Waiting to be picked up'), tone: 'sky', icon: Inbox },
  { status: 'processing', label: msg('Processing'), caption: msg('Being prepared'), tone: 'blush', icon: CircleDashed },
  { status: 'label_created', label: msg('Label created'), caption: msg('Ready to pack'), tone: 'butter', icon: Tag },
  { status: 'on_hold', label: msg('On hold'), caption: msg('Need a look'), tone: 'peach', icon: PauseCircle },
];

/** The four open-order counts as pastel tiles, each one a link to that tab of Orders. */
export async function OpenOrderTiles({ counts, labelReady }: { counts: Partial<Record<string, number>>; labelReady: number }) {
  const t = await getT();
  return (
    <section aria-label={t('Open orders')} className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {TILES.map((o) => (
        <StatTile
          key={o.status}
          href={`/orders?status=${o.status}`}
          tone={o.tone}
          icon={o.icon}
          label={t(o.label)}
          value={o.status === 'label_created' ? labelReady : (counts[o.status] ?? 0)}
          caption={t(o.caption)}
        />
      ))}
    </section>
  );
}

/** "My tasks" in a butter panel: one white row per task, with its due day on the right. */
export async function TasksPanel({ tasks, today, limit, show = 5, className }: { tasks: TaskCard[]; today: string; limit: number; show?: number; className?: string }) {
  const t = await getT();
  return (
    <Card tone="butter" className={className}>
      <CardHeader icon={SquareCheckBig} title={t('My tasks')} count={tasks.length >= limit ? `${limit}+` : tasks.length} actions={<PanelLink href="/tasks?who=me">{t('View all')}</PanelLink>} />
      <CardBody className="space-y-2 pt-3 pb-5">
        {tasks.length ? (
          tasks.slice(0, show).map((task) => {
            const state = dueState(task, today);
            return (
              <ListRow
                key={task.id}
                href={`/tasks/${task.id}`}
                icon={<CircleDashed className="size-4" aria-hidden />}
                title={task.title}
                subtitle={task.customer?.name ?? task.project?.name}
                trailing={
                  task.dueDate ? (
                    <DatePill className={cn(state === 'overdue' && 'border-red-200 bg-red-50 text-red-700', state === 'today' && 'border-ink/20 font-medium text-ink')}>{dayLabel(task.dueDate, today, t)}</DatePill>
                  ) : undefined
                }
              />
            );
          })
        ) : (
          <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-slate-500">{t('Nothing assigned to you.')}</p>
        )}
      </CardBody>
    </Card>
  );
}
