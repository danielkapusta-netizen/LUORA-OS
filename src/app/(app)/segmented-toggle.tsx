'use client';

// Two or three options in a pill, switched in place (no navigation): the white highlight slides to the chosen one.
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function SegmentedToggle<V extends string>({ options, value, onChange, label }: { options: { value: V; label: string }[]; value: V; onChange: (value: V) => void; label: string }) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current.get(value);
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);

  return (
    <div role="group" aria-label={label} className="relative inline-flex gap-0.5 rounded-full bg-black/[0.04] p-1">
      {box && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-full bg-white shadow-[0_1px_2px_rgba(28,27,25,0.08)] transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: box.left, width: box.width }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          ref={(el) => {
            if (el) refs.current.set(o.value, el);
            else refs.current.delete(o.value);
          }}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative z-10 rounded-full px-3 py-1 text-xs font-medium transition-colors max-md:py-2',
            o.value === value ? 'text-ink' : 'text-slate-600 hover:text-ink',
            // Before the highlight is measured, the chosen option carries its own background.
            !box && o.value === value && 'bg-white shadow-[0_1px_2px_rgba(28,27,25,0.08)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
