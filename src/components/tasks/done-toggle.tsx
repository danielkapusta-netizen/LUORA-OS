'use client';

import { Check } from 'lucide-react';
import { useOptimistic, useTransition } from 'react';
import { toggleDoneAction } from '@/app/(app)/tasks/actions';
import { cn } from '@/lib/utils';

/** The round check box of a task card. It fills straight away; the list refreshes behind it. */
export function DoneToggle({ id, done, title }: { id: string; done: boolean; title: string }) {
  const [pending, start] = useTransition();
  const [checked, setChecked] = useOptimistic(done);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${checked ? 'Reopen' : 'Mark as done'}: ${title}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setChecked(!checked);
          const result = await toggleDoneAction(id, !checked);
          if (result?.error) window.alert(result.error);
        })
      }
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-transparent hover:border-brand-600 hover:text-brand-600/40',
      )}
    >
      <Check className="size-3" strokeWidth={3} aria-hidden />
    </button>
  );
}
