'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin, requireUser } from '@/server/auth';
import type { CarrierSettings, MarketplaceSettings, RuleConditions } from '@/server/db/schema';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { resetFeeCursor } from '@/server/services/fees';
import { startHistoryImport, stopHistoryImport } from '@/server/services/history';
import {
  createDefaultRules,
  createUser,
  deleteCarrierAccount,
  deleteMarketplaceAccount,
  deletePreset,
  deleteRule,
  deleteUser,
  empikCarriers,
  removeDemoData,
  resetPassword,
  saveCarrierAccount,
  saveMarketplaceAccount,
  savePreset,
  saveRule,
  testCarrierConnection,
  testMarketplaceConnection,
} from '@/server/services/settings';

const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
const bool = (fd: FormData, name: string) => fd.get(name) === 'on';

/** Secret fields left blank keep their stored value. */
function secrets(fd: FormData, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = text(fd, n);
    if (v) out[n] = v;
  }
  return out;
}

// ---------------------------------------------------------------- marketplaces

export async function saveMarketplaceAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const type = text(fd, 'type') as 'shopify' | 'allegro' | 'empik' | 'vonhalsky';
  const settings: MarketplaceSettings = { initialSyncDays: Number(text(fd, 'initialSyncDays')) || 14 };
  let credentials: Record<string, unknown> = {};

  if (type === 'shopify') {
    credentials = { shopDomain: text(fd, 'shopDomain'), ...secrets(fd, ['clientId', 'clientSecret', 'accessToken']) };
    settings.apiVersion = text(fd, 'apiVersion') || undefined;
    settings.locationId = text(fd, 'locationId') || undefined;
    settings.notifyCustomer = bool(fd, 'notifyCustomer');
    const keys = text(fd, 'pickupPointKeys');
    settings.pickupPointKeys = keys ? keys.split(',').map((k) => k.trim()).filter(Boolean) : undefined;
  } else if (type === 'allegro') {
    credentials = { ...secrets(fd, ['clientId', 'clientSecret']), sandbox: bool(fd, 'sandbox') };
  } else if (type === 'vonhalsky') {
    credentials = {
      organizationId: text(fd, 'organizationId'),
      sandbox: bool(fd, 'sandbox'),
      ...secrets(fd, ['clientId', 'clientSecret']),
      // A new client or environment needs a fresh token.
      accessToken: '',
      expiresAt: '',
    };
    settings.vhMarkupPercent = Number(text(fd, 'vhMarkupPercent').replace(',', '.')) || 0;
    const rounding = text(fd, 'vhRounding');
    settings.vhRounding = rounding === 'x.00' || rounding === 'none' ? rounding : 'x.99';
    const dim = (name: string, fallback: number) => Number(text(fd, name).replace(',', '.')) || fallback;
    settings.vhBox = { width: dim('vhBoxWidth', 10), height: dim('vhBoxHeight', 10), length: dim('vhBoxLength', 5) };
    settings.vhDaysToShip = Math.max(0, Math.floor(Number(text(fd, 'vhDaysToShip')) || 1));
  } else if (type === 'empik') {
    credentials = { baseUrl: text(fd, 'baseUrl'), ...secrets(fd, ['apiKey']), ...(text(fd, 'shopId') ? { shopId: text(fd, 'shopId') } : {}) };
    settings.autoAccept = bool(fd, 'autoAccept');
    const codes: Record<string, string> = {};
    if (text(fd, 'carrierCodeInpostLocker')) codes.inpostLocker = text(fd, 'carrierCodeInpostLocker');
    if (text(fd, 'carrierCodeInpostCourier')) codes.inpostCourier = text(fd, 'carrierCodeInpostCourier');
    settings.carrierCodes = codes;
  }

  let savedId = id;
  const result = await attempt(async () => {
    const name = text(fd, 'name');
    if (!name) throw new Error('Give the account a name');
    savedId = await saveMarketplaceAccount({
      id: id ?? undefined,
      type,
      name,
      credentials,
      settings,
      enabled: bool(fd, 'enabled'),
      stockSyncEnabled: bool(fd, 'stockSyncEnabled'),
      stockDryRun: bool(fd, 'stockDryRun'),
    });
    revalidatePath('/settings/integrations');
    return 'Saved';
  });
  if (!id && savedId && result?.ok) redirect(`/settings/integrations/marketplace/${savedId}`);
  return result;
}

function backWith(message: string): never {
  redirect(`/settings/integrations?message=${encodeURIComponent(message)}`);
}

export async function deleteMarketplaceAction(id: string): Promise<void> {
  await requireAdmin();
  try {
    await deleteMarketplaceAccount(id);
  } catch (err) {
    backWith(`Could not delete the account: ${err instanceof Error ? err.message : err}`);
  }
  revalidatePath('/settings/integrations');
  backWith('Account deleted');
}

export async function refreshEmpikCarriersAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const carriers = await empikCarriers(id, true);
    revalidatePath(`/settings/integrations/marketplace/${id}`);
    return `Loaded ${carriers.length} carrier(s) from Empik`;
  });
}

export async function testMarketplaceAction(id: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => `Connected: ${await testMarketplaceConnection(id)}`);
}

export async function syncAccountAction(id: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await enqueue(JOBS.syncAccount, { accountId: id }, { singletonKey: id });
    return 'Sync queued';
  });
}

export async function importListingsAction(id: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await enqueue(JOBS.listingsImport, { accountId: id }, { singletonKey: id });
    return 'Listing import queued; see the Inventory page';
  });
}

export async function removeDemoDataAction(): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const removed = await removeDemoData();
    revalidatePath('/settings/integrations');
    revalidatePath('/settings/shipping');
    revalidatePath('/orders');
    return `Removed ${removed.accounts} demo marketplace account(s), ${removed.carriers} demo carrier(s) and ${removed.orders} demo order(s). Next: check your real carriers and add shipping rules.`;
  });
}

// ---------------------------------------------------------------- carriers

export async function saveCarrierAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const type = text(fd, 'type') as 'inpost' | 'allegro_shipping';
  const settings: CarrierSettings = {
    labelFormat: text(fd, 'labelFormat') === 'zpl' ? 'zpl' : 'pdf',
    labelSize: text(fd, 'labelSize') === 'A4' ? 'A4' : 'A6',
    productsInReference: bool(fd, 'productsInReference'),
  };
  let credentials: Record<string, unknown> = {};
  if (type === 'inpost') {
    credentials = { ...secrets(fd, ['apiToken']), organizationId: text(fd, 'organizationId'), sandbox: bool(fd, 'sandbox') };
    settings.sendingMethod = text(fd, 'sendingMethod') || 'dispatch_order';
    settings.dropoffPoint = text(fd, 'dropoffPoint').replace(/\s/g, '').toUpperCase() || undefined;
  } else {
    settings.codIban = text(fd, 'codIban').replace(/\s/g, '') || undefined;
    settings.codOwnerName = text(fd, 'codOwnerName') || undefined;
  }
  const sender = {
    name: text(fd, 'senderName'),
    company: text(fd, 'senderCompany') || null,
    street: text(fd, 'senderStreet'),
    city: text(fd, 'senderCity'),
    postalCode: text(fd, 'senderPostalCode'),
    countryCode: text(fd, 'senderCountryCode').toUpperCase() || 'PL',
    phone: text(fd, 'senderPhone'),
    email: text(fd, 'senderEmail'),
  };

  let savedId = id;
  const result = await attempt(async () => {
    if (!text(fd, 'name')) throw new Error('Give the account a name');
    if (!sender.name || !sender.street || !sender.city || !sender.postalCode || !sender.phone || !sender.email) {
      throw new Error('Fill in the whole sender address, phone and email');
    }
    if (type === 'allegro_shipping' && !text(fd, 'marketplaceAccountId')) throw new Error('Choose the Allegro account to ship with');
    if (type === 'inpost' && settings.sendingMethod === 'parcel_locker' && !settings.dropoffPoint) {
      throw new Error('Enter the drop-off point: the Paczkomat where you drop parcels (e.g. ZOF01M)');
    }
    savedId = await saveCarrierAccount({
      id: id ?? undefined,
      type,
      name: text(fd, 'name'),
      credentials,
      marketplaceAccountId: type === 'allegro_shipping' ? text(fd, 'marketplaceAccountId') : null,
      sender,
      settings,
      enabled: bool(fd, 'enabled'),
    });
    revalidatePath('/settings/integrations');
    return 'Saved';
  });
  if (!id && savedId && result?.ok) redirect(`/settings/integrations/carrier/${savedId}`);
  return result;
}

export async function deleteCarrierAction(id: string): Promise<void> {
  await requireAdmin();
  try {
    await deleteCarrierAccount(id);
  } catch {
    backWith('This carrier already has labels, so it can’t be deleted. Disable it instead.');
  }
  revalidatePath('/settings/integrations');
  backWith('Carrier deleted');
}

export async function testCarrierAction(id: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => `Connected: ${await testCarrierConnection(id)}`);
}

// ---------------------------------------------------------------- rules & presets

export async function saveRuleAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const conditions: RuleConditions = {};
  const marketplaces = fd.getAll('marketplaces').map(String) as RuleConditions['marketplaces'];
  if (marketplaces?.length) conditions.marketplaces = marketplaces;
  if (text(fd, 'deliveryMethodContains')) conditions.deliveryMethodContains = text(fd, 'deliveryMethodContains');
  if (text(fd, 'hasPickupPoint')) conditions.hasPickupPoint = text(fd, 'hasPickupPoint') === 'yes';
  if (text(fd, 'cod')) conditions.cod = text(fd, 'cod') === 'yes';
  // "route" is "<carrier account id>|<service id>" from one combined select.
  const [carrierAccountId, service] = text(fd, 'route').split('|');
  return attempt(async () => {
    if (!text(fd, 'name') || !carrierAccountId || !service) throw new Error('Name, carrier and service are required');
    await saveRule({
      id: id ?? undefined,
      name: text(fd, 'name'),
      priority: Number(text(fd, 'priority')) || 100,
      enabled: bool(fd, 'enabled'),
      conditions,
      carrierAccountId,
      service,
      packagePresetId: text(fd, 'packagePresetId') || null,
    });
    revalidatePath('/settings/shipping');
    return 'Rule saved';
  });
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await deleteRule(id);
    revalidatePath('/settings/shipping');
    return 'Rule deleted';
  });
}

export async function createDefaultRulesAction(): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const count = await createDefaultRules();
    revalidatePath('/settings/shipping');
    return count ? `${count} rule(s) added` : 'Add an InPost or Allegro Delivery account first';
  });
}

export async function savePresetAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const dims = ['lengthCm', 'widthCm', 'heightCm'].map((k) => Number(text(fd, k)));
    const weight = Number(text(fd, 'weightKg').replace(',', '.'));
    if (!text(fd, 'name') || dims.some((d) => !Number.isInteger(d) || d <= 0) || !(weight > 0)) {
      throw new Error('Name, whole-centimetre dimensions and a weight are required');
    }
    await savePreset({
      id: id ?? undefined,
      name: text(fd, 'name'),
      lengthCm: dims[0],
      widthCm: dims[1],
      heightCm: dims[2],
      weightKg: String(weight),
      inpostTemplate: text(fd, 'inpostTemplate') || null,
      isDefault: bool(fd, 'isDefault'),
    });
    revalidatePath('/settings/shipping');
    return 'Package saved';
  });
}

export async function deletePresetAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await deletePreset(id);
    revalidatePath('/settings/shipping');
    return 'Package deleted';
  });
}

// ---------------------------------------------------------------- users

export async function createUserAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await createUser({ email: text(fd, 'email'), name: text(fd, 'name'), password: String(fd.get('password') ?? ''), role: text(fd, 'role') === 'admin' ? 'admin' : 'staff' });
    revalidatePath('/settings/users');
    return 'User created';
  });
}

export async function deleteUserAction(id: string): Promise<ActionResult> {
  const me = await requireAdmin();
  return attempt(async () => {
    if (me.id === id) throw new Error("You can't delete yourself");
    await deleteUser(id);
    revalidatePath('/settings/users');
    return 'User deleted';
  });
}

export async function resetPasswordAction(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await resetPassword(id, String(fd.get('password') ?? ''));
    return 'Password changed';
  });
}

// ---------------------------------------------------------------- history and fees

export async function startHistoryAction(accountId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await startHistoryImport(accountId, { restart: fd.get('restart') === '1' });
    revalidatePath(`/settings/integrations/marketplace/${accountId}`);
    return 'The import of past orders has started; it runs in the background. Reload this page to see its progress.';
  });
}

export async function stopHistoryAction(accountId: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    await stopHistoryImport(accountId);
    revalidatePath(`/settings/integrations/marketplace/${accountId}`);
    return 'Stopped. “Resume” continues where it stopped.';
  });
}

export async function syncFeesAction(accountId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    if (fd.get('fromStart') === '1') await resetFeeCursor(accountId);
    await enqueue(JOBS.feesSync, { accountId }, { singletonKey: accountId });
    revalidatePath(`/settings/integrations/marketplace/${accountId}`);
    return 'Fees are being read in the background.';
  });
}
