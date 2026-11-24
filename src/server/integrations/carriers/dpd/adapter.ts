// DPD Polska (DPDServices / DPDInfoServices SOAP web services): parcels to a DPD Pickup point (Empik's "DPD PICKUP"
// and Empik salons) or by courier, labels, the courier pickup call, the handover protocol and tracking events.
import type { CarrierSettings } from '../../../db/schema';
import type { LabelFormat, LabelSize } from '../../types';
import type { CarrierAdapter, CarrierService, DeliveryStatus, PickupAddressInput, PickupSlot, PickupStatus, ShipmentRequest, ShipmentStatus } from '../types';
import { nextWorkingDays } from '@/lib/pickup-slots';
import { blocks, soapCall, SoapError, text, type XmlObject } from './soap';

export interface DpdCredentials {
  login: string;
  password: string;
  /** The master FID of the web-service account. */
  masterFid: string;
  /** The FID parcels are sent and paid from (the "fidy DPDServices"). */
  fid: string;
  /** DPDInfoServices channel; the FID when not given. */
  infoChannel?: string;
}

const SERVICES_URL = 'https://dpdservices.dpd.com.pl/DPDPackageObjServicesService/DPDPackageObjServices';
const SERVICES_NS = 'http://dpdservices.dpd.com.pl/';
const INFO_URL = 'https://dpdinfoservices.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents';
const INFO_NS = 'http://events.dpdinfoservices.dpd.com.pl/';

export const DPD_PICKUP = 'dpd_pickup';
export const DPD_CLASSIC = 'dpd_classic';

export const DPD_SERVICES: CarrierService[] = [
  { id: DPD_PICKUP, name: 'DPD Pickup (point)', requiresPickupPoint: true },
  { id: DPD_CLASSIC, name: 'DPD courier' },
];

export function dpdTrackingUrl(waybill: string): string {
  return `https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=${encodeURIComponent(waybill)}`;
}

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

/** Polish phone numbers as DPD wants them: the last nine digits. */
function phone(value: string | null | undefined): string {
  const d = digits(value);
  return d.length > 9 && d.startsWith('48') ? d.slice(-9) : d;
}

/** DPD's address block: postcode without the dash for Poland. */
function address(a: { name?: string | null; company?: string | null; street: string; city: string; postalCode: string; countryCode: string; phone?: string | null; email?: string | null }, fid?: string) {
  const country = (a.countryCode || 'PL').toUpperCase();
  return {
    address: a.street,
    city: a.city,
    company: a.company || null,
    countryCode: country,
    email: a.email || null,
    fid: fid ? Number(fid) : null,
    name: a.name || a.company || null,
    phone: phone(a.phone) || null,
    postalCode: country === 'PL' ? digits(a.postalCode) : a.postalCode,
  };
}

/** One readable line from DPD's validation answer, e.g. "RECEIVER_PHONE: Niepoprawny numer telefonu". */
function validation(xml: string): string {
  const items = blocks(xml, 'ValidationInfo').map((v) => [text(v, 'FieldNames'), text(v, 'Info') ?? text(v, 'ErrorCode')].filter(Boolean).join(': '));
  return [...new Set(items)].join('; ');
}

export class DpdAdapter implements CarrierAdapter {
  readonly carrier = 'dpd' as const;

  constructor(
    private readonly creds: DpdCredentials,
    private readonly settings: CarrierSettings = {},
  ) {}

  private get auth(): XmlObject {
    return { login: this.creds.login, masterFid: Number(this.creds.masterFid), password: this.creds.password };
  }

  private call(operation: string, body: XmlObject, retries?: number): Promise<string> {
    return soapCall(SERVICES_URL, SERVICES_NS, operation, { ...body, authDataV1: this.auth }, retries === undefined ? {} : { retries });
  }

  async services(): Promise<CarrierService[]> {
    return DPD_SERVICES;
  }

  /** Checks the login without creating anything (DPD looks up a postcode). */
  async checkConnection(): Promise<string> {
    const xml = await this.call('findPostalCodeV1', { postalCodeV1: { countryCode: 'PL', zipCode: '00001' } });
    const status = text(xml, 'status');
    if (status && /AUTH|DENIED|LOGIN|PASSWORD/i.test(status)) throw new SoapError(`DPD refused the login (${status})`);
    return `DPD: FID ${this.creds.fid}`;
  }

  /** Registers the parcel and gets its waybill at once (DPD answers synchronously). */
  async createShipment(req: ShipmentRequest): Promise<ShipmentStatus> {
    const pickup = req.service === DPD_PICKUP;
    const point = req.pickupPointId?.trim().toUpperCase() || null;
    if (pickup && !point) return { state: 'failed', externalId: '', error: 'DPD Pickup needs the point code (e.g. PL19262)' };
    if (pickup && (!phone(req.receiver.phone) || !req.receiver.email)) {
      return { state: 'failed', externalId: '', error: 'DPD Pickup needs the buyer’s phone and e-mail' };
    }
    const cod = req.codAmount && Number(req.codAmount) > 0 ? { amount: Number(req.codAmount).toFixed(2), currency: req.currency || 'PLN' } : null;
    const body: XmlObject = {
      openUMLFeV15: {
        packages: [
          {
            parcels: [
              {
                reference: req.shipmentId.slice(0, 50),
                weight: Math.max(0.1, req.parcel.weightKg).toFixed(2),
                sizeX: Math.round(req.parcel.lengthCm) || null,
                sizeY: Math.round(req.parcel.widthCm) || null,
                sizeZ: Math.round(req.parcel.heightCm) || null,
                content: req.reference.slice(0, 300),
              },
            ],
            payerType: 'SENDER',
            receiver: address({ ...req.receiver, phone: req.receiver.phone, email: req.receiver.email }),
            ref1: req.reference.slice(0, 100),
            reference: req.shipmentId.slice(0, 100),
            sender: address(req.sender, this.creds.fid),
            services: {
              cod,
              dpdPickup: pickup ? { pudo: point } : null,
            },
          },
        ],
      },
      pkgNumsGenerationPolicyV1: 'ALL_OR_NOTHING',
      langCode: 'PL',
    };
    // No retry: a repeated request would register a second parcel.
    const xml = await this.call('generatePackagesNumbersV12', body, 0);
    const waybill = text(xml, 'Waybill');
    const status = text(xml, 'Status');
    if (!waybill || (status && status !== 'OK')) {
      return { state: 'failed', externalId: '', error: `DPD refused the parcel${status ? ` (${status})` : ''}: ${validation(xml) || 'no details'}` };
    }
    return { state: 'created', externalId: waybill, trackingNumber: waybill, trackingUrl: dpdTrackingUrl(waybill), carrierCode: 'DPD' };
  }

  async refreshShipment(ref: { externalId: string | null }): Promise<ShipmentStatus> {
    // Creation is synchronous; a shipment with a waybill is created.
    if (!ref.externalId) return { state: 'failed', externalId: '', error: 'DPD gave no waybill' };
    return { state: 'created', externalId: ref.externalId, trackingNumber: ref.externalId, trackingUrl: dpdTrackingUrl(ref.externalId), carrierCode: 'DPD' };
  }

  private session(waybills: string[]): XmlObject {
    return { packages: [{ parcels: waybills.map((waybill) => ({ waybill })) }], sessionType: 'DOMESTIC' };
  }

  async getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer> {
    const xml = await this.call('generateSpedLabelsV4', {
      dpdServicesParamsV1: { policy: 'IGNORE_ERRORS', session: this.session(externalIds) },
      outputDocFormatV1: options.format === 'zpl' ? 'ZPL' : 'PDF',
      outputDocPageFormatV1: options.size === 'A4' ? 'A4' : 'LBL_PRINTER',
      outputLabelType: 'BIC3',
    });
    return this.document(xml, 'label');
  }

  /** The handover protocol the courier signs, for these waybills. */
  async protocol(waybills: string[]): Promise<Buffer> {
    const xml = await this.call('generateProtocolV2', {
      dpdServicesParamsV1: { pickupAddress: { fid: Number(this.creds.fid) }, policy: 'IGNORE_ERRORS', session: this.session(waybills) },
      outputDocFormatV1: 'PDF',
      outputDocPageFormatV1: 'A4',
    });
    return this.document(xml, 'protocol');
  }

  private document(xml: string, what: string): Buffer {
    const data = text(xml, 'documentData');
    if (!data) {
      const statuses = blocks(xml, 'statusInfo').map((s) => [text(s, 'status'), text(s, 'description')].filter(Boolean).join(' ')).filter((s) => s && !s.startsWith('OK'));
      throw new SoapError(`DPD gave no ${what}${statuses.length ? `: ${[...new Set(statuses)].join('; ')}` : ''}`);
    }
    return Buffer.from(data.replace(/\s+/g, ''), 'base64');
  }

  /** DPD can't cancel a parcel through this API; one never handed over is simply not charged. */
  async cancelShipment(): Promise<void> {}

  async deliveryStatus(ref: { trackingNumber: string }): Promise<DeliveryStatus> {
    const xml = await soapCall(INFO_URL, INFO_NS, 'getEventsForWaybillV1', {
      waybill: ref.trackingNumber,
      eventsSelectType: 'ONLY_LAST',
      language: 'PL',
      authDataV1: { channel: this.creds.infoChannel || this.creds.fid, login: this.creds.login, password: this.creds.password },
    });
    const events = blocks(xml, 'eventsList');
    const last = events.at(-1);
    return last ? dpdDeliveryStatus(text(last, 'description') ?? '', text(last, 'businessCode') ?? '') : 'unknown';
  }

  /** The windows DPD's courier comes in, for the sender's postcode: the same for every parcel. */
  async pickupProposals(externalIds: string[], at: PickupAddressInput): Promise<Map<string, PickupSlot[]>> {
    const xml = await this.call('getCourierOrderAvailabilityV1', { senderPlaceV1: { countryCode: (at.countryCode || 'PL').toUpperCase(), zipCode: digits(at.postalCode) } });
    const ranges = blocks(xml, 'ranges')
      .map((r) => /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(text(r, 'range') ?? ''))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ minTime: m[1].padStart(5, '0'), maxTime: m[2].padStart(5, '0') }));
    const days = nextWorkingDays(new Date(), 3, true);
    const slots: PickupSlot[] = days.flatMap((date) => ranges.map((r) => ({ date, ...r })));
    return new Map(externalIds.map((id) => [id, slots]));
  }

  /** Orders the courier (DPD answers at once with its order number). */
  async createPickup(_commandId: string, externalIds: string[], slot: PickupSlot, at: PickupAddressInput): Promise<PickupStatus> {
    const name = at.company || at.name || 'Nadawca';
    const count = externalIds.length;
    const xml = await this.call(
      'packagesPickupCallV4',
      {
        dpdPickupParamsV3: {
          operationType: 'INSERT',
          orderType: 'DOMESTIC',
          pickupCallSimplifiedDetails: {
            packagesParams: {
              dox: false,
              doxCount: 0,
              pallet: false,
              palletMaxHeight: 0,
              palletMaxWeight: 0,
              palletsCount: 0,
              palletsWeight: 0,
              // Cosmetics parcels: small and light; DPD uses these to plan the van.
              parcelMaxDepth: 40,
              parcelMaxHeight: 30,
              parcelMaxWeight: 5,
              parcelMaxWidth: 40,
              parcelsCount: count,
              parcelsWeight: count,
              standardParcel: true,
            },
            pickupCustomer: { customerFullName: name, customerName: (at.name || name).slice(0, 100), customerPhone: phone(at.phone) },
            pickupPayer: { payerName: name, payerNumber: Number(this.creds.fid) },
            pickupSender: { senderAddress: at.street, senderCity: at.city, senderFullName: name, senderName: (at.name || name).slice(0, 100), senderPhone: phone(at.phone), senderPostalCode: digits(at.postalCode) },
          },
          pickupDate: slot.date,
          pickupTimeFrom: slot.minTime ?? '10:00',
          pickupTimeTo: slot.maxTime ?? '16:00',
          // No updateMode: the WSDL lists it, but DPD's validator refuses it on a new order (it is for changing one).
          waybillsReady: true,
        },
      },
      0,
    );
    const status = text(xml, 'status');
    const orderNumber = text(xml, 'orderNumber');
    if (orderNumber && (!status || status === 'OK')) return { state: 'booked', pickupId: orderNumber, carrierPickupId: orderNumber };
    const errors = blocks(xml, 'errorDetails').map((e) => [text(e, 'fields'), text(e, 'description') ?? text(e, 'code')].filter(Boolean).join(': '));
    return { state: 'failed', error: `DPD refused the pickup${status ? ` (${status})` : ''}: ${errors.join('; ') || 'no details'}` };
  }

  /** The pickup is confirmed when it is ordered, so there is nothing to wait for. */
  async pickupStatus(): Promise<PickupStatus> {
    return { state: 'booked' };
  }
}

/** DPD's last event as our delivery status, by its Polish description (business codes vary by depot). */
export function dpdDeliveryStatus(description: string, businessCode = ''): DeliveryStatus {
  const d = description.toLowerCase();
  if (/zwrot|return/.test(d)) return 'returned';
  // "Przesyłka odebrana przez Kuriera" is the courier collecting it from us, not delivery.
  if (/doręczon|doreczon|wydan[ao] odbiorcy|odebran[ao] przez odbiorc|odebran[ao] w punkcie|delivered/.test(d) || businessCode === '190101') return 'delivered';
  if (/do odbioru|gotowa do odbioru|w punkcie|pickup point|ready/.test(d)) return 'ready_for_pickup';
  return d ? 'in_transit' : 'unknown';
}
