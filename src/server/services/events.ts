import type { Tx } from '../db/client';
import { orderEvents } from '../db/schema';

export type OrderEventType = 'status' | 'note' | 'sync' | 'label' | 'tracking' | 'stock' | 'error' | 'edit' | 'invoice';

export async function logEvent(
  db: Tx,
  orderId: string,
  type: OrderEventType,
  message: string,
  extra: { data?: unknown; userId?: string | null } = {},
): Promise<void> {
  await db.insert(orderEvents).values({ orderId, type, message, data: extra.data ?? null, userId: extra.userId ?? null });
}
