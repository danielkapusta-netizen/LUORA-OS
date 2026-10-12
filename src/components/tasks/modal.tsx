'use client';

import { X } from 'lucide-react';
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui';
import { cn } from '@/lib/utils';

const ModalContext = createContext<{ close: () => void } | null>(null);

/** Lets a form inside a Modal close it, e.g. once its action succeeded. */
export function useModal() {
  return useContext(ModalContext);
}

/** A button that opens a native dialog; its content is rendered inside. */
export function Modal({
  label,
  title,
  icon,
  variant = 'primary',
  size = 'md',
  buttonClassName,
  children,
}: {
  label: ReactNode;
  title: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  buttonClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Stable, so a form can close the dialog from an effect without running it on every render.
  const value = useMemo(() => ({ close: () => ref.current?.close() }), []);
  const close = value.close;
  return (
    <>
      <button type="button" aria-label={label === '' ? title : undefined} className={cn(buttonClass(variant, size), buttonClassName)} onClick={() => ref.current?.showModal()}>
        {icon}
        {label}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself.
          if (e.target === ref.current) close();
        }}
        className="m-auto max-h-[90vh] w-[min(42rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-black/5 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-4" />
          </button>
        </div>
        <ModalContext.Provider value={value}>
          <div className="p-5">{children}</div>
        </ModalContext.Provider>
      </dialog>
    </>
  );
}
