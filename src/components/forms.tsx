'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/utils';
import { buttonClass } from './ui';

export function SubmitButton({
  children,
  pendingText,
  variant = 'primary',
  size,
  className,
  name,
  value,
  confirm,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={cn(buttonClass(variant, size), className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (pendingText ?? 'Working…') : children}
    </button>
  );
}

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** A form bound to a server action that shows the action's success or error message. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  showOk = true,
  popup,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showOk?: boolean;
  /** Also shows the result as a pop-up in the corner (title = what finished). */
  popup?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [dismissed, setDismissed] = useState<ActionResult>(null);
  const shown = popup && state && state !== dismissed ? state : null;
  useEffect(() => {
    if (!state || state.error || !popup) return;
    const timer = setTimeout(() => setDismissed(state), 10_000);
    return () => clearTimeout(timer);
  }, [state, popup]);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && showOk && <p className="mt-2 text-sm text-emerald-700">{state.ok}</p>}
      {popup && shown && (
        <div
          role="status"
          className={cn(
            'fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl border bg-white p-4 shadow-lg',
            shown.error ? 'border-red-200' : 'border-emerald-200',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className={cn('text-sm font-semibold', shown.error ? 'text-red-700' : 'text-emerald-700')}>
              {popup} {shown.error ? 'failed' : 'finished'}
            </p>
            <button type="button" className="text-slate-400 hover:text-slate-700" aria-label="Close" onClick={() => setDismissed(state)}>
              ×
            </button>
          </div>
          <p className="mt-1 max-h-48 overflow-auto text-sm text-slate-700">{shown.error ?? shown.ok}</p>
        </div>
      )}
    </form>
  );
}
