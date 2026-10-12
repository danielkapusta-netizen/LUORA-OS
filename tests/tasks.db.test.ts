// The Tasks module against a local D1 database: projects, tasks, people, the activity trail, filters and the
// migration that carried over the old customer tasks.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/permissions';

describe('tasks (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-tasks-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    tasks: typeof import('@/server/services/tasks');
    dates: typeof import('@/lib/tasks/dates');
  };
  let admin: { id: string; role: Role };
  let ola: { id: string; role: Role };
  let marek: { id: string; role: Role };

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    const queueModule = await import('@/server/jobs/queue');
    queueModule.setEnqueueImplementation(async () => undefined);
    const { seed } = await import('@/server/db/seed');
    await seed();
    m = {
      db: await import('@/server/db/client'),
      schema: await import('@/server/db/schema'),
      orm: await import('drizzle-orm'),
      tasks: await import('@/server/services/tasks'),
      dates: await import('@/lib/tasks/dates'),
    };
    const users = await m.db.getDb().select().from(m.schema.users);
    const by = (match: string) => {
      const u = users.find((x) => x.email.startsWith(match))!;
      return { id: u.id, role: u.role };
    };
    admin = by('admin@');
    ola = by('ola@');
    marek = by('marek@');
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  const day = (offset: number) => m.dates.addDays(m.dates.today(), offset);

  it('starts with the demo projects and tasks around today', async () => {
    const all = await m.tasks.listTasks();
    expect(all.length).toBeGreaterThanOrEqual(20);
    const projects = await m.tasks.listProjects();
    expect(projects.map((p) => p.project.name).sort()).toEqual(['Autumn campaign', 'Marketplace listings', 'Suppliers', 'Warehouse and shipping']);
    expect(projects.every((p) => p.project.demo)).toBe(true);
    const campaign = projects.find((p) => p.project.name === 'Autumn campaign')!;
    expect(campaign.open).toBeGreaterThan(0);
    expect(campaign.done).toBeGreaterThan(0);
    expect(campaign.members.map((p) => p.name)).toContain('Ola Nowak');
    // Tasks of the day come first within their list, finished ones last.
    const today = await m.tasks.listTasks({ day: day(0) });
    expect(today.map((t) => t.status === 'done')).toEqual([...today.map((t) => t.status === 'done')].sort());
    expect(today.length).toBe(4);
    // One of the four planned for today is done.
    const figures = await m.tasks.productivity();
    expect(figures.plannedToday).toBe(4);
    expect(figures.doneToday).toBe(0.25);
    expect(figures.perDay).toHaveLength(7);
    expect(figures.completedWeek).toBeGreaterThanOrEqual(9);
    expect(figures.onTime).not.toBeNull();
    const tags = await m.tasks.tagCounts();
    expect(tags.map((t) => t.tag)).toContain('shipping');
    const counts = await m.tasks.calendarCounts(day(0), day(0));
    expect(counts.get(day(0))).toEqual({ open: 3, total: 4 });
  });

  it('creates a task with people, a time slot and tidy tags, and writes the activity trail', async () => {
    const id = await m.tasks.createTask(
      {
        title: '  Photograph the gift sets  ',
        description: 'White background, four angles.',
        priority: 'high',
        dueDate: day(3),
        startTime: '10:00',
        endTime: '12:00',
        tags: 'Photos, #Gift Sets, photos',
        assigneeIds: [marek.id, ola.id, ola.id],
        checklist: ['Charge the camera', '  ', 'Clean the table'],
      },
      admin,
    );
    const data = (await m.tasks.getTask(id))!;
    expect(data.card).toMatchObject({ title: 'Photograph the gift sets', status: 'todo', priority: 'high', dueDate: day(3), startTime: '10:00', endTime: '12:00', tags: ['photos', 'gift-sets'] });
    expect(data.card.assignees.map((p) => p.name)).toEqual(['Marek Zieliński', 'Ola Nowak']);
    expect(data.card.progress).toEqual({ done: 0, total: 2 });
    expect(data.card.createdBy).toBe(admin.id);
    expect(data.createdByName).toBe('Admin');
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0]).toMatchObject({ kind: 'event', body: 'created this task for Marek Zieliński, Ola Nowak', userName: 'Admin' });
  });

  it('refuses a task that makes no sense, saying what is wrong', async () => {
    const create = (input: Partial<Parameters<typeof m.tasks.createTask>[0]>) => m.tasks.createTask({ title: 'x', ...input }, admin);
    await expect(create({ title: '   ' })).rejects.toThrow('Give the task a title');
    await expect(create({ title: 'y'.repeat(201) })).rejects.toThrow(/at most 200/);
    await expect(create({ dueDate: '2026-02-30' })).rejects.toThrow('not a valid date');
    await expect(create({ dueDate: day(1), startTime: '10:00', endTime: '09:00' })).rejects.toThrow('after the start');
    await expect(create({ startTime: '10:00' })).rejects.toThrow('needs a day');
    await expect(create({ projectId: 'nope' })).rejects.toThrow('no longer exists');
    await expect(create({ assigneeIds: ['nope'] })).rejects.toThrow('no longer a user');
    await expect(create({ customerId: 'nope' })).rejects.toThrow('customer no longer exists');
    await expect(create({ orderId: 'nope' })).rejects.toThrow('order no longer exists');
    await expect(create({ priority: 'huge' as never })).rejects.toThrow('Unknown priority');
  });

  it('filters by person, project, tag, day, range, search, status and priority', async () => {
    const [campaign] = (await m.tasks.listProjects()).filter((p) => p.project.name === 'Autumn campaign');
    const mine = await m.tasks.listTasks({ assignee: ola.id });
    expect(mine.length).toBeGreaterThan(3);
    expect(mine.every((t) => t.assignees.some((a) => a.id === ola.id))).toBe(true);
    const nobody = await m.tasks.createTask({ title: 'Nobody has this yet' }, admin);
    expect((await m.tasks.listTasks({ assignee: 'none' })).map((t) => t.id)).toContain(nobody);
    expect((await m.tasks.listTasks({ assignee: 'none' })).every((t) => t.assignees.length === 0)).toBe(true);

    const inProject = await m.tasks.listTasks({ projectId: campaign.project.id });
    expect(inProject.every((t) => t.project?.id === campaign.project.id)).toBe(true);
    expect((await m.tasks.listTasks({ projectId: 'none' })).every((t) => t.project === null)).toBe(true);

    const tagged = await m.tasks.listTasks({ tag: 'shipping' });
    expect(tagged.length).toBeGreaterThanOrEqual(3);
    expect(tagged.every((t) => t.tags.includes('shipping'))).toBe(true);

    expect((await m.tasks.listTasks({ day: day(0) })).every((t) => t.dueDate === day(0))).toBe(true);
    const range = await m.tasks.listTasks({ from: day(1), to: day(3) });
    expect(range.every((t) => t.dueDate! >= day(1) && t.dueDate! <= day(3))).toBe(true);
    expect((await m.tasks.listTasks({ undated: true })).every((t) => t.dueDate === null)).toBe(true);

    expect((await m.tasks.listTasks({ q: 'BLACK friday' })).map((t) => t.title)).toEqual(['Plan the Black Friday offers']);
    expect((await m.tasks.listTasks({ q: 'two layouts' })).length).toBe(1); // in the description
    expect((await m.tasks.listTasks({ status: 'open' })).every((t) => t.status !== 'done')).toBe(true);
    expect((await m.tasks.listTasks({ status: 'done' })).every((t) => t.status === 'done')).toBe(true);
    expect((await m.tasks.listTasks({ priorities: ['urgent'] })).every((t) => t.priority === 'urgent')).toBe(true);
    expect((await m.tasks.listTasks({ limit: 3 })).length).toBe(3);
    // Every open task, plus only the day's finished ones.
    const view = await m.tasks.listTasks({ openOrDay: day(0) });
    expect(view.filter((t) => t.status === 'done').every((t) => t.dueDate === day(0))).toBe(true);
    expect(await m.tasks.countTasks({ status: 'done' })).toBe((await m.tasks.listTasks({ status: 'done' })).length);
    // Finished long ago drops out of a "recent" view; open tasks stay.
    const [old] = await m.tasks.listTasks({ status: 'done', limit: 1 });
    await m.db.getDb().update(m.schema.tasks).set({ doneAt: new Date(Date.now() - 40 * 86_400_000) }).where(m.orm.eq(m.schema.tasks.id, old.id));
    expect((await m.tasks.listTasks({ doneWithinDays: 7 })).map((t) => t.id)).not.toContain(old.id);
    expect((await m.tasks.listTasks({ doneWithinDays: 60 })).map((t) => t.id)).toContain(old.id);
  });

  it('moves a task through its statuses, ticking it off and reopening it', async () => {
    const id = await m.tasks.createTask({ title: 'Reply to the courier', assigneeIds: [ola.id] }, admin);
    await m.tasks.setTaskStatus(id, 'in_progress', ola);
    expect((await m.tasks.getTask(id))!.card).toMatchObject({ status: 'in_progress', doneAt: null });
    await m.tasks.setTaskDone(id, true, ola);
    const done = (await m.tasks.getTask(id))!.card;
    expect(done.status).toBe('done');
    expect(done.doneAt).toBeInstanceOf(Date);
    await m.tasks.setTaskDone(id, true, ola); // nothing changes, nothing is logged twice
    await m.tasks.setTaskDone(id, false, ola);
    const reopened = (await m.tasks.getTask(id))!;
    expect(reopened.card).toMatchObject({ status: 'todo', doneAt: null });
    expect(reopened.comments.map((c) => c.body)).toEqual(['created this task for Ola Nowak', 'moved this to In progress', 'marked this as done', 'reopened this task']);
    await expect(m.tasks.setTaskStatus(id, 'archived' as never, ola)).rejects.toThrow('Unknown status');
    await expect(m.tasks.setTaskStatus('nope', 'done', ola)).rejects.toThrow('no longer exists');
  });

  it('shares a task out, changes who has it and records it', async () => {
    const id = await m.tasks.createTask({ title: 'Check the parcel sizes', assigneeIds: [ola.id] }, admin);
    await m.tasks.setAssignees(id, [ola.id, marek.id], admin);
    expect((await m.tasks.getTask(id))!.card.assignees.map((p) => p.name)).toEqual(['Marek Zieliński', 'Ola Nowak']);
    await m.tasks.setAssignees(id, [marek.id], admin);
    await m.tasks.setAssignees(id, [marek.id], admin); // no change, no event
    await m.tasks.toggleAssignee(id, admin.id, admin);
    await m.tasks.toggleAssignee(id, marek.id, admin);
    const data = (await m.tasks.getTask(id))!;
    expect(data.card.assignees.map((p) => p.name)).toEqual(['Admin']);
    expect(data.comments.map((c) => c.body)).toEqual([
      'created this task for Ola Nowak',
      'assigned Marek Zieliński',
      'unassigned Ola Nowak',
      'assigned Admin',
      'unassigned Marek Zieliński',
    ]);
    await expect(m.tasks.setAssignees(id, ['nope'], admin)).rejects.toThrow('no longer a user');
  });

  it('changes the details and says what changed', async () => {
    const [suppliers] = (await m.tasks.listProjects()).filter((p) => p.project.name === 'Suppliers');
    const id = await m.tasks.createTask({ title: 'Call the printer', dueDate: day(2), startTime: '09:00' }, admin);
    await m.tasks.updateTask(id, { title: 'Call the printing house', priority: 'urgent', dueDate: day(4), startTime: '14:00', endTime: '14:30', projectId: suppliers.project.id, tags: 'calls', description: ' Ask about foil. ' }, ola);
    const data = (await m.tasks.getTask(id))!;
    expect(data.card).toMatchObject({ title: 'Call the printing house', priority: 'urgent', dueDate: day(4), startTime: '14:00', endTime: '14:30', tags: ['calls'], description: 'Ask about foil.' });
    expect(data.card.project?.name).toBe('Suppliers');
    expect(data.comments.slice(1).map((c) => c.body)).toEqual([
      'renamed this task',
      'set the priority to Urgent',
      `set the day to ${m.dates.shortDay(day(4))}`,
      'set the time to 14:00 – 14:30',
      'moved this to the project “Suppliers”',
    ]);
    // Taking the day away takes the slot with it only when the form says so; otherwise it is refused.
    await expect(m.tasks.updateTask(id, { dueDate: null }, ola)).rejects.toThrow('needs a day');
    await m.tasks.updateTask(id, { dueDate: null, startTime: null, endTime: null, projectId: null }, ola);
    expect((await m.tasks.getTask(id))!.card).toMatchObject({ dueDate: null, startTime: null, endTime: null, projectId: null });
    await expect(m.tasks.updateTask(id, { title: '' }, ola)).rejects.toThrow('Give the task a title');
  });

  it('keeps a checklist and comments', async () => {
    const id = await m.tasks.createTask({ title: 'Prepare the Black Friday banner' }, admin);
    await m.tasks.addChecklistItem(id, 'Pick the colours');
    await m.tasks.addChecklistItem(id, 'Export in three sizes');
    let task = (await m.tasks.getTask(id))!.card;
    expect(task.progress).toEqual({ done: 0, total: 2 });
    await m.tasks.toggleChecklistItem(id, task.checklist[0].id);
    task = (await m.tasks.getTask(id))!.card;
    expect(task.progress).toEqual({ done: 1, total: 2 });
    await m.tasks.toggleChecklistItem(id, task.checklist[0].id);
    await m.tasks.removeChecklistItem(id, task.checklist[1].id);
    expect((await m.tasks.getTask(id))!.card.checklist.map((i) => [i.text, i.done])).toEqual([['Pick the colours', false]]);
    await expect(m.tasks.addChecklistItem(id, '  ')).rejects.toThrow('Write the checklist item');

    await m.tasks.addComment(id, '  Use the lime from the logo.  ', ola);
    const data = (await m.tasks.getTask(id))!;
    expect(data.card.commentCount).toBe(1);
    expect(data.comments.at(-1)).toMatchObject({ kind: 'comment', body: 'Use the lime from the logo.', userName: 'Ola Nowak' });
    await expect(m.tasks.addComment(id, '   ', ola)).rejects.toThrow('Write a comment');
    await expect(m.tasks.addComment(id, 'x'.repeat(2001), ola)).rejects.toThrow(/at most 2000/);
  });

  it('lets only the creator or an admin delete a task, and takes its people and comments with it', async () => {
    const id = await m.tasks.createTask({ title: 'Temporary task', assigneeIds: [ola.id] }, ola);
    await m.tasks.addComment(id, 'Hello', ola);
    await expect(m.tasks.deleteTask(id, marek)).rejects.toThrow('Only the person who created this task');
    await m.tasks.deleteTask(id, admin);
    const db = m.db.getDb();
    expect(await db.select().from(m.schema.taskAssignees).where(m.orm.eq(m.schema.taskAssignees.taskId, id))).toHaveLength(0);
    expect(await db.select().from(m.schema.taskComments).where(m.orm.eq(m.schema.taskComments.taskId, id))).toHaveLength(0);
    await expect(m.tasks.deleteTask(id, admin)).rejects.toThrow('no longer exists');

    const own = await m.tasks.createTask({ title: 'Mine' }, marek);
    await m.tasks.deleteTask(own, marek);
    expect(await m.tasks.getTask(own)).toBeNull();
    // A task nobody created (carried over from the old customer tasks) can be deleted by anyone.
    const orphan = await m.tasks.createTask({ title: 'Orphan' }, marek);
    await db.update(m.schema.tasks).set({ createdBy: null }).where(m.orm.eq(m.schema.tasks.id, orphan));
    await m.tasks.deleteTask(orphan, ola);
  });

  it('keeps projects unique, archives them and deletes only empty ones', async () => {
    const id = await m.tasks.createProject({ name: 'Spring launch', description: 'Next season', ownerId: ola.id }, admin);
    await expect(m.tasks.createProject({ name: 'spring LAUNCH' }, admin)).rejects.toThrow('already a project called');
    await expect(m.tasks.createProject({ name: ' ' }, admin)).rejects.toThrow('Give the project a name');
    const other = await m.tasks.createProject({ name: 'Packaging', color: 'not-a-colour' }, admin);
    const packaging = (await m.tasks.getProject(other))!;
    expect(['lime', 'orange', 'sky', 'violet', 'rose', 'emerald', 'amber', 'slate']).toContain(packaging.project.color);

    await m.tasks.updateProject(id, { name: 'Spring launch 2027', color: 'rose' });
    expect((await m.tasks.getProject(id))!.project).toMatchObject({ name: 'Spring launch 2027', color: 'rose', description: 'Next season', ownerId: ola.id });
    await expect(m.tasks.updateProject(id, { name: 'Packaging' })).rejects.toThrow('already a project called');

    const task = await m.tasks.createTask({ title: 'Choose the theme', projectId: id, dueDate: day(-1), assigneeIds: [marek.id] }, admin);
    await m.tasks.createTask({ title: 'Book the studio', projectId: id, dueDate: day(6) }, admin);
    const card = (await m.tasks.getProject(id))!;
    expect(card).toMatchObject({ open: 2, done: 0, overdue: 1, nextDue: day(6) });
    expect(card.members.map((p) => p.name)).toEqual(['Marek Zieliński']);
    await expect(m.tasks.deleteProject(id)).rejects.toThrow('still has 2 tasks');

    await m.tasks.archiveProject(id, true);
    expect((await m.tasks.listProjects()).map((p) => p.project.id)).not.toContain(id);
    expect((await m.tasks.listProjects({ includeArchived: true })).map((p) => p.project.id)).toContain(id);
    await expect(m.tasks.createTask({ title: 'Late idea', projectId: id }, admin)).rejects.toThrow('is archived');
    await m.tasks.archiveProject(id, false);
    await m.tasks.setTaskStatus(task, 'done', admin);
    expect(await m.tasks.getProject(id)).toMatchObject({ open: 1, done: 1, overdue: 0 });

    await m.tasks.deleteProject(other); // empty
    expect(await m.tasks.getProject(other)).toBeNull();
  });

  it('links tasks to customers and orders and lets go of them when those are deleted', async () => {
    const db = m.db.getDb();
    const [customer] = await db.insert(m.schema.customers).values({ displayName: 'Anna Kowalska' }).returning();
    const id = await m.tasks.createTask({ title: 'Send a sample', customerId: customer.id, assigneeIds: [admin.id] }, admin);
    expect((await m.tasks.getTask(id))!.card.customer).toEqual({ id: customer.id, name: 'Anna Kowalska' });
    expect((await m.tasks.listTasks({ customerId: customer.id })).map((t) => t.id)).toEqual([id]);
    await db.delete(m.schema.customers).where(m.orm.eq(m.schema.customers.id, customer.id));
    const after = (await m.tasks.getTask(id))!.card;
    expect(after.customerId).toBeNull();
    expect(after.customer).toBeNull();
  });

  it('counts a person’s tasks that are due today or late for the sidebar', async () => {
    const before = await m.tasks.myTaskBadge(marek.id);
    const late = await m.tasks.createTask({ title: 'Late one', dueDate: day(-3), assigneeIds: [marek.id] }, admin);
    await m.tasks.createTask({ title: 'Later one', dueDate: day(5), assigneeIds: [marek.id] }, admin);
    await m.tasks.createTask({ title: 'No day', assigneeIds: [marek.id] }, admin);
    expect(await m.tasks.myTaskBadge(marek.id)).toBe(before + 1);
    await m.tasks.setTaskDone(late, true, marek);
    expect(await m.tasks.myTaskBadge(marek.id)).toBe(before);
  });

  it('carries the old customer tasks over when the migration runs', async () => {
    const db = m.db.getDb();
    const [customer] = await db.insert(m.schema.customers).values({ displayName: 'Old Customer' }).returning();
    await db.run(m.orm.sql`insert into customer_tasks (id, customer_id, title, due_at, assignee_id, done_at, created_by, created_at)
      values ('old-open', ${customer.id}, 'Call back', 1783674000000, ${ola.id}, null, ${admin.id}, 1783000000000),
             ('old-done', ${customer.id}, 'Send invoice', null, null, 1783100000000, null, 1783000000000)`);
    // The data-copy statements at the end of the migration, run on those rows.
    const file = readFileSync(path.join(process.cwd(), 'drizzle', '0011_tasks.sql'), 'utf8');
    const copy = file.split('--> statement-breakpoint').filter((s) => /customer_tasks/.test(s));
    expect(copy).toHaveLength(2);
    for (const statement of copy) await db.run(m.orm.sql.raw(statement));

    const open = (await m.tasks.getTask('old-open'))!.card;
    expect(open).toMatchObject({ title: 'Call back', status: 'todo', customerId: customer.id, createdBy: admin.id, tags: [], checklist: [] });
    expect(open.dueDate).toBe('2026-07-10'); // 1783674000000 ms is 09:00 UTC on that day
    expect(open.assignees.map((p) => p.name)).toEqual(['Ola Nowak']);
    const done = (await m.tasks.getTask('old-done'))!.card;
    expect(done).toMatchObject({ status: 'done', dueDate: null, createdBy: null });
    expect(done.doneAt?.getTime()).toBe(1783100000000);
    expect(done.assignees).toEqual([]);
  });

  it('removes the demo projects, tasks and colleagues, and nothing else', async () => {
    const keep = await m.tasks.createProject({ name: 'My real project' }, admin);
    const kept = await m.tasks.createTask({ title: 'Real work', projectId: keep, assigneeIds: [admin.id] }, admin);
    await m.tasks.removeDemoTasks();
    const projects = await m.tasks.listProjects();
    expect(projects.map((p) => p.project.name)).toContain('My real project');
    expect(projects.some((p) => p.project.demo)).toBe(false);
    expect(await m.tasks.getTask(kept)).not.toBeNull();
    const users = await m.db.getDb().select({ email: m.schema.users.email }).from(m.schema.users);
    expect(users.some((u) => u.email.endsWith(`@${m.tasks.DEMO_USER_DOMAIN}`))).toBe(false);
    expect(users.some((u) => u.email.startsWith('admin@'))).toBe(true);
    // Every demo task belonged to a demo project, so none is left.
    expect(await m.tasks.listTasks({ q: 'loyalty programme' })).toHaveLength(0);
    expect(await m.tasks.listTasks({ q: 'Send the October invoice reminders' })).toHaveLength(0);
  });
});
