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
}: {
  children: React.ReactNode;
  details: React.ReactNode;
  colSpan: number;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = open ? Minus : Plus;
  return (
    <>
      <tr className={cn(open && 'bg-slate-50', className)}>
        <td className="w-10 py-3 pr-0 pl-4 align-top">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? `Hide ${label}` : `Show ${label}`}
            className="flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
          >
            <Icon className="size-3.5" />
          </button>
        </td>
        {children}
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="px-4 pb-4 pt-1">
            {details}
          </td>
        </tr>
      )}
    </>
  );
}
