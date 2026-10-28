import { CircleAlert, ListTodo, MessageSquareText, Pencil, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { NewTaskDialog } from '@/components/tasks/task-dialog';
import { Textarea } from '@/components/ui';
import { canModifyNote, NOTE_MAX, noteExcerpt } from '@/lib/notes';
import { cn, formatDate } from '@/lib/utils';
import type { OrderNote } from '@/server/services/order-notes';
import { addNoteAction, deleteNoteAction, editNoteAction, setNoteImportantAction } from './actions';
import { getT } from '@/lib/i18n/server';

export interface NoteTaskDialog {
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  tags: string[];
}

const small = 'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50';

/**
 * The notes marked important, on top of wherever an order shows up, so nobody ships it without
 * reading them (e.g. "pack as a gift"). Shows nothing when there are none.
 */
export async function ImportantNotes({ notes, className }: { notes: Pick<OrderNote, 'id' | 'message' | 'userName'>[]; className?: string }) {
  const t = await getT();
  if (notes.length === 0) return null;
  return (
    <div role="note" className={cn('rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5', className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        <CircleAlert className="size-4" aria-hidden /> {t('Read before shipping')}
      </p>
      <ul className="mt-1 space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="text-sm whitespace-pre-wrap break-words text-amber-950">
            {n.message}
            {n.userName && <span className="ml-1.5 text-xs text-amber-800/70">— {n.userName}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function NoteItem({ note, orderId, orderNumber, viewer, taskDialog }: { note: OrderNote; orderId: string; orderNumber: string; viewer: { id: string; role: string }; taskDialog: NoteTaskDialog & { meId: string } }) {
  const t = await getT();
  const mine = canModifyNote(note.userId, viewer);
  return (
    <li className={cn('rounded-xl px-3 py-2 ring-1', note.pinned ? 'bg-amber-50 ring-amber-300' : 'bg-slate-50 ring-slate-200')}>
      <p className="text-sm whitespace-pre-wrap break-words text-slate-900">
        {note.pinned && <Star className="mr-1 inline size-3.5 -translate-y-px fill-amber-400 text-amber-500" aria-label={t('Important')} />}
        {note.message}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {note.userName ?? t('Unknown')} · {formatDate(note.createdAt, true, t.locale)}
        {note.editedAt && <span title={t('Edited {date}', { date: formatDate(note.editedAt, true, t.locale) })}> {t('· edited')}</span>}
      </p>
      {note.task && (
        <p className="mt-1.5 text-xs">
          <Link href={`/tasks/${note.task.id}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            <ListTodo className="size-3.5" aria-hidden /> {t('Task:')} {note.task.title}
          </Link>
          <span className="text-slate-500"> · {note.task.status === 'done' ? 'done' : note.task.status.replace('_', ' ')}</span>
        </p>
      )}
      <div className="mt-1.5 -ml-1.5 flex flex-wrap items-center gap-x-0.5">
        <ActionForm action={setNoteImportantAction.bind(null, note.id, !note.pinned)} showOk={false}>
          <button type="submit" className={small}>
            <Star className={cn('size-3.5', note.pinned && 'fill-amber-400 text-amber-500')} aria-hidden /> {note.pinned ? t('Not important') : t('Important')}
          </button>
        </ActionForm>
        {!note.task && (
          <NewTaskDialog
            {...taskDialog}
            label={t('Task')}
            variant="ghost"
            size="sm"
            buttonClassName="h-7 px-2.5 text-xs font-medium text-slate-600"
            defaults={{ orderId, noteId: note.id, title: `${t('Order {number}', { number: orderNumber })}: ${noteExcerpt(note.message)}`, description: note.message }}
          />
        )}
        {mine && (
          <>
            <details key={note.editedAt?.getTime() ?? 0} className="group open:w-full">
              <summary className={cn(small, 'cursor-pointer list-none')}>
                <Pencil className="size-3.5" aria-hidden /> {t('Edit')}
              </summary>
              <ActionForm action={editNoteAction.bind(null, note.id)} showOk={false} className="mt-1 mb-1 space-y-2">
                <Textarea name="note" rows={3} maxLength={NOTE_MAX} defaultValue={note.message} required aria-label={t('Edit note')} />
                <SubmitButton size="sm" variant="secondary" pendingText={t('Saving…')}>
                  {t('Save')}
                </SubmitButton>
              </ActionForm>
            </details>
            <ActionForm action={deleteNoteAction.bind(null, note.id)} showOk={false}>
              <SubmitButton variant="ghost" size="sm" className="h-7 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50" confirm={t('Delete this note? The activity log keeps a record that it was deleted.')} pendingText="…">
                <Trash2 className="size-3.5" aria-hidden /> {t('Delete')}
              </SubmitButton>
            </ActionForm>
          </>
        )}
      </div>
    </li>
  );
}

/** Internal notes on one order: add one (optionally marked important), and change, delete or turn each into a task. */
export async function OrderNotes({
  orderId,
  orderNumber,
  notes,
  viewer,
  taskDialog,
}: {
  orderId: string;
  orderNumber: string;
  notes: OrderNote[];
  viewer: { id: string; role: string };
  taskDialog: NoteTaskDialog;
}) {
  const t = await getT();
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <MessageSquareText className="size-4 text-slate-400" aria-hidden /> {t('Notes')}
        {notes.length > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{notes.length}</span>}
      </p>
      <ActionForm action={addNoteAction.bind(null, orderId)} resetOnSuccess showOk={false} className="mt-2 space-y-2">
        <Textarea name="note" rows={2} maxLength={NOTE_MAX} placeholder={t('Leave an internal note for the team…')} required aria-label={t('Note on order {number}', { number: orderNumber })} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SubmitButton size="sm" variant="secondary" pendingText={t('Saving…')}>
            {t('Add note')}
          </SubmitButton>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" name="important" className="size-3.5 rounded border-slate-300 text-amber-500" /> {t('Important: show it before shipping')}
          </label>
        </div>
      </ActionForm>
      {notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} orderId={orderId} orderNumber={orderNumber} viewer={viewer} taskDialog={{ ...taskDialog, meId: viewer.id }} />
          ))}
        </ul>
      )}
    </div>
  );
}
