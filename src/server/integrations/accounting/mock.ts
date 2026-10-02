// Fake ifirma used when INTEGRATIONS_MODE=mock: "issues" invoices and draws a placeholder PDF.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { asciiFold } from '../carriers/mock/adapter';
import type { InvoiceDetails, InvoiceKind, InvoicingAdapter, IssuedInvoice } from './types';

const MOCK_RATES: Record<string, number> = { CZ: 0.21, HU: 0.27, SK: 0.23, DE: 0.19, LT: 0.21 };

export function mockInvoiceNumber(externalId: string): string {
  return `${Number(externalId) % 1000}/MOCK/${new Date().getUTCFullYear()}`;
}

export class MockInvoicingAdapter implements InvoicingAdapter {
  async checkConnection(): Promise<string> {
    return 'ifirma (demo)';
  }

  async create(): Promise<IssuedInvoice> {
    return { externalId: String(Math.floor(100_000 + Math.random() * 900_000)) };
  }

  async getPdf(kind: InvoiceKind, externalId: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(asciiFold(`Faktura ${mockInvoiceNumber(externalId)}`), { x: 50, y: 780, size: 22, font: bold });
    page.drawText(`TEST INVOICE - NOT A REAL DOCUMENT (${kind})`, { x: 50, y: 755, size: 10, font, color: rgb(0.8, 0, 0) });
    return Buffer.from(await doc.save());
  }

  async getDetails(externalId: string): Promise<InvoiceDetails> {
    return { number: mockInvoiceNumber(externalId), ksefStatus: null };
  }

  async sendToKsef(): Promise<void> {}

  async standardVatRate(countryCode: string): Promise<number> {
    return MOCK_RATES[countryCode.toUpperCase()] ?? 0.2;
  }
}
