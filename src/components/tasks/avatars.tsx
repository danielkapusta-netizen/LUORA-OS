import { avatarStyle, initials } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';

const SIZE = { sm: 'size-6 text-[10px]', md: 'size-7 text-[11px]', lg: 'size-9 text-xs' } as const;

interface Person {
  id: string;
  name: string;
}

/** A round badge with a person's initials in a colour that is theirs everywhere. */
export function Avatar({ person, size = 'md', className }: { person: Person; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span
      title={person.name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white', SIZE[size], avatarStyle(person.id), className)}
    >
      {initials(person.name)}
    </span>
  );
}

/** Overlapping avatars, "+N" for the ones that do not fit, and a dashed circle when nobody is assigned. */
export function AvatarStack({ people, max = 3, size = 'md' }: { people: Person[]; max?: number; size?: keyof typeof SIZE }) {
  if (people.length === 0) {
    return (
      <span title="Nobody is assigned" className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-300', SIZE[size])}>
        –
      </span>
    );
  }
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="inline-flex -space-x-1.5" aria-label={`Assigned to ${people.map((p) => p.name).join(', ')}`}>
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
