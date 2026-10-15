'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { marketplaceAccounts, type OrderStatus } from '@/server/db/schema';
import type { Address, ParcelSpec } from '@/server/integrations/types';
import { enqueue, JOBS } from '@/server/jobs/queue';
import {
  acceptOrder,
  assignOrder,
  loadOrder,
  withPickupPoint,
  refreshOrder,
  setTags,
  updateShippingDetails,
} from '@/server/services/orders';
import { addNote, deleteNote, editNote, setNoteImportant } from '@/server/services/order-notes';
import {
  cancelShipment,
  createBatch,
  loadRoutingData,
  pollNow,
  presetToParcel,
  requestShipment,
  retryShipment,
  routeOrder,
  ShippingError,
} from '@/server/services/shipping';
import { retryTrackingPush } from '@/server/services/tracking';
import { changeStatus } from '@/server/services/workflow';
import { eq } from 'drizzle-orm';

function ids(formData: FormData): string[] {
  return String(formData.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function refresh(orderId?: string) {
  revalidatePath('/orders');
  // Notes are also shown next to the packing tick.
  revalidatePath('/shipments');
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function syncNowAction(): Promise<void> {
  await requireUser();
  const accounts = await getDb().select({ id: marketplaceAccounts.id }).from(marketplaceAccounts).where(eq(marketplaceAccounts.enabled, true));
  for (const a of accounts) await enqueue(JOBS.syncAccount, { accountId: a.id }, { singletonKey: a.id });
  refresh();
}

export async function bulkCreateLabelsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const selected = ids(formData);
  if (selected.length === 0) return { error: 'Select at least one order' };
  const batchId = await createBatch(selected, user.id);
  redirect(`/shipments/batches/${batchId}`);
}

export async function bulkStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const status = String(formData.get('status') ?? '') as OrderStatus;
  const selected = ids(formData);
  if (!status || selected.length === 0) return { error: 'Pick a status and at least one order' };
  const errors: string[] = [];
  for (const id of selected) {
    try {
      await changeStatus(getDb(), id, status, { userId: user.id });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  refresh();
  if (errors.length) return { error: `${selected.length - errors.length} updated, ${errors.length} skipped: ${[...new Set(errors)].join('; ')}` };
  return { ok: `${selected.length} order(s) updated` };
}

export async function bulkAssignAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const assignee = String(formData.get('assigneeId') ?? '');
  return attempt(async () => {
    await assignOrder(ids(formData), assignee || null, user.id);
    refresh();
    return 'Assignment saved';
  });
}

export async function changeStatusAction(orderId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const status = String(formData.get('status')) as OrderStatus;
  return attempt(async () => {
    await changeStatus(getDb(), orderId, status, { userId: user.id });
    refresh(orderId);
    return 'Status changed';
  });
}

export async function addNoteAction(orderId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await addNote(orderId, user.id, String(formData.get('note') ?? ''), formData.get('important') === 'on');
    refresh(orderId);
    return 'Note added';
  });
}

export async function editNoteAction(noteId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const { orderId } = await editNote(noteId, user, String(formData.get('note') ?? ''));
    refresh(orderId);
    return 'Note saved';
  });
}

export async function deleteNoteAction(noteId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const { orderId } = await deleteNote(noteId, user);
    refresh(orderId);
    return 'Note deleted';
  });
}

export async function setNoteImportantAction(noteId: string, important: boolean): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const { orderId } = await setNoteImportant(noteId, important, user);
    refresh(orderId);
    return important ? 'Marked as important' : 'No longer important';
  });
}

export async function assignAction(orderId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await assignOrder([orderId], String(formData.get('assigneeId') ?? '') || null, user.id);
    await setTags(orderId, String(formData.get('tags') ?? '').split(','), user.id);
    refresh(orderId);
  });
}

export async function updateAddressAction(orderId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const field = (name: string) => String(formData.get(name) ?? '').trim();
  const address: Address = {
    name: field('name'),
    company: field('company') || null,
    street: field('street'),
    city: field('city'),
    postalCode: field('postalCode'),
    countryCode: field('countryCode').toUpperCase() || 'PL',
    phone: field('phone') || null,
    email: field('email') || null,
  };
  return attempt(async () => {
    if (!address.name || !address.street || !address.city || !address.postalCode) throw new Error('Name, street, city and postal code are required');
    await updateShippingDetails(orderId, { address, pickupPointId: field('pickupPointId').toUpperCase() || null }, user.id);
    refresh(orderId);
    return 'Address saved';
  });
}

export async function acceptOrderAction(orderId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await acceptOrder(orderId, user.id);
    refresh(orderId);
    return 'Order accepted';
  });
}

export async function refreshOrderAction(orderId: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await refreshOrder(orderId);
    refresh(orderId);
    return 'Order refreshed from the marketplace';
  });
}

export async function createLabelAction(orderId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const num = (name: string) => Number(String(formData.get(name) ?? '').replace(',', '.'));
  const text = (name: string) => String(formData.get(name) ?? '').trim();
  const parcel: ParcelSpec = {
    lengthCm: num('lengthCm'),
    widthCm: num('widthCm'),
    heightCm: num('heightCm'),
    weightKg: num('weightKg'),
    inpostTemplate: (text('inpostTemplate') || null) as ParcelSpec['inpostTemplate'],
  };
  return attempt(async () => {
    if (![parcel.lengthCm, parcel.widthCm, parcel.heightCm, parcel.weightKg].every((n) => Number.isFinite(n) && n > 0)) {
      throw new ShippingError('Enter the parcel dimensions and weight');
    }
    await requestShipment(
      {
        orderId,
        carrierAccountId: text('carrierAccountId'),
        service: text('service'),
        parcel,
        options: {
          codAmount: text('codAmount') || null,
          insuranceAmount: text('insuranceAmount') || null,
          pickupPointId: text('pickupPointId').toUpperCase() || null,
        },
        labelFormat: (text('labelFormat') || undefined) as 'pdf' | 'zpl' | undefined,
        labelSize: (text('labelSize') || undefined) as 'A4' | 'A6' | undefined,
      },
      user.id,
    );
    refresh(orderId);
    return 'Label requested. It will appear here in a few seconds.';
  });
}

export async function cancelShipmentAction(orderId: string, shipmentId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await cancelShipment(shipmentId, user.id);
    refresh(orderId);
    return 'Label cancelled';
  });
}

export async function retryShipmentAction(orderId: string, shipmentId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await retryShipment(shipmentId, user.id);
    refresh(orderId);
    return 'Label requested again';
  });
}

export async function pollShipmentAction(orderId: string, shipmentId: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await pollNow(shipmentId);
    refresh(orderId);
    return 'Checking with the carrier…';
  });
}

export async function retryTrackingAction(orderId: string, shipmentId: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await retryTrackingPush(shipmentId);
    refresh(orderId);
    return 'Sending tracking again…';
  });
}

/** One-click label from the details panel, using the carrier and package chosen by the shipping rules. */
export async function quickLabelAction(orderId: string): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const order = await withPickupPoint(await loadOrder(orderId));
    const data = await loadRoutingData();
    const route = routeOrder(order, data);
    if (!route) throw new ShippingError('No shipping rule matches this order. Open the full order to choose a carrier.');
    const preset = data.presets.find((p) => p.id === route.packagePresetId) ?? data.presets.find((p) => p.isDefault) ?? data.presets[0];
    if (!preset) throw new ShippingError('Add a package preset in Settings → Shipping first.');
    await requestShipment(
      {
        orderId,
        carrierAccountId: route.carrierAccountId,
        service: route.service,
        parcel: presetToParcel(preset),
        options: { codAmount: order.codAmount, pickupPointId: order.pickupPointId },
      },
      user.id,
    );
    refresh(orderId);
    return 'Label requested – it appears here in a few seconds.';
  });
}
