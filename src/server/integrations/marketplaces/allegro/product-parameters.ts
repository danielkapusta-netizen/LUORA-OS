// The parameters a new Allegro product (one the catalogue doesn't know yet) and its offer need, filled from the
// Shopify product: EAN from the barcode, brand from the vendor, condition "Nowy", and everything else from the
// Shopify metafield or fixed value chosen per parameter name. Pure, so the preview and the offer always agree.
import { sourceMetafieldKeys } from '../mirakl/offer-fields';

/** An Allegro category parameter, trimmed to what filling it needs. */
export interface AllegroCategoryParameter {
  id: string;
  name: string;
  type: 'dictionary' | 'string' | 'integer' | 'float';
  unit: string | null;
  /** Required on the offer. */
  required: boolean;
  /** Required on the product (a new product can't be proposed without it). */
  requiredForProduct: boolean;
  /** Describes the product (goes on the product), rather than the offer. */
  describesProduct: boolean;
  dictionary?: { id: string; value: string }[];
  ambiguousValueId?: string | null;
  customValuesEnabled?: boolean;
  /** A dictionary parameter that takes several values. */
  multipleChoices?: boolean;
  min?: number;
  max?: number;
  /** A range parameter needs "from" and "to"; those are not filled automatically. */
  range?: boolean;
}

/** Where a parameter's value comes from, by parameter name: a Shopify product metafield, else a fixed value. */
export type ParameterSources = Record<string, { metafield?: string; fallback?: string }>;

export interface ParameterValue {
  id: string;
  values?: string[];
  valuesIds?: string[];
}

export interface FilledParameters {
  productParameters: ParameterValue[];
  offerParameters: ParameterValue[];
  /** Required parameters nothing fills, by name. */
  missing: string[];
  /** Values the parameter does not accept, as "Pojemność \"abc\" is not accepted". */
  invalid: string[];
}

export const EAN_PARAMETER_ID = '225693';
const isEan = (p: AllegroCategoryParameter) => p.id === EAN_PARAMETER_ID || /^ean\b/i.test(p.name);
const isBrand = (p: AllegroCategoryParameter) => /^(marka|brand)$/i.test(p.name.trim());
const isCondition = (p: AllegroCategoryParameter) => /^(stan|condition)$/i.test(p.name.trim());

function normalise(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
}

/** The value of a source for this product: the metafield when filled in, else the fixed value. */
function sourceValue(source: ParameterSources[string] | undefined, metafields: Record<string, string>): string {
  const keys = sourceMetafieldKeys(source?.metafield);
  const values = keys.map((k) => metafields[k]?.trim() ?? '');
  const fromMeta = keys.length > 0 && values.every(Boolean) ? values.join(', ') : '';
  return fromMeta || source?.fallback?.trim() || '';
}

/** Shopify metafields the sources read. */
export function parameterMetafieldKeys(sources: ParameterSources | undefined): string[] {
  return [...new Set(Object.values(sources ?? {}).flatMap((s) => sourceMetafieldKeys(s.metafield)))];
}

/** "50 ml", "50,5" or "1 234" as a number; null when the text holds none. */
export function parseNumber(text: string): number | null {
  const match = /-?\d[\d\s]*(?:[.,]\d+)?/.exec(text.replace(/ /g, ' '));
  if (!match) return null;
  const n = Number(match[0].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

type Fill = { ok: true; value: ParameterValue } | { ok: false; problem: string };

/** One parameter set to a text, as its type needs. */
export function fillParameter(p: AllegroCategoryParameter, text: string): Fill {
  const value = text.trim();
  if (p.type === 'dictionary') {
    const wanted = value.split(/\s*[;|]\s*/).filter(Boolean);
    const ids: string[] = [];
    for (const w of wanted) {
      const hit = p.dictionary?.find((d) => normalise(d.value) === normalise(w) || d.id === w);
      if (hit) ids.push(hit.id);
      else if (p.ambiguousValueId && p.customValuesEnabled) return { ok: true, value: { id: p.id, valuesIds: [p.ambiguousValueId], values: [value] } };
      else return { ok: false, problem: `${p.name} "${w}" is not accepted` };
    }
    return ids.length ? { ok: true, value: { id: p.id, valuesIds: p.multipleChoices ? ids : ids.slice(0, 1) } } : { ok: false, problem: `no ${p.name}` };
  }
  if (p.type === 'integer' || p.type === 'float') {
    let n = parseNumber(value);
    if (n === null) return { ok: false, problem: `${p.name} "${value}" is not a number` };
    if (p.type === 'integer') n = Math.round(n);
    if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) return { ok: false, problem: `${p.name} ${n} is outside ${p.min ?? '…'}–${p.max ?? '…'}` };
    return { ok: true, value: { id: p.id, values: [String(n)] } };
  }
  return { ok: true, value: { id: p.id, values: [value] } };
}

/**
 * Fills a category's parameters for one product. Required ones that nothing fills are `missing`; values a parameter
 * refuses are `invalid`. Optional parameters are only sent when a source is set up for them.
 */
export function productParameters(
  params: AllegroCategoryParameter[],
  product: { ean: string; brand: string; metafields: Record<string, string> },
  sources: ParameterSources = {},
): FilledParameters {
  const out: FilledParameters = { productParameters: [], offerParameters: [], missing: [], invalid: [] };
  for (const p of params) {
    const needed = p.requiredForProduct || (p.required && !p.describesProduct);
    let text = sourceValue(sources[p.name], product.metafields);
    if (!text && isEan(p)) text = product.ean;
    if (!text && isBrand(p)) text = product.brand.trim();
    if (!text && isCondition(p) && p.dictionary?.some((d) => normalise(d.value) === 'nowy' || normalise(d.value) === 'new')) {
      text = p.dictionary.find((d) => normalise(d.value) === 'nowy' || normalise(d.value) === 'new')!.value;
    }
    if (!text || p.range) {
      if (needed) out.missing.push(p.name);
      continue;
    }
    const filled = fillParameter(p, text);
    if (!filled.ok) {
      // A value an optional parameter refuses is left out rather than blocking the product.
      if (needed) out.invalid.push(filled.problem);
      continue;
    }
    (p.describesProduct || p.requiredForProduct || isEan(p) ? out.productParameters : out.offerParameters).push(filled.value);
  }
  return out;
}

/** "Kosmetyki > Pielęgnacja > Kremy" from Allegro's suggestion with its parents. */
export function categoryPath(node: { name: string; parent?: unknown } | null | undefined): string {
  const names: string[] = [];
  let n = node as { name: string; parent?: unknown } | null | undefined;
  while (n && names.length < 10) {
    names.unshift(n.name);
    n = n.parent as typeof n;
  }
  return names.join(' > ');
}
