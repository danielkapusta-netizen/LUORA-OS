import { request, type RequestOptions } from '../../../http';
import type { CarrierSettings } from '../../../db/schema';
import { formatPostalCode, normalizePhone, splitStreet } from '../../address';
import type { Address, LabelFormat, LabelSize, SenderSettings } from '../../types';
import { inpostTrackingUrl, type CarrierAdapter, type CarrierService, type DeliveryStatus, type ShipmentRequest, type ShipmentStatus } from '../types';
import { msg } from '@/lib/i18n/msg';

export interface InpostCredentials {
  /** API token generated in InPost Manager Paczek (Moje konto → API). */
  apiToken: string;
  organizationId: string;
  sandbox?: boolean;
}

export const INPOST_SERVICES: CarrierService[] = [
  { id: 'inpost_locker_standard', name: 'InPost Paczkomat', requiresPickupPoint: true },
  { id: 'inpost_courier_standard', name: 'InPost Kurier standard' },
];

interface ShipxShipment {
  id: number;
  status: string;
  tracking_number: string | null;
}

const FAILED_STATUSES = new Set(['canceled', 'cancelled', 'expired']);

/** ShipX sending methods that require `custom_attributes.dropoff_point`. */
const NEEDS_DROPOFF_POINT = new Set(['parcel_locker', 'pok', 'courier_pok']);

/**
 * Dropping parcels at a Paczkomat only works for locker parcels: ShipX rejects it for courier
 * services ("unavailable_for_service"), so those are picked up by the courier instead.
 */
export function sendingMethodFor(service: string, settings: CarrierSettings): string {
  const method = settings.sendingMethod ?? 'dispatch_order';
  return method === 'parcel_locker' && service !== 'inpost_locker_standard' ? 'dispatch_order' : method;
}

/** ShipX statuses that mean the parcel reached the buyer or is waiting for them. */
function mapTrackingStatus(status: string): DeliveryStatus {
  if (status === 'delivered') return 'delivered';
  if (status === 'ready_to_pickup' || status === 'ready_to_pickup_from_pok' || status === 'stack_in_box_machine') return 'ready_for_pickup';
  if (status.startsWith('returned') || status === 'return_pickup_confirmation_to_sender') return 'returned';
  if (status === 'created' || status === 'confirmed' || status === 'offers_prepared') return 'unknown';
  return 'in_transit';
}

function person(address: Pick<Address, 'name' | 'company' | 'phone' | 'email'>) {
  const [first, ...rest] = address.name.trim().split(/\s+/);
  return {
    company_name: address.company || undefined,
    first_name: first || undefined,
    // ShipX requires a last name; a one-word name is sent as both.
    last_name: rest.join(' ') || first || undefined,
    email: address.email || undefined,
    phone: normalizePhone(address.phone),
  };
}

function shipxAddress(a: { street: string; city: string; postalCode: string; countryCode: string }) {
  const { street, buildingNumber } = splitStreet(a.street);
  return {
    street,
    building_number: buildingNumber || undefined,
    city: a.city,
    post_code: formatPostalCode(a.postalCode, a.countryCode),
    country_code: a.countryCode.toUpperCase(),
  };
}

export function buildShipxPayload(req: ShipmentRequest, settings: CarrierSettings) {
  const locker = req.service === 'inpost_locker_standard';
  const cod = req.codAmount ? Number(req.codAmount) : 0;
  // InPost requires insurance of at least the cash-on-delivery amount.
  const insurance = Math.max(req.insuranceAmount ? Number(req.insuranceAmount) : 0, cod);
  const sender: SenderSettings = req.sender;
  const sendingMethod = sendingMethodFor(req.service, settings);

  return {
    receiver: { ...person(req.receiver), address: locker ? undefined : shipxAddress(req.receiver) },
    sender: { ...person(sender), address: shipxAddress(sender) },
    parcels: [
      locker
        ? { template: req.parcel.inpostTemplate ?? 'small' }
        : {
            dimensions: {
              length: String(req.parcel.lengthCm * 10),
              width: String(req.parcel.widthCm * 10),
              height: String(req.parcel.heightCm * 10),
              unit: 'mm',
            },
            weight: { amount: String(req.parcel.weightKg), unit: 'kg' },
          },
    ],
    service: req.service,
    reference: req.reference.slice(0, 100),
    custom_attributes: {
      target_point: locker ? req.pickupPointId ?? undefined : undefined,
      sending_method: sendingMethod,
      dropoff_point: sendingMethod !== 'dispatch_order' ? settings.dropoffPoint || undefined : undefined,
    },
    cod: cod > 0 ? { amount: cod, currency: req.currency } : undefined,
    insurance: insurance > 0 ? { amount: insurance, currency: req.currency } : undefined,
  };
}

export class InpostAdapter implements CarrierAdapter {
  readonly carrier = 'inpost' as const;

  constructor(
    private readonly creds: InpostCredentials,
    private readonly settings: CarrierSettings = {},
  ) {}

  private get base(): string {
    return this.creds.sandbox ? 'https://sandbox-api-shipx-pl.easypack24.net' : 'https://api-shipx-pl.easypack24.net';
  }

  private async call<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    const { data } = await request<T>(`${this.base}${path}`, {
      ...options,
      method,
      headers: { Authorization: `Bearer ${this.creds.apiToken}`, Accept: 'application/json', ...options.headers },
    });
    return data;
  }

  async services(): Promise<CarrierService[]> {
    return INPOST_SERVICES;
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentStatus> {
    if (req.service === 'inpost_locker_standard' && !req.pickupPointId) {
      return { state: 'failed', externalId: '', error: msg('Parcel locker service needs a pickup point (Paczkomat) code') };
    }
    const sendingMethod = sendingMethodFor(req.service, this.settings);
    if (NEEDS_DROPOFF_POINT.has(sendingMethod) && !this.settings.dropoffPoint) {
      return { state: 'failed', externalId: '', error: msg('InPost needs the Paczkomat you drop parcels at: set "Drop-off point" in Settings → Integrations → InPost') };
    }
    const shipment = await this.call<ShipxShipment>('POST', `/v1/organizations/${this.creds.organizationId}/shipments`, {
      body: buildShipxPayload(req, this.settings),
      // A retried POST could buy a second label.
      retries: 0,
    });
    return this.toStatus(shipment);
  }

  /** ShipX buys the label asynchronously; the tracking number appears once the status is "confirmed". */
  async refreshShipment(ref: { externalId: string | null }): Promise<ShipmentStatus> {
    if (!ref.externalId) throw new Error(msg('InPost shipment has no id yet'));
    return this.toStatus(await this.call<ShipxShipment>('GET', `/v1/shipments/${ref.externalId}`));
  }

  private toStatus(s: ShipxShipment): ShipmentStatus {
    const externalId = String(s.id);
    if (FAILED_STATUSES.has(s.status)) return { state: 'failed', externalId, error: `InPost shipment status: ${s.status}` };
    if (s.tracking_number && s.status !== 'created' && s.status !== 'offers_prepared') {
      return {
        state: 'created',
        externalId,
        trackingNumber: s.tracking_number,
        trackingUrl: inpostTrackingUrl(s.tracking_number),
        carrierCode: 'INPOST',
      };
    }
    return { state: 'pending', externalId, retryAfterSeconds: 3 };
  }

  async getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer> {
    const query = { format: options.format === 'zpl' ? 'Zpl' : 'Pdf', type: options.size === 'A4' ? 'normal' : 'A6' };
    if (externalIds.length === 1) {
      return this.call<Buffer>('GET', `/v1/shipments/${externalIds[0]}/label`, { query, responseType: 'buffer' });
    }
    return this.call<Buffer>('GET', `/v1/organizations/${this.creds.organizationId}/shipments/labels`, {
      query: { ...query, 'shipment_ids[]': externalIds },
      responseType: 'buffer',
    });
  }

  async cancelShipment(externalId: string): Promise<void> {
    await this.call('DELETE', `/v1/shipments/${externalId}`, { responseType: 'none' });
  }

  async deliveryStatus(ref: { trackingNumber: string }): Promise<DeliveryStatus> {
    const data = await this.call<{ status: string }>('GET', `/v1/tracking/${encodeURIComponent(ref.trackingNumber)}`);
    return mapTrackingStatus(data.status);
  }
}
