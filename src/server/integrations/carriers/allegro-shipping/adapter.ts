// "Wysyłam z Allegro" (Allegro Delivery): buys labels at Allegro's rates for
// Allegro orders, using the delivery method the buyer chose at checkout.
import { randomUUID } from 'node:crypto';
import type { CarrierSettings } from '../../../db/schema';
import { parseRetryAfter } from '../../../http';
import { describeAllegroErrors, type AllegroClient } from '../../marketplaces/allegro/client';
import type { LabelFormat, LabelSize } from '../../types';
import { inpostTrackingUrl, type CarrierAdapter, type CarrierService, type DeliveryStatus, type ShipmentRequest, type ShipmentStatus } from '../types';

/** Service id meaning "use the delivery method from the Allegro order". */
export const BUYER_CHOICE = 'buyer_choice';

interface CreateCommandStatus {
  commandId: string;
  status: 'IN_PROGRESS' | 'SUCCESS' | 'ERROR';
  errors?: { code?: string; message?: string; userMessage?: string; path?: string }[];
  shipmentId?: string | null;
}

interface AllegroShipment {
  id: string;
  carrier?: string | null;
  packages: { waybill?: string | null; transportingInfo?: { carrierId?: string; carrierWaybill?: string }[] }[];
}

interface DeliveryService {
  id: { deliveryMethodId: string; credentialsId?: string | null };
  name: string;
  cashOnDelivery?: { forceRequireIban?: boolean | null } | null;
}

const CALLING_CODES: Record<string, string> = {
  PL: '48', CZ: '420', SK: '421', HU: '36', DE: '49', AT: '43', LT: '370', LV: '371', EE: '372', RO: '40',
  BG: '359', HR: '385', SI: '386', FR: '33', IT: '39', ES: '34', NL: '31', BE: '32',
};

/**
 * Allegro wants an international number ("sender.phone must include an international prefix"):
 * a leading + or 00 is kept, a national number gets the calling code of the address's country.
 */
export function allegroPhone(phone: string | null | undefined, countryCode?: string): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return undefined;
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) return `+${digits.replace(/^00/, '')}`;
  const code = CALLING_CODES[(countryCode ?? '').trim().toUpperCase()];
  if (!code) return digits;
  // Polish numbers have no trunk zero; elsewhere a leading 0 is dropped.
  return `+${code}${code === '48' ? digits.replace(/^48(?=\d{9}$)/, '') : digits.replace(/^0/, '')}`;
}

function contact(a: { name: string; company?: string | null; street: string; postalCode: string; city: string; countryCode: string; email?: string | null; phone?: string | null }) {
  return {
    name: a.name.trim(),
    company: a.company?.trim() || undefined,
    street: a.street.trim(),
    postalCode: a.postalCode.trim(),
    city: a.city.trim(),
    countryCode: a.countryCode.trim().toUpperCase(),
    email: a.email?.trim() || undefined,
    phone: allegroPhone(a.phone, a.countryCode),
  };
}

/** Strips Polish and other diacritics ("ł" has no decomposed form, so it is mapped by hand). */
function toAscii(text: string): string {
  return text.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Allegro rejects longer reference numbers ("Długość podanego tekstu przekracza 35 znaków"). */
const REFERENCE_NUMBER_MAX = 35;
/** The strictest carrier limit for the text printed on the label (DHL BOX: "max 30 characters"). */
const TEXT_ON_LABEL_MAX = 30;

/**
 * Allegro accepts only letters, digits and "_/-" in referenceNumber, without diacritics, and at
 * most 35 characters, e.g. "6B7C4270: 1x Anua PDRN 100 + Hyaluron" → "6B7C4270_1x_Anua_PDRN_100_Hyaluron".
 */
export function allegroReferenceNumber(reference: string): string {
  return toAscii(reference)
    .replace(/[^A-Za-z0-9_/-]+/g, '_')
    .slice(0, REFERENCE_NUMBER_MAX)
    .replace(/^_+|_+$/g, '');
}

/**
 * @param requireIban the delivery service's `cashOnDelivery.forceRequireIban`. When false, COD money
 *   goes to the seller's Allegro balance and Allegro rejects an IBAN/owner, so neither is sent.
 */
export function buildCreateCommand(req: ShipmentRequest, settings: CarrierSettings, commandId: string, requireIban = false) {
  const deliveryMethodId = req.service === BUYER_CHOICE ? req.deliveryMethodId : req.service;
  if (!deliveryMethodId) throw new Error('The Allegro order has no delivery method to ship with');
  const dim = (value: number) => ({ value, unit: 'CENTIMETER' });

  return {
    commandId,
    input: {
      deliveryMethodId,
      sender: contact(req.sender),
      receiver: { ...contact(req.receiver), point: req.pickupPointId || undefined },
      referenceNumber: allegroReferenceNumber(req.reference),
      packages: [
        {
          type: 'PACKAGE',
          length: dim(req.parcel.lengthCm),
          width: dim(req.parcel.widthCm),
          height: dim(req.parcel.heightCm),
          weight: { value: req.parcel.weightKg, unit: 'KILOGRAMS' },
          textOnLabel: toAscii(req.reference).slice(0, TEXT_ON_LABEL_MAX).trimEnd(),
        },
      ],
      insurance: req.insuranceAmount ? { amount: req.insuranceAmount, currency: req.currency } : undefined,
      cashOnDelivery: req.codAmount
        ? {
            amount: req.codAmount,
            currency: req.currency,
            ...(requireIban ? { ownerName: settings.codOwnerName, iban: settings.codIban?.replace(/\s/g, '') } : {}),
          }
        : undefined,
      labelFormat: req.labelFormat === 'zpl' ? 'ZPL' : 'PDF',
    },
  };
}

const TRACKING_CODES: Record<string, DeliveryStatus> = {
  DELIVERED: 'delivered',
  AVAILABLE_FOR_PICKUP: 'ready_for_pickup',
  RETURNED: 'returned',
};

export class AllegroShippingAdapter implements CarrierAdapter {
  readonly carrier = 'allegro_shipping' as const;

  constructor(
    private readonly client: AllegroClient,
    private readonly settings: CarrierSettings = {},
  ) {}

  private deliveryServices?: Promise<DeliveryService[]>;

  private loadDeliveryServices(): Promise<DeliveryService[]> {
    this.deliveryServices ??= this.client
      .call<{ services: DeliveryService[] }>('GET', '/shipment-management/delivery-services')
      .then((d) => d.services);
    return this.deliveryServices;
  }

  async services(): Promise<CarrierService[]> {
    const services = await this.loadDeliveryServices();
    return [{ id: BUYER_CHOICE, name: "Buyer's delivery method" }, ...services.map((s) => ({ id: s.id.deliveryMethodId, name: s.name }))];
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentStatus> {
    let requireIban = false;
    if (req.codAmount) {
      const methodId = req.service === BUYER_CHOICE ? req.deliveryMethodId : req.service;
      const service = (await this.loadDeliveryServices()).find((s) => s.id.deliveryMethodId === methodId);
      requireIban = Boolean(service?.cashOnDelivery?.forceRequireIban);
      if (requireIban && !this.settings.codIban) {
        return {
          state: 'failed',
          externalId: '',
          error: `"${service?.name ?? 'This delivery service'}" pays cash on delivery by bank transfer: add the IBAN from your Allegro payout settings to the Allegro Delivery account`,
        };
      }
    }
    if (req.insuranceAmount) {
      // Kept in the Worker logs so the insurance rules of each delivery service can be checked.
      const methodId = req.service === BUYER_CHOICE ? req.deliveryMethodId : req.service;
      const service = (await this.loadDeliveryServices()).find((s) => s.id.deliveryMethodId === methodId);
      console.log('[allegro-shipping] insured label', req.insuranceAmount, req.currency, JSON.stringify(service ?? { deliveryMethodId: methodId }));
    }
    // Our shipment id doubles as the command id, so a retried request can't create a second shipment.
    const body = buildCreateCommand(req, this.settings, req.shipmentId, requireIban);
    const response = await this.client.callWithHeaders('POST', '/shipment-management/shipments/create-commands', { body });
    return {
      state: 'pending',
      externalId: '',
      commandId: body.commandId,
      retryAfterSeconds: (parseRetryAfter(response.headers.get('retry-after')) ?? 2000) / 1000,
    };
  }

  async refreshShipment(ref: { externalId: string | null; commandId: string | null }): Promise<ShipmentStatus> {
    let shipmentId = ref.externalId;
    if (!shipmentId) {
      if (!ref.commandId) throw new Error('Allegro shipment has neither a shipment id nor a command id');
      const response = await this.client.callWithHeaders<CreateCommandStatus>(
        'GET',
        `/shipment-management/shipments/create-commands/${ref.commandId}`,
      );
      const command = response.data;
      if (command.status === 'ERROR') {
        // Keep Allegro's full answer in the Worker logs for cases the short message can't explain.
        console.error('[allegro-shipping] create command failed', ref.commandId, JSON.stringify(command.errors));
        const error = describeAllegroErrors(command.errors) ?? 'Allegro rejected the shipment';
        return { state: 'failed', externalId: '', commandId: ref.commandId, error };
      }
      if (command.status !== 'SUCCESS' || !command.shipmentId) {
        return {
          state: 'pending',
          externalId: '',
          commandId: ref.commandId,
          retryAfterSeconds: (parseRetryAfter(response.headers.get('retry-after')) ?? 2000) / 1000,
        };
      }
      shipmentId = command.shipmentId;
    }

    const shipment = await this.client.call<AllegroShipment>('GET', `/shipment-management/shipments/${shipmentId}`);
    const pkg = shipment.packages[0];
    const carrierCode = pkg?.transportingInfo?.[0]?.carrierId ?? shipment.carrier ?? 'ALLEGRO';
    const waybill = pkg?.waybill ?? pkg?.transportingInfo?.[0]?.carrierWaybill;
    if (!waybill) return { state: 'pending', externalId: shipmentId, commandId: ref.commandId, retryAfterSeconds: 3 };
    return {
      state: 'created',
      externalId: shipmentId,
      commandId: ref.commandId,
      trackingNumber: waybill,
      trackingUrl: carrierCode === 'INPOST' ? inpostTrackingUrl(waybill) : null,
      carrierCode,
    };
  }

  async getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer> {
    return this.client.call<Buffer>('POST', '/shipment-management/label', {
      body: { shipmentIds: externalIds, pageSize: options.size, cutLine: false },
      headers: { Accept: 'application/octet-stream' },
      responseType: 'buffer',
    });
  }

  async cancelShipment(externalId: string): Promise<void> {
    await this.client.call('POST', '/shipment-management/shipments/cancel-commands', {
      body: { commandId: randomUUID(), input: { shipmentId: externalId } },
    });
  }

  async deliveryStatus(ref: { trackingNumber: string; carrierCode: string | null }): Promise<DeliveryStatus> {
    const data = await this.client.call<{
      waybills: { waybill: string; trackingDetails?: { statuses?: { code: string; occurredAt: string }[] } | null }[];
    }>('GET', `/order/carriers/${ref.carrierCode ?? 'ALLEGRO'}/tracking`, { query: { waybill: ref.trackingNumber } });
    const statuses = data.waybills[0]?.trackingDetails?.statuses ?? [];
    const latest = [...statuses].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
    if (!latest) return 'unknown';
    return TRACKING_CODES[latest.code] ?? 'in_transit';
  }
}
