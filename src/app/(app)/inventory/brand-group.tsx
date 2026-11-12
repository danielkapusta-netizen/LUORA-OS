'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One brand's part of the product table: a header row that folds the brand's products away. */
export function BrandGroup({ label, summary, colSpan, children }: { label: string; summary: ReactNode; colSpan: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <tbody className="max-md:block [&>tr+tr]:border-t [&>tr+tr]:border-black/[0.04]">
      <tr className="max-md:block">
        <th colSpan={colSpan} scope="colgroup" className="border-y border-black/[0.06] bg-sidebar p-0 text-left font-normal max-md:block">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left max-md:py-3">
            <ChevronDown className={cn('size-4 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none', !open && '-rotate-90')} aria-hidden />
            <span className="text-sm font-semibold text-ink">{label}</span>
            <span className="text-xs text-slate-600">{summary}</span>
          </button>
        </th>
      </tr>
      {open && children}
    </tbody>
  );
}
