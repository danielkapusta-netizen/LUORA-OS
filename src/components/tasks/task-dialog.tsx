'use client';

import { Plus } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';
import { createTaskAction } from '@/app/(app)/tasks/actions';
import { SubmitButton } from '@/components/forms';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { PRIORITY_LABEL, TASK_PRIORITIES, type TaskStatus } from '@/lib/tasks/model';
import { Modal, useModal } from './modal';
import { PeoplePicker } from './people-picker';
import { useT } from '@/lib/i18n/client';

export interface TaskDefaults {
  title?: string;
  description?: string;
  dueDate?: string;
  projectId?: string;
  assigneeIds?: string[];
  status?: TaskStatus;
  customerId?: string;
  orderId?: string;
  /** The order note this task is made from; the note then shows the task. */
  noteId?: string;
}

interface Props {
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  /** Tags in use, offered as hints. */
  tags: string[];
  /** The signed-in user, ticked by default. */
  meId: string;
  defaults?: TaskDefaults;
}

function TaskForm({ people, projects, tags, meId, defaults = {} }: Props) {
  const t = useT();
  const modal = useModal();
  const [state, action] = useActionState(createTaskAction, null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset();
    modal?.close();
  }, [state, modal]);

  return (
    <form ref={form} action={action} key={JSON.stringify(defaults)} className="space-y-4">
      {defaults.status && <input type="hidden" name="status" value={defaults.status} />}
      {defaults.customerId && <input type="hidden" name="customerId" value={defaults.customerId} />}
      {defaults.orderId && <input type="hidden" name="orderId" value={defaults.orderId} />}
      {defaults.noteId && <input type="hidden" name="noteId" value={defaults.noteId} />}
      <Field label={t('Title')}>
        <Input name="title" required maxLength={200} defaultValue={defaults.title} placeholder={t('e.g. Photograph the new serum')} autoFocus />
      </Field>
      <Field label={t('Description')}>
        <Textarea name="description" rows={3} maxLength={5000} defaultValue={defaults.description} placeholder={t('Anything the person doing it should know')} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('Project')}>
          <Select name="projectId" defaultValue={defaults.projectId ?? ''}>
            <option value="">{t('No project')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Priority')}>
          <Select name="priority" defaultValue="normal">
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(PRIORITY_LABEL[p])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('Day')}>
          <Input name="dueDate" type="date" defaultValue={defaults.dueDate} />
        </Field>
        <Field label={t('From')}>
          <Input name="startTime" type="time" />
        </Field>
        <Field label={t('Until')}>
          <Input name="endTime" type="time" />
        </Field>
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-slate-600">{t('Who is it for?')}</span>
        <PeoplePicker people={people} selected={defaults.assigneeIds ?? [meId]} />
      </div>
      <Field label={t('Tags')} hint={tags.length ? t('Separate with commas. In use: {tags}', { tags: tags.slice(0, 8).map((tag) => `#${tag}`).join(' ') }) : t('Separate with commas')}>
        <Input name="tags" placeholder={t('posters, ideas')} />
      </Field>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={() => modal?.close()} className="h-10 rounded-full px-5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {t('Cancel')}
        </button>
        <SubmitButton pendingText={t('Creating…')}>{t('Create task')}</SubmitButton>
      </div>
    </form>
  );
}

/** The "New task +" button and its form. `defaults` fill in what the page you are on already knows. */
export function NewTaskDialog({
  label = 'New task',
  variant = 'primary',
  size = 'md',
  buttonClassName,
  ...props
}: Props & { label?: string; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; buttonClassName?: string }) {
  const t = useT();
  return (
    <Modal label={label} title={t('New task')} variant={variant} size={size} buttonClassName={buttonClassName} icon={<Plus className="size-4" aria-hidden />}>
      <TaskForm {...props} />
    </Modal>
  );
}
