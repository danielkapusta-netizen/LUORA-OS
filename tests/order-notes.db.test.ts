// Order notes against a local D1 database: add, important, edit, delete, tasks, and the Orders list.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('order notes (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-notes-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    orders: typeof import('@/server/services/orders');
    notes: typeof import('@/server/services/order-notes');
    tasks: typeof import('@/server/services/tasks');
  };
  let orderA: string;
  let orderB: string;
  let admin: { id: string; role: string };
  let logistics: { id: string; role: string };
  let marketing: { id: string; role: string };

  const log = async (orderId: string) =>
    (await m.db.getDb().select().from(m.schema.orderEvents).where(m.orm.eq(m.schema.orderEvents.orderId, orderId))).filter((e) => e.type === 'edit').map((e) => e.message);

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    (await import('@/server/jobs/queue')).setEnqueueImplementation(async () => undefined);
    await (await import('@/server/db/seed')).seed();
    m = {
      db: await import('@/server/db/client'),
      schema: await import('@/server/db/schema'),
      orm: await import('drizzle-orm'),
      orders: await import('@/server/services/orders'),
      notes: await import('@/server/services/order-notes'),
      tasks: await import('@/server/services/tasks'),
    };
    for (const a of await m.db.getDb().select().from(m.schema.marketplaceAccounts)) await m.orders.syncAccount(a.id);
    [orderA, orderB] = (await m.db.getDb().select({ id: m.schema.orders.id }).from(m.schema.orders).limit(2)).map((o) => o.id);
    const people = await (await import('@/server/services/settings')).listUsers();
    admin = people.find((u) => u.role === 'admin')!;
    logistics = people.find((u) => u.role === 'logistics')!;
    marketing = people.find((u) => u.role === 'marketing')!;
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  it('adds notes, important ones first and then newest first, with who wrote them', async () => {
    await m.notes.addNote(orderA, logistics.id, 'First note');
    await new Promise((r) => setTimeout(r, 5));
    await m.notes.addNote(orderA, marketing.id, 'Pack as a gift', true);
    await new Promise((r) => setTimeout(r, 5));
    await m.notes.addNote(orderA, logistics.id, 'Latest note');
    const notes = (await m.notes.notesForOrders([orderA])).get(orderA)!;
    expect(notes.map((n) => [n.message, n.pinned])).toEqual([
      ['Pack as a gift', true],
      ['Latest note', false],
      ['First note', false],
    ]);
    const [author] = await m.db.getDb().select({ name: m.schema.users.name }).from(m.schema.users).where(m.orm.eq(m.schema.users.id, marketing.id));
    expect(notes[0].userName).toBe(author.name);
    expect((await m.notes.notesForOrders([orderB])).get(orderB)).toBeUndefined();
  });

  it('refuses an empty note and one over the limit', async () => {
    await expect(m.notes.addNote(orderB, admin.id, '   ')).rejects.toThrow('Write the note first');
    await expect(m.notes.addNote(orderB, admin.id, 'x'.repeat(2001))).rejects.toThrow('at most 2000');
    await m.notes.addNote(orderB, admin.id, 'x'.repeat(2000));
    await m.db.getDb().delete(m.schema.orderEvents).where(m.orm.and(m.orm.eq(m.schema.orderEvents.orderId, orderB), m.orm.eq(m.schema.orderEvents.type, 'note')));
  });

  it('counts notes per order for the list', async () => {
    const counts = await m.notes.noteCounts([orderA, orderB]);
    expect(counts.get(orderA)).toEqual({ count: 3, important: 1 });
    expect(counts.has(orderB)).toBe(false);
  });

  it('lets only the author or an admin edit a note, and logs what it was', async () => {
    const [mine] = (await m.notes.notesForOrders([orderA])).get(orderA)!.filter((n) => n.message === 'Latest note');
    await expect(m.notes.editNote(mine.id, marketing, 'Hijacked')).rejects.toThrow('Only the author or an admin');
    await m.notes.editNote(mine.id, logistics, 'Latest note, corrected');
    await m.notes.editNote(mine.id, admin, 'Latest note, corrected by admin');
    const after = (await m.notes.notesForOrders([orderA])).get(orderA)!.find((n) => n.id === mine.id)!;
    expect(after.message).toBe('Latest note, corrected by admin');
    expect(after.editedAt).toBeInstanceOf(Date);
    expect(await log(orderA)).toEqual(expect.arrayContaining([expect.stringContaining('Edited a note (was: “Latest note”)'), expect.stringContaining('was: “Latest note, corrected”')]));
    // Saving the same text again changes nothing and logs nothing.
    const before = (await log(orderA)).length;
    await m.notes.editNote(mine.id, admin, 'Latest note, corrected by admin');
    expect((await log(orderA)).length).toBe(before);
  });

  it('lets anyone mark a note important or not, and the list filter follows', async () => {
    const first = (await m.notes.notesForOrders([orderA])).get(orderA)!.find((n) => n.message === 'First note')!;
    await m.notes.setNoteImportant(first.id, true, marketing);
    expect((await m.notes.noteCounts([orderA])).get(orderA)).toEqual({ count: 3, important: 2 });
    const important = await m.orders.listOrders({ status: undefined, notes: 'important' });
    expect(important.rows.map((r) => r.order.id)).toEqual([orderA]);
    expect(important.rows[0].notes).toEqual({ count: 3, important: 2 });
    await m.notes.setNoteImportant(first.id, false, marketing);
    expect((await m.notes.noteCounts([orderA])).get(orderA)).toEqual({ count: 3, important: 1 });
    expect((await m.orders.listOrders({ notes: 'any' })).rows.map((r) => r.order.id)).toEqual([orderA]);
    expect((await m.orders.listOrders({})).rows.find((r) => r.order.id === orderB)!.notes).toBeNull();
  });

  it('turns a note into a task that the note then shows, and keeps the note when the task is deleted', async () => {
    const note = (await m.notes.notesForOrders([orderA])).get(orderA)!.find((n) => n.message === 'First note')!;
    const taskId = await m.tasks.createTask({ title: 'Order: First note', orderId: orderA, assigneeIds: [logistics.id] }, admin);
    await m.notes.linkNoteToTask(note.id, taskId);
    const linked = (await m.notes.notesForOrders([orderA])).get(orderA)!.find((n) => n.id === note.id)!;
    expect(linked.task).toMatchObject({ id: taskId, title: 'Order: First note', status: 'todo' });
    await m.db.getDb().delete(m.schema.tasks).where(m.orm.eq(m.schema.tasks.id, taskId));
    const after = (await m.notes.notesForOrders([orderA])).get(orderA)!.find((n) => n.id === note.id)!;
    expect(after.task).toBeNull();
    expect(after.message).toBe('First note');
  });

  it('deletes a note for its author or an admin only, hides it everywhere and logs the deletion', async () => {
    const note = (await m.notes.notesForOrders([orderA])).get(orderA)!.find((n) => n.message === 'First note')!;
    await expect(m.notes.deleteNote(note.id, marketing)).rejects.toThrow('Only the author or an admin');
    await m.notes.deleteNote(note.id, logistics);
    expect((await m.notes.notesForOrders([orderA])).get(orderA)!.map((n) => n.message)).not.toContain('First note');
    expect((await m.notes.noteCounts([orderA])).get(orderA)!.count).toBe(2);
    expect(await log(orderA)).toEqual(expect.arrayContaining([expect.stringContaining('Deleted a note: “First note”')]));
    const detail = await m.orders.getOrderDetail(orderA);
    expect(detail!.events.some((e) => e.event.type === 'note' && e.event.message === 'First note')).toBe(false);
    await expect(m.notes.editNote(note.id, logistics, 'Back again')).rejects.toThrow('no longer exists');
    await expect(m.notes.setNoteImportant(note.id, true, admin)).rejects.toThrow('no longer exists');
  });
});
