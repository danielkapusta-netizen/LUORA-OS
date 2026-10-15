// Rules for internal order notes, shared by the server and the pages.

export const NOTE_MAX = 2000;

/** Authors change and delete their own notes; admins can change anyone's (a note whose author is gone is admin-only). */
export function canModifyNote(authorId: string | null, actor: { id: string; role: string }): boolean {
  return actor.role === 'admin' || (authorId !== null && authorId === actor.id);
}

/** The first line, cut to fit in a short title or a log line. */
export function noteExcerpt(text: string, max = 80): string {
  const line = text.trim().split(/\r?\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
