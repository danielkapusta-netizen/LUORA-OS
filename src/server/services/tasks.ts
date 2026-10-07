import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { addDays, dayOf, isDay, shortDay, timeRange, today as warsawToday, validateSlot } from '../../lib/tasks/dates';
import {
  checklistProgress,
  compareTasks,
  completedPerDay,
  doneShare,
  isTaskPriority,
  isTaskStatus,
  newChecklistItem,
  onTimeRate,
  parseTags,
  PRIORITY_LABEL,
  PROJECT_COLOR_KEYS,
  STATUS_LABEL,
  type ChecklistItem,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/tasks/model';
import type { Role } from '../../lib/permissions';
import { chunk, getDb, insertStatements, type Db } from '../db/client';
import { customers, orders, projects, taskAssignees, taskComments, tasks, users, type Project, type Task } from '../db/schema';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const COMMENT_MAX = 2000;
const PROJECT_NAME_MAX = 80;
const DEFAULT_LIMIT = 400;

export interface Actor {
  id: string;
  role: Role;
}

export interface Person {
  id: string;
  name: string;
}

/** A task with everything a card shows. */
export interface TaskCard extends Task {
  project: { id: string; name: string; color: string } | null;
  assignees: Person[];
  /** Checklist items done and in total. */
  progress: { done: number; total: number };
  commentCount: number;
  customer: { id: string; name: string } | null;
  order: { id: string; number: string } | null;
}

export interface TaskFilter {
  /** A user id, or "none" for tasks nobody is assigned to. */
  assignee?: string;
  /** A project id, or "none" for tasks outside any project. */
  projectId?: string;
  tag?: string;
  /** "open" is everything not done. */
  status?: 'open' | TaskStatus;
  /** Planned for exactly this day. */
  day?: string;
  /** Planned between these days, inclusive. */
  from?: string;
  to?: string;
  /** Tasks without a day. */
  undated?: boolean;
  priorities?: TaskPriority[];
  q?: string;
  customerId?: string;
  orderId?: string;
  /** Every open task, plus the done ones planned for this day. */
  openOrDay?: string;
  /** Done tasks only when finished within this many days (open tasks are not affected). */
  doneWithinDays?: number;
  limit?: number;
}

const batch = (db: Db, statements: unknown[]) => db.batch(statements as unknown as Parameters<Db['batch']>[0]);

const cleanText = (value: string | null | undefined, max: number): string | null => {
  const text = (value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

// ---------------------------------------------------------------- reading

function conditions(f: TaskFilter): SQL | undefined {
  const c: (SQL | undefined)[] = [];
  if (f.assignee === 'none') c.push(sql`not exists (select 1 from ${taskAssignees} a where a.task_id = ${tasks.id})`);
  else if (f.assignee) c.push(sql`exists (select 1 from ${taskAssignees} a where a.task_id = ${tasks.id} and a.user_id = ${f.assignee})`);
  if (f.projectId === 'none') c.push(isNull(tasks.projectId));
  else if (f.projectId) c.push(eq(tasks.projectId, f.projectId));
  if (f.tag) c.push(sql`exists (select 1 from json_each(${tasks.tags}) j where j.value = ${f.tag})`);
  if (f.status === 'open') c.push(ne(tasks.status, 'done'));
  else if (f.status) c.push(eq(tasks.status, f.status));
  if (f.day) c.push(eq(tasks.dueDate, f.day));
  if (f.from) c.push(gte(tasks.dueDate, f.from));
  if (f.to) c.push(lte(tasks.dueDate, f.to));
  if (f.undated) c.push(isNull(tasks.dueDate));
  if (f.priorities?.length) c.push(inArray(tasks.priority, f.priorities));
  if (f.q?.trim()) c.push(sql`instr(lower(${tasks.title} || ' ' || coalesce(${tasks.description}, '')), ${f.q.trim().toLowerCase()}) > 0`);
  if (f.customerId) c.push(eq(tasks.customerId, f.customerId));
  if (f.orderId) c.push(eq(tasks.orderId, f.orderId));
  if (f.openOrDay) c.push(sql`(${tasks.status} <> 'done' or ${tasks.dueDate} = ${f.openOrDay})`);
  if (f.doneWithinDays) c.push(sql`(${tasks.status} <> 'done' or ${tasks.doneAt} >= ${Date.now() - f.doneWithinDays * 86_400_000})`);
  return and(...c);
}

async function hydrate(rows: Task[]): Promise<TaskCard[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const assignees = new Map<string, Person[]>();
  const comments = new Map<string, number>();
  for (const part of chunk(ids)) {
    const [people, counts] = await Promise.all([
      db
        .select({ taskId: taskAssignees.taskId, id: users.id, name: users.name })
        .from(taskAssignees)
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(inArray(taskAssignees.taskId, part))
        .orderBy(asc(users.name)),
      db
        .select({ taskId: taskComments.taskId, n: sql<number>`count(*)` })
        .from(taskComments)
        .where(and(inArray(taskComments.taskId, part), eq(taskComments.kind, 'comment')))
        .groupBy(taskComments.taskId),
    ]);
    for (const p of people) assignees.set(p.taskId, [...(assignees.get(p.taskId) ?? []), { id: p.id, name: p.name }]);
    for (const c of counts) comments.set(c.taskId, c.n);
  }
  const lookup = async <T extends { id: string }>(wanted: (string | null)[], load: (part: string[]) => Promise<T[]>) => {
    const out = new Map<string, T>();
    for (const part of chunk([...new Set(wanted.filter((v): v is string => Boolean(v)))])) for (const row of await load(part)) out.set(row.id, row);
    return out;
  };
  const [projectRows, customerRows, orderRows] = await Promise.all([
    lookup(rows.map((r) => r.projectId), (part) => db.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(inArray(projects.id, part))),
    lookup(rows.map((r) => r.customerId), (part) => db.select({ id: customers.id, name: customers.displayName }).from(customers).where(inArray(customers.id, part))),
    lookup(rows.map((r) => r.orderId), (part) => db.select({ id: orders.id, number: orders.externalNumber }).from(orders).where(inArray(orders.id, part))),
  ]);
  return rows.map((task) => ({
    ...task,
    project: task.projectId ? (projectRows.get(task.projectId) ?? null) : null,
    assignees: assignees.get(task.id) ?? [],
    progress: checklistProgress(task.checklist),
    commentCount: comments.get(task.id) ?? 0,
    customer: task.customerId ? (customerRows.get(task.customerId) ?? null) : null,
    order: task.orderId ? (orderRows.get(task.orderId) ?? null) : null,
  }));
}

/** Tasks matching the filter, in task order (open first, by day and time, then priority). */
export async function listTasks(filter: TaskFilter = {}): Promise<TaskCard[]> {
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(conditions(filter))
    .orderBy(sql`${tasks.status} = 'done'`, sql`${tasks.dueDate} is null`, asc(tasks.dueDate), sql`${tasks.startTime} is null`, asc(tasks.startTime), desc(tasks.createdAt))
    .limit(filter.limit ?? DEFAULT_LIMIT);
  return (await hydrate(rows)).sort(compareTasks);
}

/** How many tasks match, without loading them. */
export async function countTasks(filter: TaskFilter = {}): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)` }).from(tasks).where(conditions(filter));
  return Number(row?.n ?? 0);
}

export interface TaskComment {
  id: string;
  kind: 'comment' | 'event';
  body: string;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
}

export async function getTask(id: string): Promise<{ card: TaskCard; comments: TaskComment[]; createdByName: string | null } | null> {
  const db = getDb();
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!row) return null;
  const [[card], comments, [creator]] = await Promise.all([
    hydrate([row]),
    db
      .select({ id: taskComments.id, kind: taskComments.kind, body: taskComments.body, createdAt: taskComments.createdAt, userId: taskComments.userId, userName: users.name })
      .from(taskComments)
      .leftJoin(users, eq(users.id, taskComments.userId))
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt), sql`${taskComments}.rowid`),
    row.createdBy ? db.select({ name: users.name }).from(users).where(eq(users.id, row.createdBy)) : Promise.resolve([] as { name: string }[]),
  ]);
  return { card, comments, createdByName: creator?.name ?? null };
}

export async function listPeople(): Promise<Person[]> {
  return getDb().select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
}

/** Tags of open tasks with how many tasks carry each, most used first. */
export async function tagCounts(opts: { includeDone?: boolean; limit?: number } = {}): Promise<{ tag: string; count: number }[]> {
  const rows = await getDb().all<{ tag: string; count: number }>(sql`
    select j.value as tag, count(*) as count
    from ${tasks} t, json_each(t.tags) j
    ${opts.includeDone ? sql`` : sql`where t.status <> 'done'`}
    group by j.value order by count desc, j.value limit ${opts.limit ?? 40}`);
  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.count) }));
}

/** Tasks planned on each day of a range (the calendar's dots and numbers). */
export async function calendarCounts(from: string, to: string, assignee?: string): Promise<Map<string, { open: number; total: number }>> {
  const rows = await getDb().all<{ day: string; open: number; total: number }>(sql`
    select t.due_date as day, sum(case when t.status <> 'done' then 1 else 0 end) as open, count(*) as total
    from ${tasks} t
    where t.due_date between ${from} and ${to}
      ${assignee === 'none' ? sql`and not exists (select 1 from ${taskAssignees} a where a.task_id = t.id)` : assignee ? sql`and exists (select 1 from ${taskAssignees} a where a.task_id = t.id and a.user_id = ${assignee})` : sql``}
    group by t.due_date`);
  return new Map(rows.map((r) => [r.day, { open: Number(r.open), total: Number(r.total) }]));
}

export interface Productivity {
  /** Share of today's planned tasks that are done (0 to 1), null when none are planned. */
  doneToday: number | null;
  plannedToday: number;
  /** Share of tasks finished in the last 30 days that were done by their day, null when none had a day. */
  onTime: number | null;
  perDay: { day: string; count: number }[];
  completedWeek: number;
}

export async function productivity(opts: { assignee?: string; now?: Date } = {}): Promise<Productivity> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const day = warsawToday(now);
  const mine = (alias: string) =>
    opts.assignee === 'none'
      ? sql`and not exists (select 1 from ${taskAssignees} a where a.task_id = ${sql.raw(alias)}.id)`
      : opts.assignee
        ? sql`and exists (select 1 from ${taskAssignees} a where a.task_id = ${sql.raw(alias)}.id and a.user_id = ${opts.assignee})`
        : sql``;
  const planned = await db.all<{ status: string }>(sql`select t.status from ${tasks} t where t.due_date = ${day} ${mine('t')}`);
  const first = addDays(day, -29);
  // Two hours before midnight covers the offset from UTC; the exact day is checked below.
  const since = new Date(`${first}T00:00:00Z`).getTime() - 2 * 3_600_000;
  const finished = await db.all<{ dueDate: string | null; doneAt: number }>(sql`
    select t.due_date as dueDate, t.done_at as doneAt from ${tasks} t
    where t.status = 'done' and t.done_at >= ${since} ${mine('t')}`);
  const rows = finished.map((r) => ({ dueDate: r.dueDate, doneDay: dayOf(new Date(Number(r.doneAt))) })).filter((r) => r.doneDay >= first);
  const perDay = completedPerDay(rows.map((r) => r.doneDay), day, 7);
  return {
    doneToday: doneShare(planned),
    plannedToday: planned.length,
    onTime: onTimeRate(rows),
    perDay,
    completedWeek: perDay.reduce((n, d) => n + d.count, 0),
  };
}

/** Open tasks of a person that are due today or already late: the sidebar badge. */
export async function myTaskBadge(userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await getDb().all<{ n: number }>(sql`
    select count(*) as n from ${tasks} t join ${taskAssignees} a on a.task_id = t.id
    where a.user_id = ${userId} and t.status <> 'done' and t.due_date is not null and t.due_date <= ${warsawToday(now)}`);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------- writing tasks

export interface TaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string | null;
  dueDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  tags?: string[] | string;
  assigneeIds?: string[];
  customerId?: string | null;
  orderId?: string | null;
  /** Checklist items, one text each. */
  checklist?: string[];
}

function checkWhen(dueDate: string | null, start: string | null, end: string | null): void {
  if (dueDate !== null && !isDay(dueDate)) throw new Error('The day is not a valid date');
  const slot = validateSlot(start, end);
  if (slot) throw new Error(slot);
  if ((start || end) && !dueDate) throw new Error('A time slot needs a day');
}

function checkTitle(raw: string): string {
  const title = (raw ?? '').trim();
  if (!title) throw new Error('Give the task a title');
  if (title.length > TITLE_MAX) throw new Error(`The title can have at most ${TITLE_MAX} characters`);
  return title;
}

async function assertProject(projectId: string): Promise<Project> {
  const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error('That project no longer exists');
  if (project.archivedAt) throw new Error(`The project “${project.name}” is archived`);
  return project;
}

async function peopleByIds(ids: string[]): Promise<Person[]> {
  if (ids.length === 0) return [];
  const found: Person[] = [];
  for (const part of chunk(ids)) found.push(...(await getDb().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, part))));
  if (found.length !== new Set(ids).size) throw new Error('One of the people is no longer a user');
  return found.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

async function assertLinks(customerId: string | null | undefined, orderId: string | null | undefined): Promise<void> {
  const db = getDb();
  if (customerId && !(await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))).length) throw new Error('That customer no longer exists');
  if (orderId && !(await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId))).length) throw new Error('That order no longer exists');
}

const event = (db: Db, taskId: string, userId: string | null, body: string) => db.insert(taskComments).values({ taskId, userId, kind: 'event', body });

export async function createTask(input: TaskInput, actor: Pick<Actor, 'id'>): Promise<string> {
  const db = getDb();
  const title = checkTitle(input.title);
  const description = cleanText(input.description, DESCRIPTION_MAX);
  const dueDate = input.dueDate || null;
  const startTime = input.startTime || null;
  const endTime = input.endTime || null;
  checkWhen(dueDate, startTime, endTime);
  const status = input.status ?? 'todo';
  const priority = input.priority ?? 'normal';
  if (!isTaskStatus(status)) throw new Error('Unknown status');
  if (!isTaskPriority(priority)) throw new Error('Unknown priority');
  if (input.projectId) await assertProject(input.projectId);
  await assertLinks(input.customerId, input.orderId);
  const people = await peopleByIds([...new Set(input.assigneeIds ?? [])]);
  const id = crypto.randomUUID();
  await batch(db, [
    db.insert(tasks).values({
      id,
      title,
      description,
      status,
      priority,
      projectId: input.projectId || null,
      dueDate,
      startTime,
      endTime,
      tags: parseTags(input.tags),
      checklist: (input.checklist ?? []).map(newChecklistItem).filter((i) => i.text),
      customerId: input.customerId || null,
      orderId: input.orderId || null,
      createdBy: actor.id,
      doneAt: status === 'done' ? new Date() : null,
    }),
    ...insertStatements(db, taskAssignees, people.map((p) => ({ taskId: id, userId: p.id }))),
    event(db, id, actor.id, people.length ? `created this task for ${people.map((p) => p.name).join(', ')}` : 'created this task'),
  ]);
  return id;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  projectId?: string | null;
  dueDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  tags?: string[] | string;
}

async function loadTask(id: string): Promise<Task> {
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, id));
  if (!task) throw new Error('This task no longer exists');
  return task;
}

export async function updateTask(id: string, patch: TaskPatch, actor: Pick<Actor, 'id'>): Promise<void> {
  const db = getDb();
  const current = await loadTask(id);
  const next = {
    title: patch.title === undefined ? current.title : checkTitle(patch.title),
    description: patch.description === undefined ? current.description : cleanText(patch.description, DESCRIPTION_MAX),
    priority: patch.priority ?? current.priority,
    projectId: patch.projectId === undefined ? current.projectId : patch.projectId || null,
    dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate || null,
    startTime: patch.startTime === undefined ? current.startTime : patch.startTime || null,
    endTime: patch.endTime === undefined ? current.endTime : patch.endTime || null,
    tags: patch.tags === undefined ? current.tags : parseTags(patch.tags),
  };
  if (!isTaskPriority(next.priority)) throw new Error('Unknown priority');
  checkWhen(next.dueDate, next.startTime, next.endTime);
  let projectName: string | null = null;
  if (next.projectId && next.projectId !== current.projectId) projectName = (await assertProject(next.projectId)).name;

  const events: string[] = [];
  if (next.title !== current.title) events.push('renamed this task');
  if (next.priority !== current.priority) events.push(`set the priority to ${PRIORITY_LABEL[next.priority]}`);
  if (next.dueDate !== current.dueDate) events.push(next.dueDate ? `set the day to ${shortDay(next.dueDate)}` : 'removed the day');
  if (next.startTime !== current.startTime || next.endTime !== current.endTime) {
    const slot = timeRange(next.startTime, next.endTime);
    events.push(slot ? `set the time to ${slot}` : 'removed the time');
  }
  if (next.projectId !== current.projectId) events.push(next.projectId ? `moved this to the project “${projectName}”` : 'took this out of its project');

  await batch(db, [db.update(tasks).set(next).where(eq(tasks.id, id)), ...events.map((body) => event(db, id, actor.id, body))]);
}

export async function setTaskStatus(id: string, status: TaskStatus, actor: Pick<Actor, 'id'>): Promise<void> {
  if (!isTaskStatus(status)) throw new Error('Unknown status');
  const db = getDb();
  const current = await loadTask(id);
  if (current.status === status) return;
  const body = status === 'done' ? 'marked this as done' : current.status === 'done' ? 'reopened this task' : `moved this to ${STATUS_LABEL[status]}`;
  await batch(db, [db.update(tasks).set({ status, doneAt: status === 'done' ? new Date() : null }).where(eq(tasks.id, id)), event(db, id, actor.id, body)]);
}

/** Ticks a task off (done) or reopens it (to do). */
export async function setTaskDone(id: string, done: boolean, actor: Pick<Actor, 'id'>): Promise<void> {
  await setTaskStatus(id, done ? 'done' : 'todo', actor);
}

export async function setAssignees(id: string, userIds: string[], actor: Pick<Actor, 'id'>): Promise<void> {
  const db = getDb();
  await loadTask(id);
  const wanted = await peopleByIds([...new Set(userIds)]);
  const currentRows = await db
    .select({ id: users.id, name: users.name })
    .from(taskAssignees)
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(eq(taskAssignees.taskId, id));
  const have = new Set(currentRows.map((p) => p.id));
  const want = new Set(wanted.map((p) => p.id));
  const added = wanted.filter((p) => !have.has(p.id));
  const removed = currentRows.filter((p) => !want.has(p.id));
  if (added.length === 0 && removed.length === 0) return;
  const parts = [added.length ? `assigned ${added.map((p) => p.name).join(', ')}` : '', removed.length ? `${added.length ? 'removed' : 'unassigned'} ${removed.map((p) => p.name).join(', ')}` : ''].filter(Boolean);
  await batch(db, [
    ...(removed.length ? [db.delete(taskAssignees).where(and(eq(taskAssignees.taskId, id), inArray(taskAssignees.userId, removed.map((p) => p.id))))] : []),
    ...insertStatements(db, taskAssignees, added.map((p) => ({ taskId: id, userId: p.id }))),
    event(db, id, actor.id, parts.join(' and ')),
  ]);
}

/** Adds the person to the task, or takes them off when they are already on it. */
export async function toggleAssignee(id: string, userId: string, actor: Pick<Actor, 'id'>): Promise<void> {
  await loadTask(id);
  const rows = await getDb().select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, id));
  const ids = rows.map((r) => r.userId);
  await setAssignees(id, ids.includes(userId) ? ids.filter((u) => u !== userId) : [...ids, userId], actor);
}

/** Only whoever created a task, or an admin, can delete it (tasks without a creator can be deleted by anyone). */
export async function deleteTask(id: string, actor: Actor): Promise<void> {
  const task = await loadTask(id);
  if (task.createdBy && task.createdBy !== actor.id && actor.role !== 'admin') throw new Error('Only the person who created this task, or an admin, can delete it');
  await getDb().delete(tasks).where(eq(tasks.id, id));
}

export async function addComment(taskId: string, body: string, actor: Pick<Actor, 'id'>): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('Write a comment first');
  if (text.length > COMMENT_MAX) throw new Error(`A comment can have at most ${COMMENT_MAX} characters`);
  await loadTask(taskId);
  await getDb().insert(taskComments).values({ taskId, userId: actor.id, kind: 'comment', body: text });
}

async function saveChecklist(taskId: string, change: (items: ChecklistItem[]) => ChecklistItem[]): Promise<void> {
  const task = await loadTask(taskId);
  await getDb().update(tasks).set({ checklist: change(task.checklist) }).where(eq(tasks.id, taskId));
}

export async function addChecklistItem(taskId: string, text: string): Promise<void> {
  const item = newChecklistItem(text);
  if (!item.text) throw new Error('Write the checklist item first');
  await saveChecklist(taskId, (items) => (items.length >= 50 ? items : [...items, item]));
}

export async function toggleChecklistItem(taskId: string, itemId: string): Promise<void> {
  await saveChecklist(taskId, (items) => items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)));
}

export async function removeChecklistItem(taskId: string, itemId: string): Promise<void> {
  await saveChecklist(taskId, (items) => items.filter((i) => i.id !== itemId));
}

// ---------------------------------------------------------------- projects

export interface ProjectCard {
  project: Project;
  open: number;
  done: number;
  overdue: number;
  nextDue: string | null;
  members: Person[];
}

/** Projects with their task counts and the people working on them. Archived ones only on request. */
export async function listProjects(opts: { includeArchived?: boolean; now?: Date; assignee?: string } = {}): Promise<ProjectCard[]> {
  const db = getDb();
  const day = warsawToday(opts.now ?? new Date());
  const rows = await db
    .select()
    .from(projects)
    .where(opts.includeArchived ? undefined : isNull(projects.archivedAt))
    .orderBy(sql`${projects.archivedAt} is not null`, asc(projects.name));
  if (rows.length === 0) return [];
  const mine = opts.assignee ? sql`and exists (select 1 from ${taskAssignees} a where a.task_id = t.id and a.user_id = ${opts.assignee})` : sql``;
  const [counts, members] = await Promise.all([
    db.all<{ projectId: string; open: number; done: number; overdue: number; nextDue: string | null }>(sql`
      select t.project_id as projectId,
        sum(case when t.status <> 'done' then 1 else 0 end) as open,
        sum(case when t.status = 'done' then 1 else 0 end) as done,
        sum(case when t.status <> 'done' and t.due_date < ${day} then 1 else 0 end) as overdue,
        min(case when t.status <> 'done' and t.due_date >= ${day} then t.due_date end) as nextDue
      from ${tasks} t where t.project_id is not null ${mine} group by t.project_id`),
    db.all<{ projectId: string; id: string; name: string }>(sql`
      select distinct t.project_id as projectId, u.id as id, u.name as name
      from ${tasks} t join ${taskAssignees} a on a.task_id = t.id join ${users} u on u.id = a.user_id
      where t.project_id is not null order by u.name`),
  ]);
  const byCount = new Map(counts.map((c) => [c.projectId, c]));
  const byMembers = new Map<string, Person[]>();
  for (const m of members) byMembers.set(m.projectId, [...(byMembers.get(m.projectId) ?? []), { id: m.id, name: m.name }]);
  return rows.map((project) => {
    const c = byCount.get(project.id);
    return {
      project,
      open: Number(c?.open ?? 0),
      done: Number(c?.done ?? 0),
      overdue: Number(c?.overdue ?? 0),
      nextDue: c?.nextDue ?? null,
      members: byMembers.get(project.id) ?? [],
    };
  });
}

export async function getProject(id: string): Promise<ProjectCard | null> {
  return (await listProjects({ includeArchived: true })).find((p) => p.project.id === id) ?? null;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  color?: string;
  ownerId?: string | null;
  /** Only the demo seed sets this: the project is removed with the other demo data. */
  demo?: boolean;
}

async function checkProjectName(raw: string, exceptId?: string): Promise<string> {
  const name = (raw ?? '').trim();
  if (!name) throw new Error('Give the project a name');
  if (name.length > PROJECT_NAME_MAX) throw new Error(`The name can have at most ${PROJECT_NAME_MAX} characters`);
  const same = await getDb().select({ id: projects.id }).from(projects).where(sql`lower(${projects.name}) = ${name.toLowerCase()}`);
  if (same.some((p) => p.id !== exceptId)) throw new Error(`There is already a project called “${name}”`);
  return name;
}

export async function createProject(input: ProjectInput, actor: Pick<Actor, 'id'>): Promise<string> {
  const db = getDb();
  const name = await checkProjectName(input.name);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(projects);
  const color = input.color && (PROJECT_COLOR_KEYS as string[]).includes(input.color) ? input.color : PROJECT_COLOR_KEYS[Number(n) % PROJECT_COLOR_KEYS.length];
  if (input.ownerId) await peopleByIds([input.ownerId]);
  const [row] = await db
    .insert(projects)
    .values({ name, description: cleanText(input.description, DESCRIPTION_MAX), color, ownerId: input.ownerId || null, demo: Boolean(input.demo), createdBy: actor.id })
    .returning({ id: projects.id });
  return row.id;
}

export async function updateProject(id: string, input: Partial<ProjectInput>): Promise<void> {
  const db = getDb();
  const [current] = await db.select().from(projects).where(eq(projects.id, id));
  if (!current) throw new Error('That project no longer exists');
  const color = input.color === undefined ? current.color : (PROJECT_COLOR_KEYS as string[]).includes(input.color) ? input.color : current.color;
  if (input.ownerId) await peopleByIds([input.ownerId]);
  await db
    .update(projects)
    .set({
      name: input.name === undefined ? current.name : await checkProjectName(input.name, id),
      description: input.description === undefined ? current.description : cleanText(input.description, DESCRIPTION_MAX),
      color,
      ownerId: input.ownerId === undefined ? current.ownerId : input.ownerId || null,
    })
    .where(eq(projects.id, id));
}

export async function archiveProject(id: string, archived: boolean): Promise<void> {
  await getDb().update(projects).set({ archivedAt: archived ? new Date() : null }).where(eq(projects.id, id));
}

/** A project can only be deleted while it has no tasks; otherwise it is archived. */
export async function deleteProject(id: string): Promise<void> {
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(tasks).where(eq(tasks.projectId, id));
  if (Number(n) > 0) throw new Error(`This project still has ${n} task${Number(n) === 1 ? '' : 's'}. Archive it instead, or move the tasks first.`);
  await db.delete(projects).where(eq(projects.id, id));
}

// ---------------------------------------------------------------- demo data

export const DEMO_USER_DOMAIN = 'demo.example';

/** Removes the projects (and their tasks) and the people that the demo seed created. */
export async function removeDemoTasks(): Promise<void> {
  const db = getDb();
  await db.run(sql`delete from ${tasks} where project_id in (select id from ${projects} where demo = 1)`);
  await db.run(sql`delete from ${projects} where demo = 1`);
  await db.run(sql`delete from ${users} where email like ${`%@${DEMO_USER_DOMAIN}`}`);
}
