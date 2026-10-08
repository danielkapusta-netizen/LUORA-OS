import { X } from 'lucide-react';
import Link from 'next/link';
import { Pills } from '@/components/analytics/blocks';
import { Input } from '@/components/ui';
import { TagChip } from './chips';
import { AutoSelect } from './auto-select';

interface Params {
  who?: string;
  project?: string;
  tag?: string;
  q?: string;
  [key: string]: string | undefined;
}

const firstName = (name: string) => name.split(/\s+/)[0] || name;

/**
 * Who, project, tag and search for a Tasks page. Everything lives in the address, so the filters are plain links
 * and a GET form; the project select submits itself.
 */
export function TaskFilterBar({
  path,
  params,
  people,
  projects,
  meId,
}: {
  path: string;
  params: Params;
  people: { id: string; name: string }[];
  /** Left out, the project select is not shown. */
  projects?: { id: string; name: string }[];
  meId: string;
}) {
  const href = (change: Params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...change })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const others = people.filter((p) => p.id !== meId);
  const active = params.who ?? 'all';
  const options = [
    { value: 'all', label: 'Everyone' },
    { value: 'me', label: 'Mine' },
    ...(others.length <= 5 ? others.map((p) => ({ value: p.id, label: firstName(p.name) })) : []),
    { value: 'none', label: 'Unassigned' },
  ];
  // Hidden fields keep the other parameters when the form is submitted.
  const kept = Object.entries(params).filter(([k, v]) => v && k !== 'project' && k !== 'q');
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Pills label="Whose tasks" options={options} active={options.some((o) => o.value === active) ? active : 'all'} href={(v) => href({ who: v === 'all' ? undefined : v })} />
      {others.length > 5 && (
        <form action={path} className="contents">
          {kept.filter(([k]) => k !== 'who').map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <AutoSelect name="who" defaultValue={people.some((p) => p.id === params.who) ? params.who : ''} aria-label="Person" className="h-8 w-40 rounded-full text-xs">
            <option value="">Anyone…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </AutoSelect>
        </form>
      )}
      <form action={path} className="flex flex-wrap items-center gap-2">
        {kept.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {projects && (
          <AutoSelect name="project" defaultValue={params.project ?? ''} aria-label="Project" className="h-8 w-44 rounded-full text-xs">
            <option value="">All projects</option>
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </AutoSelect>
        )}
        <Input name="q" defaultValue={params.q} placeholder="Search tasks" aria-label="Search tasks" className="h-8 w-48 rounded-full text-xs" />
      </form>
      {params.tag && (
        <span className="inline-flex items-center gap-1">
          <TagChip tag={params.tag} active />
          <Link href={href({ tag: undefined })} aria-label="Clear the tag filter" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-3.5" />
          </Link>
        </span>
      )}
    </div>
  );
}
