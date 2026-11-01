'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';
import type { PickupCourier, Slot } from '@/lib/pickup-slots';
import { requireUser } from '@/server/auth';
import { bookPickup, pickupProposals, type ProposalResult } from '@/server/services/pickups';

/** The windows the carrier offers for the ticked parcels (the booking dialog asks when it opens). */
export async function proposalsAction(shipmentIds: string[], addressId: string): Promise<(ProposalResult & { error?: undefined }) | { error: string }> {
  await requireUser();
  try {
    return await pickupProposals(shipmentIds, addressId);
  } catch (err) {
    console.error(err);
    const t = await getT();
    return { error: err instanceof Error ? t(err.message) : t('Something went wrong') };
  }
}

export async function bookPickupAction(input: { courier: PickupCourier; shipmentIds: string[]; addressId: string; slot: Slot }): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const { failed } = await bookPickup(input, user.id);
    revalidatePath('/orders', 'layout');
    if (failed.length) throw new Error(failed.join('; '));
    return msg('Pickup requested');
  });
}
