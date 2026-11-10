import { desc, lt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { appErrors } from '../db/schema';

const KEEP = 500;

export type AppErrorRow = { digest: string | null; path: string; route: string; kind: string; message: string; stack: string };

/** Saves one server error and trims the table to the newest rows. */
export async function recordAppError(row: AppErrorRow): Promise<void> {
  const db = getDb();
  await db.insert(appErrors).values(row);
  // Trim now and then rather than on every error.
  if (Math.random() < 0.1) {
    const [cutoff] = await db.select({ at: appErrors.at }).from(appErrors).orderBy(desc(appErrors.at)).limit(1).offset(KEEP);
    if (cutoff) await db.delete(appErrors).where(lt(appErrors.at, cutoff.at));
  }
}
