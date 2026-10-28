// Fake carrier used when INTEGRATIONS_MODE=mock. Creation is "asynchronous"
// (first poll returns pending) so the real polling path gets exercised, and
// labels are real PDF files drawn with pdf-lib.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Carrier, LabelFormat, LabelSize } from '../../types';
import { inpostTrackingUrl, type CarrierAdapter, type CarrierService, type ShipmentRequest, type ShipmentStatus } from '../types';
import { INPOST_SERVICES } from '../inpost/adapter';
import { BUYER_CHOICE } from '../allegro-shipping/adapter';
import { msg } from '@/lib/i18n/msg';

interface MockLabelData {
  carrier: Carrier;
  tracking: string;
  service: string;
  receiver: string[];
  sender: string[];
  point: string | null;
  reference: string;
  cod: string | null;
}

/** Standard PDF fonts only cover Latin-1, so Polish letters are folded to ASCII. */
export function asciiFold(text: string): string {
  return text
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function digitsFrom(seed: string, length: number): string {
  let out = '';
  let h = 2166136261;
  while (out.length < length) {
    for (const ch of seed + out.length) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    out += String((h >>> 0) % 10);
  }
  return out;
}

function encode(data: MockLabelData): string {
  return `MOCK.${Buffer.from(JSON.stringify(data)).toString('base64url')}`;
}

function decode(externalId: string): MockLabelData {
  return JSON.parse(Buffer.from(externalId.replace(/^MOCK\./, ''), 'base64url').toString('utf8')) as MockLabelData;
}

export async function drawLabel(data: MockLabelData, size: LabelSize): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const [width, height] = size === 'A6' ? [297.64, 419.53] : [595.28, 841.89];
  const page = doc.addPage([width, height]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const m = 18;
  let y = height - m - 16;
  const text = (value: string, x: number, size: number, f = font) => page.drawText(asciiFold(value), { x, y, size, font: f });

  text(data.carrier === 'inpost' ? 'InPost' : 'Allegro Delivery', m, 18, bold);
  page.drawText('TEST LABEL - NOT VALID FOR SHIPPING', { x: m, y: y - 14, size: 7, font, color: rgb(0.8, 0, 0) });
  y -= 40;
  text(`Service: ${data.service}`, m, 9);
  y -= 26;

  // Fake barcode derived from the tracking number.
  let x = m;
  for (const ch of data.tracking) {
    const w = 1 + (ch.charCodeAt(0) % 3);
    page.drawRectangle({ x, y: y - 36, width: w, height: 48, color: rgb(0, 0, 0) });
    x += w + 1.6;
    if (x > width - m) break;
  }
  y -= 52;
  text(data.tracking, m, 11, bold);
  y -= 26;

  text('TO:', m, 8, bold);
  y -= 13;
  for (const line of data.receiver) {
    text(line, m, 11, bold);
    y -= 14;
  }
  if (data.point) {
    text(`Parcel locker: ${data.point}`, m, 12, bold);
    y -= 16;
  }
  y -= 8;
  text('FROM:', m, 8, bold);
  y -= 12;
  for (const line of data.sender) {
    text(line, m, 9);
    y -= 12;
  }
  y -= 8;
  text(`Ref: ${data.reference}`, m, 9);
  if (data.cod) {
    y -= 16;
    text(`COD: ${data.cod}`, m, 12, bold);
  }
  return doc;
}

export class MockCarrierAdapter implements CarrierAdapter {
  constructor(readonly carrier: Carrier) {}

  async services(): Promise<CarrierService[]> {
    return this.carrier === 'inpost' ? INPOST_SERVICES : [{ id: BUYER_CHOICE, name: "Buyer's delivery method" }];
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentStatus> {
    if (req.service === 'inpost_locker_standard' && !req.pickupPointId) {
      return { state: 'failed', externalId: '', error: msg('Parcel locker service needs a pickup point (Paczkomat) code') };
    }
    const tracking = this.carrier === 'inpost' ? `6${digitsFrom(req.shipmentId, 23)}` : `A00${digitsFrom(req.shipmentId, 9)}`;
    const r = req.receiver;
    const s = req.sender;
    const externalId = encode({
      carrier: this.carrier,
      tracking,
      service: req.service === BUYER_CHOICE ? req.deliveryMethodId ?? req.service : req.service,
      receiver: [r.name, r.company ?? '', r.street, `${r.postalCode} ${r.city}`, r.phone ?? ''].filter(Boolean),
      sender: [s.company || s.name, s.street, `${s.postalCode} ${s.city}`].filter(Boolean),
      point: req.pickupPointId ?? null,
      reference: req.reference,
      cod: req.codAmount ? `${req.codAmount} ${req.currency}` : null,
    });
    return { state: 'pending', externalId, retryAfterSeconds: 1 };
  }

  async refreshShipment(ref: { externalId: string | null }): Promise<ShipmentStatus> {
    if (!ref.externalId) throw new Error(msg('Mock shipment has no id'));
    const data = decode(ref.externalId);
    return {
      state: 'created',
      externalId: ref.externalId,
      trackingNumber: data.tracking,
      trackingUrl: this.carrier === 'inpost' ? inpostTrackingUrl(data.tracking) : null,
      carrierCode: this.carrier === 'inpost' ? 'INPOST' : 'ALLEGRO',
    };
  }

  async getLabels(externalIds: string[], options: { format: LabelFormat; size: LabelSize }): Promise<Buffer> {
    if (options.format === 'zpl') {
      return Buffer.from(
        externalIds
          .map(decode)
          .map((d) => `^XA^CF0,40^FO30,30^FD${asciiFold(d.carrier)}^FS^FO30,90^BCN,100,Y^FD${d.tracking}^FS^FO30,240^FD${asciiFold(d.receiver[0] ?? '')}^FS^XZ`)
          .join('\n'),
      );
    }
    const merged = await PDFDocument.create();
    for (const id of externalIds) {
      const doc = await drawLabel(decode(id), options.size);
      for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
    }
    return Buffer.from(await merged.save());
  }

  async cancelShipment(): Promise<void> {}

  async deliveryStatus() {
    return 'in_transit' as const;
  }
}
