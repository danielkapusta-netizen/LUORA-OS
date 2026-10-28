'use client';

import { Check } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { useOptimistic, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { setPackedAction } from './actions';

/** A checkbox styled as a button: grey "Packed" when not packed, green with a tick once packed. */
export function PackedToggle({ shipmentId, packed }: { shipmentId: string; packed: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(packed);
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !optimistic;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setPackedAction(shipmentId, next);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div>
      <button
        type="button"
        role="checkbox"
        aria-checked={optimistic}
        onClick={toggle}
        disabled={pending}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-70',
          optimistic
            ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
            : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200',
        )}
      >
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded border',
            optimistic ? 'border-white bg-white text-emerald-700' : 'border-slate-400 bg-white',
          )}
        >
          {optimistic && <Check className="size-3" strokeWidth={3} />}
        </span>
        {t('Packed')}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
