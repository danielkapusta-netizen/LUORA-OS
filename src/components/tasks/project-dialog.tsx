'use client';

import { Pencil, Plus } from 'lucide-react';
import { useActionState, useEffect } from 'react';
import { createProjectAction, updateProjectAction } from '@/app/(app)/tasks/actions';
import { SubmitButton } from '@/components/forms';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { PROJECT_COLORS, PROJECT_COLOR_KEYS } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';
import { Modal, useModal } from './modal';

interface ProjectValues {
  id: string;
  name: string;
  description: string | null;
  color: string;
  ownerId: string | null;
}

function ProjectForm({ people, project }: { people: { id: string; name: string }[]; project?: ProjectValues }) {
  const modal = useModal();
  const [state, action] = useActionState(project ? updateProjectAction.bind(null, project.id) : createProjectAction, null);

  useEffect(() => {
    if (state?.ok) modal?.close();
  }, [state, modal]);

  return (
    <form action={action} className="space-y-4">
      <Field label="Name">
        <Input name="name" required maxLength={80} defaultValue={project?.name} placeholder="e.g. Autumn campaign" autoFocus />
      </Field>
      <Field label="What is it about?">
        <Textarea name="description" rows={3} maxLength={5000} defaultValue={project?.description ?? ''} placeholder="A sentence or two for the team" />
      </Field>
      <div className="space-y-1">
        <span className="text-xs font-medium text-slate-600">Colour</span>
        <div className="flex flex-wrap gap-2.5">
          {PROJECT_COLOR_KEYS.map((key) => (
            <label key={key} className="cursor-pointer">
              <input type="radio" name="color" value={key} defaultChecked={(project?.color ?? PROJECT_COLOR_KEYS[0]) === key} className="peer sr-only" />
              <span
                title={key}
                className={cn('block size-7 rounded-full ring-slate-900 ring-offset-2 transition peer-checked:ring-2 peer-focus-visible:ring-2', PROJECT_COLORS[key].dot)}
              />
            </label>
          ))}
        </div>
      </div>
      <Field label="Owner">
        <Select name="ownerId" defaultValue={project?.ownerId ?? ''}>
          <option value="">Nobody in particular</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={() => modal?.close()} className="h-10 rounded-full px-5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <SubmitButton pendingText="Saving…">{project ? 'Save project' : 'Create project'}</SubmitButton>
      </div>
    </form>
  );
}

/** "New project" (or "Edit" when a project is given) with its form. */
export function ProjectDialog({
  people,
  project,
  label,
  variant = 'secondary',
  size = 'md',
  buttonClassName,
}: {
  people: { id: string; name: string }[];
  project?: ProjectValues;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  buttonClassName?: string;
}) {
  return (
    <Modal
      label={label ?? (project ? 'Edit' : 'New project')}
      title={project ? 'Edit project' : 'New project'}
      variant={variant}
      size={size}
      buttonClassName={buttonClassName}
      icon={project ? <Pencil className="size-3.5" aria-hidden /> : <Plus className="size-4" aria-hidden />}
    >
      <ProjectForm people={people} project={project} />
    </Modal>
  );
}
