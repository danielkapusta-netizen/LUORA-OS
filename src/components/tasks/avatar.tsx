import { avatarStyle, initials } from '@/lib/tasks/model';
import { cn } from '@/lib/utils';

export const SIZE = { sm: 'size-6 text-[10px]', md: 'size-7 text-[11px]', lg: 'size-9 text-xs' } as const;

export interface Person {
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
