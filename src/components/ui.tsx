import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md') {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
    // On a phone the targets grow to Apple's 44 pt minimum (md) and 40 pt (sm, used inside rows).
    size === 'sm' ? 'h-8 px-3 text-xs max-md:h-10 max-md:px-4 max-md:text-sm' : 'h-10 px-5 text-sm max-md:h-11',
    'press cursor-pointer',
    variant === 'primary' && 'bg-ink text-white hover:bg-ink-soft',
    variant === 'secondary' && 'border border-black/[0.08] bg-white text-ink hover:border-black/15 hover:bg-sidebar',
    variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
    variant === 'ghost' && 'text-slate-600 hover:bg-black/[0.04] hover:text-ink',
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export type Tone = 'peach' | 'butter' | 'blush' | 'sky';

/** Large panels take a pale tint of a pastel; the border is the same hue, a step deeper. */
const PANEL_TONES: Record<Tone, string> = {
  peach: 'border-peach/45 bg-peach-tint',
  butter: 'border-butter/60 bg-butter-tint',
  blush: 'border-blush/55 bg-blush-tint',
  sky: 'border-sky/55 bg-sky-tint',
};

export function Card({ className, children, tone, ...props }: ComponentProps<'section'> & { tone?: Tone }) {
  return (
    <section className={cn('rounded-3xl border', tone ? PANEL_TONES[tone] : 'border-black/[0.06] bg-white', className)} {...props}>
      {children}
    </section>
  );
}

/** A panel's title row: optional icon, title, a quiet count, and a link or controls on the right. */
export function CardHeader({
  title,
  description,
  actions,
  icon: Icon,
  count,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  count?: number | string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-1">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {Icon && <Icon className="size-[18px] text-ink" strokeWidth={1.75} aria-hidden />}
          {title}
          {count !== undefined && <CountPill>{count}</CountPill>}
        </h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CountPill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex min-w-6 items-center justify-center rounded-full border border-black/[0.08] bg-white/70 px-1.5 text-[11px] font-medium tabular-nums text-slate-600', className)}>{children}</span>;
}

/** The muted "View all" link in a panel header. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-full px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-ink">
      {children}
    </Link>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

// Soft, borderless chips. The pastel tones match the stat tiles, so a status keeps one colour across the app.
const BADGE_TONES = {
  gray: 'bg-black/[0.05] text-slate-700',
  blue: 'bg-sky-tint text-sky-ink',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-butter-tint text-butter-ink',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-blush-tint text-blush-ink',
  orange: 'bg-peach-tint text-peach-ink',
  sky: 'bg-sky/45 text-sky-ink',
  blush: 'bg-blush/50 text-blush-ink',
  butter: 'bg-butter/55 text-butter-ink',
  peach: 'bg-peach/45 text-peach-ink',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = 'gray', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE_TONES[tone], className)}>{children}</span>;
}

const FIELD = 'block w-full rounded-xl border border-black/[0.1] bg-white px-2.5 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:bg-slate-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(FIELD, 'h-10 max-md:h-11', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(FIELD, 'h-10 pr-8 max-md:h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, 'py-2', className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm text-slate-700', className)}>
      <input type="checkbox" className="size-4 rounded border-slate-300 accent-ink" {...props} />
      {label}
    </label>
  );
}

/** Small uppercase line above a title: a date, a scope, the last sync. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs font-medium tracking-[0.14em] text-slate-500 uppercase', className)}>{children}</p>;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-8">
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-ink md:text-[2.75rem]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TILE_TONES: Record<Tone, { tile: string; ink: string }> = {
  peach: { tile: 'bg-peach border-peach-ink/10', ink: 'text-peach-ink' },
  butter: { tile: 'bg-butter border-butter-ink/10', ink: 'text-butter-ink' },
  blush: { tile: 'bg-blush border-blush-ink/10', ink: 'text-blush-ink' },
  sky: { tile: 'bg-sky border-sky-ink/10', ink: 'text-sky-ink' },
};

/** The big pastel count: icon and label across the top, the number in mono, a caption under it. */
export function StatTile({ tone, icon: Icon, label, value, caption, href }: { tone: Tone; icon: LucideIcon; label: string; value: ReactNode; caption?: ReactNode; href?: string }) {
  const c = TILE_TONES[tone];
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <Icon className="size-5 text-ink" strokeWidth={1.75} aria-hidden />
        <span className={cn('text-right text-xs font-semibold tracking-[0.12em] uppercase', c.ink)}>{label}</span>
      </span>
      <span className="mt-5 block font-mono text-4xl leading-none font-medium tabular-nums text-ink md:text-5xl">{value}</span>
      {caption && <span className={cn('mt-2 block truncate text-sm', c.ink)}>{caption}</span>}
    </>
  );
  const cls = cn('block min-h-32 rounded-3xl border p-5', c.tile);
  return href ? (
    <Link href={href} className={cn(cls, 'lift press')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A plain white figure: label, mono number, an optional delta or caption beneath. */
export function MetricTile({ label, value, caption, hint, children, className }: { label: ReactNode; value: ReactNode; caption?: ReactNode; hint?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-3xl border border-black/[0.06] bg-white px-5 py-4', className)}>
      <p className="text-xs font-medium text-slate-500" title={hint}>
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-medium tracking-tight tabular-nums text-ink">{value}</p>
      {children}
      {caption && <p className="mt-1 text-xs text-slate-500">{caption}</p>}
    </div>
  );
}

/** A white row inside a tinted panel: a leading icon chip, title and subtitle, and something on the right. */
export function ListRow({
  href,
  icon,
  title,
  subtitle,
  trailing,
  wrap = false,
  className,
}: {
  href?: string;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Let a long title take two lines instead of cutting it off. */
  wrap?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {icon && <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-600">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium text-ink', wrap ? 'line-clamp-2' : 'truncate')}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-slate-500">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </>
  );
  const cls = cn('flex min-h-14 items-center gap-3 rounded-2xl border border-black/[0.04] bg-white/90 px-4 py-2.5', className);
  return href ? (
    <Link href={href} className={cn(cls, 'transition-colors hover:border-black/10 hover:bg-white')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A small rounded date or count on the right of a row. */
export function DatePill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-xs text-slate-600 tabular-nums', className)}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Alert({ tone = 'amber', children }: { tone?: 'amber' | 'red' | 'green' | 'blue'; children: ReactNode }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
  };
  return <div className={cn('rounded-2xl border px-4 py-2.5 text-sm', tones[tone])}>{children}</div>;
}

export const th = 'px-3 py-3 text-left text-xs font-medium text-slate-500';
export const td = 'px-3 py-3 align-top text-sm';
