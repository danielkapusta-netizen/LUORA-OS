'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin, requireUser } from '@/server/auth';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { saveCrmSettings } from '@/server/services/crm-sync';
import { addCustomerNote, mergeCustomers, setCustomerTags } from '@/server/services/customers';
import { createTask, setTaskDone } from '@/server/services/tasks';

const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();

export async function addNoteAction(customerId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await addCustomerNote(customerId, text(fd, 'body'), user.id);
    revalidatePath(`/customers/${customerId}`);
    return 'Note added';
  });
}

export async function saveTagsAction(customerId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await setCustomerTags(customerId, text(fd, 'tags').split(','));
    revalidatePath(`/customers/${customerId}`);
    return 'Tags saved';
  });
}

/** A task about this customer: it lives with all the other tasks and links back here. */
export async function addTaskAction(customerId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const assignee = text(fd, 'assigneeId');
    await createTask({ title: text(fd, 'title'), dueDate: text(fd, 'dueAt') || null, customerId, assigneeIds: assignee ? [assignee] : [] }, user);
    revalidatePath('/', 'layout');
    return 'Task added';
  });
}

export async function toggleTaskAction(taskId: string, done: boolean, path: string): Promise<void> {
  const user = await requireUser();
  await setTaskDone(taskId, done, user).catch((err) => console.error(err));
  revalidatePath(path);
  revalidatePath('/', 'layout');
}

export async function mergeAction(targetId: string, sourceIds: string[]): Promise<void> {
  await requireUser();
  await mergeCustomers(targetId, sourceIds);
  revalidatePath('/customers/duplicates');
  redirect(`/customers/${targetId}`);
}

export async function saveCrmSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await saveCrmSettings({
      syncSegments: fd.getAll('syncSegments').map(String),
      syncManualTags: fd.get('syncManualTags') === 'on',
      dryRun: fd.get('dryRun') === 'on',
    });
    revalidatePath('/customers/segments');
    return 'Saved';
  });
}

export async function runCrmSyncAction(): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await enqueue(JOBS.crmSync, {}, { singletonKey: 'manual' });
    return 'Sync queued; it runs in the background.';
  });
}
