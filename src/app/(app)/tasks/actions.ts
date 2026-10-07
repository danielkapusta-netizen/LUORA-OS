'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, type ActionResult } from '@/lib/action-result';
import { isTaskPriority, isTaskStatus, type TaskPriority } from '@/lib/tasks/model';
import { requireUser } from '@/server/auth';
import {
  addChecklistItem,
  addComment,
  archiveProject,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  removeChecklistItem,
  setAssignees,
  setTaskDone,
  setTaskStatus,
  toggleAssignee,
  toggleChecklistItem,
  updateProject,
  updateTask,
} from '@/server/services/tasks';

const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
/** Tasks show up on the sidebar badge, the dashboard and the customer and order pages too. */
const refresh = () => revalidatePath('/', 'layout');

function taskFields(fd: FormData) {
  const priority = text(fd, 'priority');
  return {
    title: text(fd, 'title'),
    description: text(fd, 'description') || null,
    projectId: text(fd, 'projectId') || null,
    priority: (isTaskPriority(priority) ? priority : 'normal') as TaskPriority,
    dueDate: text(fd, 'dueDate') || null,
    startTime: text(fd, 'startTime') || null,
    endTime: text(fd, 'endTime') || null,
    tags: text(fd, 'tags'),
  };
}

// ---------------------------------------------------------------- tasks

export async function createTaskAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const status = text(fd, 'status');
    await createTask(
      {
        ...taskFields(fd),
        status: isTaskStatus(status) ? status : 'todo',
        assigneeIds: fd.getAll('assigneeIds').map(String),
        customerId: text(fd, 'customerId') || null,
        orderId: text(fd, 'orderId') || null,
      },
      user,
    );
    refresh();
    return 'Task created';
  });
}

/** The task page's form: details, status and people in one save. */
export async function saveTaskAction(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await updateTask(id, taskFields(fd), user);
    const status = text(fd, 'status');
    if (isTaskStatus(status)) await setTaskStatus(id, status, user);
    await setAssignees(id, fd.getAll('assigneeIds').map(String), user);
    refresh();
    return 'Saved';
  });
}

export async function toggleDoneAction(id: string, done: boolean): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await setTaskDone(id, done, user);
    refresh();
  });
}

/** Used by the board (drag and drop) and the card menu. */
export async function moveTaskAction(id: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    if (!isTaskStatus(status)) throw new Error('Unknown status');
    await setTaskStatus(id, status, user);
    refresh();
  });
}

export async function toggleAssignMeAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await toggleAssignee(id, user.id, user);
    refresh();
  });
}

export async function deleteTaskAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await deleteTask(id, user);
    refresh();
  });
}

/** Delete from the task's own page, which no longer exists afterwards. */
export async function deleteTaskAndLeaveAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await deleteTask(id, user);
    refresh();
    redirect('/tasks');
  });
}

export async function addCommentAction(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await addComment(id, text(fd, 'body'), user);
    refresh();
    return 'Comment added';
  });
}

export async function addChecklistItemAction(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await addChecklistItem(id, text(fd, 'text'));
    refresh();
    return 'Added';
  });
}

export async function toggleChecklistItemAction(id: string, itemId: string): Promise<void> {
  await requireUser();
  await toggleChecklistItem(id, itemId).catch((err) => console.error(err));
  refresh();
}

export async function removeChecklistItemAction(id: string, itemId: string): Promise<void> {
  await requireUser();
  await removeChecklistItem(id, itemId).catch((err) => console.error(err));
  refresh();
}

// ---------------------------------------------------------------- projects

function projectFields(fd: FormData) {
  return { name: text(fd, 'name'), description: text(fd, 'description') || null, color: text(fd, 'color') || undefined, ownerId: text(fd, 'ownerId') || null };
}

export async function createProjectAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const id = await createProject(projectFields(fd), user);
    refresh();
    redirect(`/tasks/projects/${id}`);
  });
}

export async function updateProjectAction(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await updateProject(id, projectFields(fd));
    refresh();
    return 'Saved';
  });
}

export async function archiveProjectAction(id: string, archived: boolean): Promise<void> {
  await requireUser();
  await archiveProject(id, archived);
  refresh();
}

export async function deleteProjectAction(id: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await deleteProject(id);
    refresh();
    redirect('/tasks/projects');
  });
}
