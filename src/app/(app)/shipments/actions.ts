'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/server/auth';
import { requestInvoice, retryInvoice } from '@/server/services/invoicing';
import { setPacked } from '@/server/services/shipping';
import { retryFailedTrackingPushes } from '@/server/services/tracking';

function refreshInvoices() {
  revalidatePath('/shipments');
  revalidatePath('/accounting');
  revalidatePath('/orders', 'layout');
}

/** The "Create invoice" button: any order, whether or not the buyer asked for an invoice. */
export async function createInvoiceForOrderAction(orderId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await requestInvoice(orderId, user.id, { anyOrder: true });
    refreshInvoices();
    return 'Invoice requested';
  });
}

export async function retryInvoiceFromShipmentsAction(invoiceId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await retryInvoice(invoiceId, user.id);
    refreshInvoices();
    return 'Trying again';
  });
}

export async function retryFailedTrackingAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const count = await retryFailedTrackingPushes();
    revalidatePath('/shipments');
    return `Sending tracking again for ${count} label(s). Refresh in a moment.`;
  });
}

export async function setPackedAction(shipmentId: string, packed: boolean): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await setPacked(shipmentId, packed, user.id);
    revalidatePath('/shipments', 'layout');
    revalidatePath('/orders', 'layout');
    return packed ? 'Packed' : 'Not packed';
  });
}
