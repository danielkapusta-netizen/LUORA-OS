import { cn } from '@/lib/utils';

const SEGMENTS = 14;

const TONES = {
  excellent: 'stroke-emerald-500',
  good: 'stroke-emerald-400',
  low: 'stroke-amber-400',
  none: 'stroke-slate-200',
} as const;

/** Semicircle of short bars, filled from the left in proportion to `value` (0–1). */
export function Gauge({ value, tone, className, label }: { value: number; tone: keyof typeof TONES; className?: string; label?: string }) {
  const filled = tone === 'none' ? 0 : Math.max(1, Math.round(Math.min(1, value) * SEGMENTS));
  const bars = Array.from({ length: SEGMENTS }, (_, i) => {
    // From 180° (left) to 0° (right).
    const angle = Math.PI - (Math.PI * (i + 0.5)) / SEGMENTS;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return { x1: 30 + 17 * cos, y1: 30 - 17 * sin, x2: 30 + 27 * cos, y2: 30 - 27 * sin, on: i < filled };
  });
  return (
    <svg viewBox="0 0 60 33" className={cn('h-8 w-14', className)} role="img" aria-label={label}>
      {bars.map((b, i) => (
        <line
          key={i}
          x1={b.x1.toFixed(2)}
          y1={b.y1.toFixed(2)}
          x2={b.x2.toFixed(2)}
          y2={b.y2.toFixed(2)}
          strokeWidth={3.2}
          strokeLinecap="round"
          className={b.on ? TONES[tone] : 'stroke-slate-200'}
        />
      ))}
    </svg>
  );
}
