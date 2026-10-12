import { cache } from 'react';
import { normalizeTag } from '@/lib/tasks/model';
import { listPeople, listProjects, tagCounts, type Person } from '@/server/services/tasks';

/** What the Tasks pages keep in the address, so a view can be shared and the back button works. */
export type TaskParams = {
  /** "me", "none" (nobody), or a user id; absent means everyone. */
  who?: string;
  project?: string;
  tag?: string;
  q?: string;
  /** The day shown on the overview and the calendar, YYYY-MM-DD. */
  day?: string;
  /** The month shown on the calendar, YYYY-MM-DD (any day of it). */
  month?: string;
  /** "compact" for dense lists. */
  view?: string;
  /** Overview: "all" to include every priority in the priority list. */
  prio?: string;
  /** Board: "all" to show every finished task, not only the last week's. */
  done?: string;
  /** Overview: "all" to show every tag. */
  tags?: string;
  archived?: string;
};

/** Loaded once per request, however many components ask. */
export const getPeople = cache(() => listPeople());
export const getActiveProjects = cache(() => listProjects());
export const getTagCounts = cache(() => tagCounts({ limit: 60 }));

export interface Scope {
  /** The user id, or "none"; undefined for everyone. */
  assignee?: string;
  projectId?: string;
  tag?: string;
  q?: string;
}

/** Turns the address into filters. An unknown person means everyone. */
export function resolveScope(params: TaskParams, meId: string, people: Person[]): Scope {
  const assignee = params.who === 'me' ? meId : params.who === 'none' ? 'none' : people.some((p) => p.id === params.who) ? params.who : undefined;
  return {
    assignee,
    projectId: params.project || undefined,
    tag: params.tag ? normalizeTag(params.tag) || undefined : undefined,
    q: params.q?.trim() || undefined,
  };
}

/** The address of a page with some of its parameters changed. */
export function link(path: string, params: TaskParams, change: Partial<Record<keyof TaskParams, string | undefined>> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...change })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
