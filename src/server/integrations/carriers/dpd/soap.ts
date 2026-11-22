// A minimal SOAP client for DPD Polska's web services: builds the envelope from plain objects and reads the
// flat answers back. Workers have no DOMParser, and DPD's answers are simple enough for a tag reader.
import { HttpError, request } from '../../../http';

export type XmlValue = string | number | boolean | null | undefined | XmlObject | XmlValue[];
export interface XmlObject {
  [key: string]: XmlValue;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Child elements in key order; arrays repeat the element; null and undefined are left out. */
export function toXml(value: XmlObject): string {
  let out = '';
  for (const [key, v] of Object.entries(value)) {
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === null || item === undefined) continue;
      out += typeof item === 'object' ? `<${key}>${toXml(item as XmlObject)}</${key}>` : `<${key}>${escapeXml(String(item))}</${key}>`;
    }
  }
  return out;
}

export function envelope(namespace: string, operation: string, body: XmlObject): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${namespace}">` +
    `<soapenv:Header/><soapenv:Body><ns:${operation}>${toXml(body)}</ns:${operation}></soapenv:Body></soapenv:Envelope>`
  );
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Every element with this (local) name, as raw inner XML. */
export function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** The text of the first element with this name, or null. */
export function text(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${tag}>`);
  const m = re.exec(xml);
  return m ? unescapeXml(m[1]).trim() : null;
}

export class SoapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoapError';
  }
}

/** Posts the envelope and returns the answer's XML; a SOAP fault becomes a readable error. */
export async function soapCall(url: string, namespace: string, operation: string, body: XmlObject, options: { retries?: number } = {}): Promise<string> {
  try {
    const { data } = await request<string>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', Accept: 'text/xml' },
      body: envelope(namespace, operation, body),
      responseType: 'text',
      timeoutMs: 45_000,
      ...(options.retries !== undefined ? { retries: options.retries } : {}),
    });
    return data;
  } catch (err) {
    if (err instanceof HttpError) {
      const fault = text(err.body, 'faultstring') ?? text(err.body, 'message');
      throw new SoapError(`DPD ${operation}: ${fault ?? `HTTP ${err.status}`}`);
    }
    throw err;
  }
}
