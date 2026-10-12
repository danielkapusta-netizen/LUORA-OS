import type { ExecutiveBrief } from './analytics/brief';
import type { Courier } from './couriers';

export interface LogisticsFigures {
  counts: Record<string, number | undefined>;
  couriers: { courier: Courier; count: number; labelled: number }[];
  /** My open tasks that are due today or already late. */
  tasksDue: number;
  tasksOpen: number;
}

function greeting(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Dashboard sentence for people who pack and send: what is waiting, with whom it goes, and the tasks. No money. */
export function buildLogisticsBrief(f: LogisticsFigures, name: string | undefined, hour: number): ExecutiveBrief {
  const fresh = f.counts.new ?? 0;
  const packing = f.counts.processing ?? 0;
  const labelled = f.counts.label_created ?? 0;
  const hold = f.counts.on_hold ?? 0;
  const toSend = fresh + packing + labelled;
  const body: string[] = [];

  if (toSend > 0) {
    body.push(`${plural(fresh, 'order')} ${fresh === 1 ? 'is' : 'are'} new, ${packing} in packing and ${labelled} already ${labelled === 1 ? 'has' : 'have'} a label.`);
    const top = f.couriers.slice(0, 3);
    if (top.length > 0) body.push(`Most parcels go with ${top.map((c) => `${c.courier} (${c.count})`).join(', ')}.`);
  }
  if (hold > 0) body.push(`${plural(hold, 'order')} ${hold === 1 ? 'is' : 'are'} on hold and not counted above.`);
  body.push(
    f.tasksDue > 0
      ? `You have ${plural(f.tasksDue, 'task')} due today or late, ${f.tasksOpen} open in all.`
      : f.tasksOpen > 0
        ? `No tasks are due today; ${f.tasksOpen} open in all.`
        : 'You have no open tasks.',
  );

  return {
    greeting: name ? `${greeting(hour)} ${name}` : greeting(hour),
    scope: 'Today',
    verdict: toSend === 0 ? 'Nothing is waiting to be sent.' : `${plural(toSend, 'order')} ${toSend === 1 ? 'needs' : 'need'} to be sent.`,
    body,
    attentionCount: 0,
  };
}

export function warsawHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).format(now));
}
