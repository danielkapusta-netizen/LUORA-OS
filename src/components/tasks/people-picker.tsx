import { Avatar } from './avatars';

/** One tick-able pill per person (checkboxes named `name`), for choosing who a task is for. */
export function PeoplePicker({ people, name = 'assigneeIds', selected = [] }: { people: { id: string; name: string }[]; name?: string; selected?: string[] }) {
  if (people.length === 0) return <p className="text-sm text-slate-500">There are no users to assign yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {people.map((p) => (
        <label key={p.id} className="cursor-pointer">
          <input type="checkbox" name={name} value={p.id} defaultChecked={selected.includes(p.id)} className="peer sr-only" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pr-3 pl-1 text-sm text-slate-700 transition-colors peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-700 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40">
            <Avatar person={p} size="sm" className="ring-0" />
            {p.name}
          </span>
        </label>
      ))}
    </div>
  );
}
