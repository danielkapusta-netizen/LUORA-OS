import type { MarketplaceSettings, MiraklOfferField } from '../../../db/schema';

/** Shopify product metafields ("namespace.key") the account's offer fields are read from. */
export function offerFieldMetafieldKeys(settings: MarketplaceSettings): string[] {
  const keys = Object.values(settings.offerFieldSources ?? {}).map((s) => s.metafield?.trim());
  return [...new Set(keys.filter((k): k is string => Boolean(k)))];
}

export interface ResolvedOfferFields {
  /** Value to send per field code. */
  values: Record<string, string>;
  /** Why this product can't be sent yet, e.g. "no Osoba odpowiedzialna". */
  problems: string[];
}

/**
 * The extra offer fields for one product: the Shopify metafield if the product has it filled in, else the
 * fixed text from the account settings, else the marketplace's own default. A required field with no value
 * is a problem; so is a value a LIST field does not accept.
 */
export function resolveOfferFields(settings: MarketplaceSettings, metafields: Record<string, string> = {}): ResolvedOfferFields {
  const out: ResolvedOfferFields = { values: {}, problems: [] };
  for (const field of settings.offerFieldCache?.fields ?? []) {
    const source = settings.offerFieldSources?.[field.code];
    const value =
      (source?.metafield ? metafields[source.metafield.trim()]?.trim() : '') || source?.fallback?.trim() || field.defaultValue?.trim() || '';
    if (!value) {
      if (field.required) out.problems.push(`no ${field.label}`);
      continue;
    }
    if (field.acceptedValues && !field.acceptedValues.includes(value)) {
      out.problems.push(`${field.label} "${value}" is not accepted`);
      continue;
    }
    out.values[field.code] = value;
  }
  return out;
}

/** Required fields that no product could fill: no metafield, no fixed text, no default. Shown before anything is sent. */
export function unsourcedRequiredFields(settings: MarketplaceSettings): MiraklOfferField[] {
  return (settings.offerFieldCache?.fields ?? []).filter((f) => {
    const source = settings.offerFieldSources?.[f.code];
    return f.required && !f.defaultValue && !source?.metafield?.trim() && !source?.fallback?.trim();
  });
}
