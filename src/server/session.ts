import { and, eq, gt } from 'drizzle-orm';
import { sha256 } from './crypto';
import { getDb } from './db/client';
import { sessions, users, type User } from './db/schema';

// Session lookup without anything from Next.js, so the Worker layer (OAuth consent, MCP) can use the same login as the app.

export const SESSION_COOKIE = 'luora_session';

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role'>;

const columns = { id: users.id, email: users.email, name: users.name, role: users.role };

/** The signed-in user for a session cookie value, or null when it is missing, unknown or expired. */
export async function userForSessionToken(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await getDb()
    .select(columns)
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

/** A user by id, for checks that must reflect the current role (a demoted or deleted user is gone at once). */
export async function userById(id: string): Promise<SessionUser | null> {
  const [row] = await getDb().select(columns).from(users).where(eq(users.id, id));
  return row ?? null;
}

/** One cookie from a request's Cookie header. */
export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}
