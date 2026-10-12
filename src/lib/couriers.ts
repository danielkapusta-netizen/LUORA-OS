/** Which courier a buyer's delivery method means, for "how many parcels go with whom". */
export const COURIERS = ['InPost', 'DPD', 'DHL', 'ORLEN Paczka', 'Packeta', 'Poczta Polska', 'Other'] as const;
export type Courier = (typeof COURIERS)[number];

const RULES: [RegExp, Courier][] = [
  [/inpost|paczkomat/i, 'InPost'],
  [/\bdpd\b/i, 'DPD'],
  [/\bdhl\b/i, 'DHL'],
  [/packeta/i, 'Packeta'],
  [/orlen/i, 'ORLEN Paczka'],
  [/poczt/i, 'Poczta Polska'],
];

/**
 * `deliveryMethodName` is what the buyer chose ("Allegro One Box, DPD", "Paczkomaty InPost", "KURIER").
 * A plain "Kurier" names no courier, so the carrier of the shipment already created takes over.
 */
export function courierOf(deliveryMethodName: string | null | undefined, shipmentCarrier?: string | null): Courier {
  const name = deliveryMethodName ?? '';
  for (const [pattern, courier] of RULES) if (pattern.test(name)) return courier;
  if (shipmentCarrier === 'inpost') return 'InPost';
  return 'Other';
}
