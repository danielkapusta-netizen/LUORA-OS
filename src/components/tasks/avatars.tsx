import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n/server';
import { Avatar, SIZE, type Person } from './avatar';

export { Avatar };

/** Overlapping avatars, "+N" for the ones that do not fit, and a dashed circle when nobody is assigned. */
export async function AvatarStack({ people, max = 3, size = 'md' }: { people: Person[]; max?: number; size?: keyof typeof SIZE }) {
  const t = await getT();
  if (people.length === 0) {
    return (
      <span title={t('Nobody is assigned')} className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-300', SIZE[size])}>
        –
      </span>
    );
  }
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="inline-flex -space-x-1.5" aria-label={t('Assigned to {names}', { names: people.map((p) => p.name).join(', ') })}>
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {rest > 0 && (
        <span
          title={people
            .slice(max)
            .map((p) => p.name)
            .join(', ')}
          className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700 ring-2 ring-white', SIZE[size])}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
