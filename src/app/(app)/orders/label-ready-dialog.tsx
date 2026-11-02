'use client';

import { Check, Printer, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { DynamicButton } from '@/components/dynamic-button';
import { PrintLabelButton } from '@/components/print-label-button';
import { buttonClass } from '@/components/ui';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { setPackedAction } from '../shipments/actions';
import { useOrderSheet } from './order-sheet';

const flag = (orderId: string) => `luora:label-requested:${orderId}`;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Wraps "Generate shipping label": remembers the click, so the pop-up opens once that label is ready. */
export function RememberLabelRequest({ orderId, children }: { orderId: string; children: ReactNode }) {
  return <div onClickCapture={() => storage()?.setItem(flag(orderId), '1')}>{children}</div>;
}

/**
 * The pop-up in the middle of the screen once a label just requested from the card is ready:
 * Print label, then Packed. Packed turns green, closes the pop-up and moves to the next order.
 * Opening an order that already has a label shows the usual card buttons, not the pop-up.
 */
export function LabelReadyDialog({
  orderId,
  shipmentId,
  nextOrderId,
  children,
}: {
  orderId: string;
  shipmentId: string;
  nextOrderId: string | null;
  /** What to pack, under the buttons: customer, items and where it goes. */
  children?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const sheet = useOrderSheet();
  const ref = useRef<HTMLDialogElement>(null);
  const [packed, setPacked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (storage()?.getItem(flag(orderId)) !== '1') return;
    storage()?.removeItem(flag(orderId));
    ref.current?.showModal();
  }, [orderId]);

  function close() {
    ref.current?.close();
  }

  function markPacked() {
    setError(null);
    // Outside the transition, so it turns green at once instead of when the whole transition ends.
    setPacked(true);
    startTransition(async () => {
      const result = await setPackedAction(shipmentId, true);
      if (result?.error) {
        setPacked(false);
        setError(result.error);
        return;
      }
      // A moment in green, so the change is seen before the next order opens.
      await new Promise((resolve) => setTimeout(resolve, 600));
      close();
      if (!nextOrderId) return;
      if (sheet) sheet.show(nextOrderId);
      else {
        const next = new URLSearchParams(window.location.search);
        next.set('order', nextOrderId);
        router.push(`${window.location.pathname}?${next}`, { scroll: false });
      }
    });
  }

  return (
    <dialog
      ref={ref}
      aria-label={t('Label ready')}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current && !pending) close();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-3xl border border-black/5 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40"
    >
      {/* The two buttons on top; Esc or a click outside closes it. */}
      <div className="grid grid-cols-2 gap-3 p-5">
        <PrintLabelButton className={cn(buttonClass('primary'), 'h-12 w-full')} href={`/api/labels/${shipmentId}`}>
          <Printer className="size-4" /> {t('Print label')}
        </PrintLabelButton>
        <DynamicButton
          width="full"
          className="h-12"
          onClick={markPacked}
          disabled={pending || packed}
          variant={packed ? 'success' : 'secondary'}
          stateKey={packed ? 'packed' : 'unpacked'}
          icon={packed ? <Check className="size-[15px]" strokeWidth={3} aria-hidden /> : <Square className="size-[15px]" aria-hidden />}
        >
          {packed ? t('Packed') : t('Mark packed')}
        </DynamicButton>
        {error && <p className="col-span-2 text-sm text-red-700">{error}</p>}
      </div>
      {children && <div className="max-h-[min(70dvh,36rem)] overflow-y-auto overscroll-contain border-t border-black/[0.06] px-5 pt-4 pb-5">{children}</div>}
    </dialog>
  );
}
