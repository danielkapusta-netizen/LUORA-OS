import type { Address, Carrier, LabelFormat, LabelSize, ParcelSpec, SenderSettings } from '../types';

export interface CarrierService {
  id: string;
  name: string;
  /** Needs a parcel locker / pickup point code. */
  requiresPickupPoint?: boolean;
}

export interface ShipmentRequest {
  /** Our shipment id, used as idempotency key where the carrier supports one. */
  shipmentId: string;
  service: string;
  sender: SenderSettings;
  receiver: Address;
  pickupPointId?: string | null;
  parcel: ParcelSpec;
  codAmount?: string | null;
  insuranceAmount?: string | null;
  currency: string;
  /** Printed on the label, usually the order number. */
  reference: string;
  /** Allegro Delivery: the buyer's delivery method from the order. */
  deliveryMethodId?: string | null;
  labelFormat: LabelFormat;
}

export interface ShipmentStatus {
  state: 'pending' | 'created' | 'failed';
  externalId: string;
  /** Allegro create-command id while the shipment is being created. */
  commandId?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrierCode?: string | null;
  error?: string | null;
  /** Seconds the carrier asked us to wait before polling again. */
  retryAfterSeconds?: number | null;
}

/** Where the courier collects parcels (Allegro's AddressDto: name or company is required). */
export interface PickupAddressInput {
  name?: string | null;
  company?: string | null;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  phone: string;
  email: string;
}

/** A pickup window the carrier offers; InPost via Allegro offers dates only. */
export interface PickupSlot {
  date: string;
  minTime?: string | null;
  maxTime?: string | null;
}

export interface PickupStatus {
  state: 'pending' | 'booked' | 'failed';
  pickupId?: string | null;
  carrierPickupId?: string | null;
  error?: string | null;
  retryAfterSeconds?: number | null;
}

export type DeliveryStatus = 'in_transit' | 'ready_for_pickup' | 'delivered' | 'returned' | 'unknown';

export interface CarrierAdapter {
  readonly carrier: Carrier;
  services(): Promise<CarrierService[]>;
  createShipment(req: ShipmentRequest): Promise<ShipmentStatus>;
  /** Polls a shipment whose creation is still pending. */
  refreshShipment(ref: { externalId: string | null; commandId: string | null }): Promise<ShipmentStatus>;
  getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer>;
  cancelShipment(externalId: string): Promise<void>;
  deliveryStatus?(ref: { trackingNumber: string; externalId: string | null; carrierCode: string | null }): Promise<DeliveryStatus>;
  /** Courier pickups (Allegro Delivery): the windows offered for each shipment, keyed by its external id. */
  pickupProposals?(externalIds: string[], address: PickupAddressInput): Promise<Map<string, PickupSlot[]>>;
  /** Books a pickup; `commandId` is our pickup id, so a retried request can't book twice. */
  createPickup?(commandId: string, externalIds: string[], slot: PickupSlot, address: PickupAddressInput): Promise<PickupStatus>;
  pickupStatus?(commandId: string): Promise<PickupStatus>;
}

export function inpostTrackingUrl(trackingNumber: string): string {
  return `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(trackingNumber)}`;
}
