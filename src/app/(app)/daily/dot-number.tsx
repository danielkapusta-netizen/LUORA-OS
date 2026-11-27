'use client';

// A dot-matrix number that, when the page refreshes with a new value, counts to it on a critically damped spring
// (no overshoot) instead of jumping. The first paint shows the value as it is; reduced motion always jumps.
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/locales';
import { DotDigits, formatDots, type DotFormat } from './dot-digits';

/** Seconds for the spring to reach its target; Apple's "response". */
const RESPONSE = 0.6;

export function DotNumber({
  value,
  format,
  locale,
  label,
  ...rest
}: {
  value: number;
  format: DotFormat;
  locale: Locale;
  label: string;
  dot?: number;
  gap?: number;
  ghost?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = value;
      setShown(value);
      return;
    }
    // Critically damped: x(t) = target + (start − target)(1 + ωt)e^(−ωt), starting from what is on screen now.
    const omega = (2 * Math.PI) / RESPONSE;
    const began = performance.now();
    const tick = (now: number) => {
      const t = (now - began) / 1000;
      const x = value + (start - value) * (1 + omega * t) * Math.exp(-omega * t);
      from.current = x;
      if (Math.abs(x - value) < 0.5 || t > 2) {
        from.current = value;
        setShown(value);
        return;
      }
      setShown(x);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);

  return <DotDigits text={formatDots(shown, format, locale)} label={label} {...rest} />;
}
