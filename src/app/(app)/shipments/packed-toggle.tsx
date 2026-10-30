'use client';

import { Check, Square } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { useOptimistic, useState, useTransition } from 'react';
import { DynamicButton } from '@/components/dynamic-button';
import { setPackedAction } from './actions';

/** A checkbox as an animated button: white "Mark packed" until packed, then it morphs into green "Packed" with a tick. */
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
      <DynamicButton
        role="checkbox"
        aria-checked={optimistic}
        onClick={toggle}
        disabled={pending}
        variant={optimistic ? 'success' : 'secondary'}
        stateKey={optimistic ? 'packed' : 'unpacked'}
        icon={optimistic ? <Check className="size-[15px]" strokeWidth={3} aria-hidden /> : <Square className="size-[15px]" aria-hidden />}
      >
        {optimistic ? t('Packed') : t('Mark packed')}
      </DynamicButton>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
