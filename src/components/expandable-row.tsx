'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** A table row with a +/− button in its first cell that shows `details` in a full-width row below. */
export function ExpandableRow({
  children,
  details,
  colSpan,
  className,
  label = 'order details',
  stack = false,
}: {
  children: React.ReactNode;
  details: React.ReactNode;
  colSpan: number;
  className?: string;
  label?: string;
  /** On a phone, show the row as a card: its cells stack and the +/− button moves to the corner. The table around it must be block too. */
  stack?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = open ? Minus : Plus;
  return (
    <>
      <tr className={cn(open && 'bg-slate-50', stack && 'max-md:relative max-md:flex max-md:flex-col max-md:px-4 max-md:py-3', className)}>
        <td className={cn('w-10 py-3 pr-0 pl-4 align-top', stack && 'max-md:absolute max-md:top-1.5 max-md:right-1 max-md:w-auto max-md:p-0')}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? `Hide ${label}` : `Show ${label}`}
            className={cn('flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800', stack && 'max-md:size-11 max-md:rounded-xl max-md:border-0 max-md:bg-transparent')}
          >
            <Icon className="size-3.5" />
          </button>
        </td>
        {children}
      </tr>
      {open && (
        <tr className={cn('bg-slate-50', stack && 'max-md:block')}>
          <td colSpan={colSpan} className={cn('px-4 pb-4 pt-1', stack && 'max-md:block max-md:px-3')}>
            {details}
          </td>
        </tr>
      )}
    </>
  );
}
