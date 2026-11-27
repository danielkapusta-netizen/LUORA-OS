'use client';

// The day hour by hour as columns of dots: today's revenue lit, the same weekday a week earlier as a fainter shadow
// behind it, so the rest of the day can be read ahead. Point at (or touch) a column for its hour.
import { useState } from 'react';
import { formatValue } from '@/components/analytics/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export interface HourBar {
  hour: number;
  revenue: number;
  orders: number;
}

const ROWS = 11;
const PITCH = 10;
const R = 3.1;

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function HourlyDots({ hours, ghost, nowHour }: { hours: HourBar[]; ghost: HourBar[]; /** The current hour (today), or null for a past day. */ nowHour: number | null }) {
  const t = useT();
  const locale = useLocale();
  const busiest = hours.reduce((best, h) => (h.revenue > best.revenue ? h : best), hours[0]);
  const [active, setActive] = useState<number>(nowHour ?? busiest.hour);
  const max = Math.max(1, ...hours.map((h) => h.revenue), ...ghost.map((h) => h.revenue));
  const level = (v: number) => (v > 0 ? Math.max(1, Math.round((v / max) * ROWS)) : 0);
  const width = 24 * PITCH;
  const height = ROWS * PITCH;
  const shown = hours[active];

  function pick(clientX: number, el: Element) {
    const box = el.getBoundingClientRect();
    const col = Math.floor(((clientX - box.left) / box.width) * 24);
    setActive(Math.min(23, Math.max(0, col)));
  }

  return (
    <div className="relative">
      {/* The bubble over the chosen hour, like a value read off the chart. */}
      <div className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 transition-[left] duration-200 ease-out motion-reduce:transition-none" style={{ left: `${Math.min(82, Math.max(18, ((active + 0.5) / 24) * 100))}%` }}>
        <span className="block rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-[#4a1240] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.35)]">
          {hh(active)} · {formatValue(shown.revenue, 'pln', false, locale)} · {t.plural(shown.orders, '{n} order', '{n} orders')}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full touch-none select-none"
        aria-hidden
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
      >
        {hours.map((h) => {
          const lit = level(h.revenue);
          const past = level(ghost[h.hour]?.revenue ?? 0);
          const later = nowHour !== null && h.hour > nowHour;
          const isActive = h.hour === active;
          return (
            <g key={h.hour}>
              {Array.from({ length: ROWS }, (_, r) => {
                const on = r < lit;
                const shadow = !on && r < past;
                return (
                  <circle
                    key={r}
                    cx={h.hour * PITCH + PITCH / 2}
                    cy={height - r * PITCH - PITCH / 2}
                    r={R}
                    className={cn('daily-dot-in', on ? (isActive ? 'fill-[#ff9ccf]' : 'fill-white') : 'fill-white')}
                    opacity={on ? 1 : shadow ? (later ? 0.34 : 0.26) : 0.09}
                    style={{ animationDelay: `${h.hour * 16 + r * 10}ms` }}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-white/60 tabular-nums" aria-hidden>
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t('Revenue by hour')}</caption>
        <thead>
          <tr>
            <th>{t('Hour')}</th>
            <th>{t('Revenue')}</th>
            <th>{t('Orders')}</th>
          </tr>
        </thead>
        <tbody>
          {hours
            .filter((h) => h.revenue > 0)
            .map((h) => (
              <tr key={h.hour}>
                <td>{hh(h.hour)}</td>
                <td>{formatValue(h.revenue, 'pln', false, locale)}</td>
                <td>{h.orders}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
