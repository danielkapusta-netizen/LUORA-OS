// Some Allegro Delivery services (Packeta / ORLEN Paczka abroad) refuse a parcel without
// insurance. These helpers decide when Luora adds it on its own.

/** The Packeta services sold through Allegro: "… Packeta, ORLEN Paczka". */
export function isPacketaMethod(name: string | null | undefined): boolean {
  return /packeta|orlen\s*paczka/i.test(name ?? '');
}

/** The error Allegro returns for a label sent without the insurance a service requires. */
export function isInsuranceRequiredError(message: string | null | undefined): boolean {
  const text = message ?? '';
  if (/insurance/i.test(text) && /wymagane|required/i.test(text)) return true;
  // Cash on delivery abroad: "Invalid Insurance amount, must be greater or equal to COD amount".
  return /insurance/i.test(text) && /COD|pobrania/i.test(text);
}

/** What to insure the parcel for: what the buyer paid, in the order's currency. */
export function declaredValue(order: { totalAmount: string; codAmount?: string | null }): string {
  // Allegro wants the insurance to be at least the cash-on-delivery amount.
  return Math.max(Number(order.totalAmount), Number(order.codAmount ?? 0)).toFixed(2);
}

/** The delivery method a label is bought for: the buyer's, unless staff picked another service. */
export function deliveryMethodOf(service: string, order: { deliveryMethodId: string | null }): string | null {
  return service === 'buyer_choice' ? order.deliveryMethodId : service;
}
