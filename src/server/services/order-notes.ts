// Internal notes on orders. A note is a row of the order's activity log (type "note"), so it shows up there too.
// Authors can edit and delete their own notes (admins anyone's); every change leaves its own line in the log.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { canModifyNote, NOTE_MAX, noteExcerpt } from '../../lib/notes';
import { chunk, getDb } from '../db/client';
import { orderEvents, tasks, users } from '../db/schema';
import { logEvent } from './events';

export interface NoteTask {
  id: string;
  title: string;
  status: string;
}

export interface OrderNote {
  id: string;
  orderId: string;
  message: string;
  pinned: boolean;
  createdAt: Date;
  editedAt: Date | null;
  userId: string | null;
  userName: string | null;
  task: NoteTask | null;
}

export type Actor = { id: string; role: string };

const isNote = and(eq(orderEvents.type, 'note'), isNull(orderEvents.deletedAt));

function clean(text: string): string {
  const note = (text ?? '').trim();
  if (!note) throw new Error('Write the note first');
  if (note.length > NOTE_MAX) throw new Error(`A note can have at most ${NOTE_MAX} characters`);
  return note;
}

async function loadNote(noteId: string) {
  const [row] = await getDb().select().from(orderEvents).where(and(eq(orderEvents.id, noteId), isNote));
  if (!row) throw new Error('This note no longer exists');
  return row;
}

/** The notes of these orders, important ones first and then newest first. */
export async function notesForOrders(orderIds: string[]): Promise<Map<string, OrderNote[]>> {
  const result = new Map<string, OrderNote[]>();
  for (const ids of chunk([...new Set(orderIds)])) {
    const rows = await getDb()
      .select({ event: orderEvents, userName: users.name, task: { id: tasks.id, title: tasks.title, status: tasks.status } })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.userId))
      .leftJoin(tasks, eq(tasks.id, orderEvents.taskId))
      .where(and(inArray(orderEvents.orderId, ids), isNote))
      .orderBy(desc(orderEvents.createdAt));
    for (const { event, userName, task } of rows) {
      const note: OrderNote = {
        id: event.id,
        orderId: event.orderId,
        message: event.message,
        pinned: event.pinned,
        createdAt: event.createdAt,
        editedAt: event.editedAt,
        userId: event.userId,
        userName,
        task: task?.id ? task : null,
      };
      result.set(event.orderId, [...(result.get(event.orderId) ?? []), note]);
    }
  }
  for (const [orderId, notes] of result) result.set(orderId, [...notes.filter((n) => n.pinned), ...notes.filter((n) => !n.pinned)]);
  return result;
}

/** How many notes each order has, and how many of them are important. Orders without notes are not in the map. */
export async function noteCounts(orderIds: string[]): Promise<Map<string, { count: number; important: number }>> {
  const result = new Map<string, { count: number; important: number }>();
  for (const ids of chunk([...new Set(orderIds)])) {
    const rows = await getDb()
      .select({ orderId: orderEvents.orderId, count: sql<number>`count(*)`, important: sql<number>`coalesce(sum(${orderEvents.pinned}), 0)` })
      .from(orderEvents)
      .where(and(inArray(orderEvents.orderId, ids), isNote))
      .groupBy(orderEvents.orderId);
    for (const r of rows) result.set(r.orderId, { count: r.count, important: r.important });
  }
  return result;
}

export async function addNote(orderId: string, userId: string, text: string, important = false): Promise<void> {
  const message = clean(text);
  await getDb().insert(orderEvents).values({ orderId, type: 'note', message, userId, pinned: important });
}

export async function editNote(noteId: string, actor: Actor, text: string): Promise<{ orderId: string }> {
  const message = clean(text);
  const note = await loadNote(noteId);
  if (!canModifyNote(note.userId, actor)) throw new Error('Only the author or an admin can change this note');
  if (message === note.message) return { orderId: note.orderId };
  const db = getDb();
  await db.update(orderEvents).set({ message, editedAt: new Date() }).where(eq(orderEvents.id, noteId));
  await logEvent(db, note.orderId, 'edit', `Edited a note (was: “${noteExcerpt(note.message, 160)}”)`, { userId: actor.id });
  return { orderId: note.orderId };
}

export async function deleteNote(noteId: string, actor: Actor): Promise<{ orderId: string }> {
  const note = await loadNote(noteId);
  if (!canModifyNote(note.userId, actor)) throw new Error('Only the author or an admin can delete this note');
  const db = getDb();
  await db.update(orderEvents).set({ deletedAt: new Date(), pinned: false }).where(eq(orderEvents.id, noteId));
  await logEvent(db, note.orderId, 'edit', `Deleted a note: “${noteExcerpt(note.message, 160)}”`, { userId: actor.id });
  return { orderId: note.orderId };
}

/** Anyone on the team can mark a note important; it is then shown on top, on the Orders and Shipments pages. */
export async function setNoteImportant(noteId: string, important: boolean, actor: Actor): Promise<{ orderId: string }> {
  const note = await loadNote(noteId);
  if (note.pinned === important) return { orderId: note.orderId };
  const db = getDb();
  await db.update(orderEvents).set({ pinned: important }).where(eq(orderEvents.id, noteId));
  await logEvent(db, note.orderId, 'edit', important ? `Marked a note as important: “${noteExcerpt(note.message, 160)}”` : `Removed the important mark from a note: “${noteExcerpt(note.message, 160)}”`, { userId: actor.id });
  return { orderId: note.orderId };
}

/** Remembers which task a note became, so the note can show it. */
export async function linkNoteToTask(noteId: string, taskId: string): Promise<{ orderId: string }> {
  const note = await loadNote(noteId);
  await getDb().update(orderEvents).set({ taskId }).where(eq(orderEvents.id, noteId));
  return { orderId: note.orderId };
}
