'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet } from '@/components/sheet';

interface OrderSheetState {
  /** The order the person opened, or null when nothing is open. */
  selection: string | null;
  /** The order the address says is selected; it catches up with `selection` once the server has answered. */
  urlOrder: string | null;
  show: (orderId: string) => void;
  close: () => void;
}

const Ctx = createContext<OrderSheetState | null>(null);

/** Tapping an order calls `show`; outside the provider it is absent. */
export function useOrderSheet() {
  return useContext(Ctx);
}

/**
 * Holds which order the person opened. Below the xl breakpoint the order's details are a bottom sheet,
 * and it opens on the tap itself, not when the server has answered: the sheet slides up at once with a
 * placeholder, and the real details replace it when they arrive. From xl up it is the side panel.
 */
export function OrderSheetProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const urlOrder = useSearchParams().get('order');
  // An order in the address (a shared link, a reload) opens straight away; otherwise nothing is open.
  const [selection, setSelection] = useState<string | null>(urlOrder);

  // The back button closes the sheet, like dismissing it does.
  useEffect(() => {
    const onPop = () => setSelection(new URL(window.location.href).searchParams.get('order'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const show = useCallback(
    (orderId: string) => {
      setSelection(orderId);
      const next = new URLSearchParams(window.location.search);
      next.set('order', orderId);
      router.push(`${pathname}?${next}`, { scroll: false });
    },
    [pathname, router],
  );

  const close = useCallback(() => {
    setSelection(null);
    const next = new URLSearchParams(window.location.search);
    next.delete('order');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router]);

  const value = useMemo(() => ({ selection, urlOrder, show, close }), [selection, urlOrder, show, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Placeholder() {
  return (
    <div className="animate-pulse space-y-4 py-2 xl:hidden" aria-busy="true" aria-label="Loading the order">
      <div className="h-16 rounded-2xl bg-slate-900/5" />
      <div className="h-12 rounded-xl bg-slate-900/5" />
      <div className="h-12 rounded-xl bg-slate-900/5" />
      <div className="h-32 rounded-2xl bg-slate-900/5" />
    </div>
  );
}

/** The order's details (rendered once, by the server): a bottom sheet on a phone or tablet, the side panel on a desktop. */
export function OrderSheet({ children }: { children: ReactNode }) {
  const ctx = useOrderSheet();
  if (!ctx) return <>{children}</>;
  const loading = ctx.selection !== null && ctx.selection !== ctx.urlOrder;
  return (
    <Sheet open={ctx.selection !== null} onClose={ctx.close} title="Order" staticFromXl>
      {loading && <Placeholder />}
      <div className={loading ? 'max-xl:hidden' : undefined}>{children}</div>
    </Sheet>
  );
}
