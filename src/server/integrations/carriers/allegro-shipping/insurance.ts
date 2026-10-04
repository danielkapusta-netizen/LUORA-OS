// Some Allegro Delivery services (Packeta / ORLEN Paczka abroad) refuse a parcel without
// insurance. These helpers decide when Luora adds it on its own.

/** The Packeta services sold through Allegro: "… Packeta, ORLEN Paczka". */
export function isPacketaMethod(name: string | null | undefined): boolean {
  return /packeta|orlen\s*paczka/i.test(name ?? '');
}

/** The error Allegro returns for a label sent without the insurance a service requires. */
export function isInsuranceRequiredError(message: string | null | undefined): boolean {
  const text = message ?? '';
  return /insurance/i.test(text) && /wymagane|required/i.test(text);
}

/** What to insure the parcel for: what the buyer paid, in the order's currency. */
export function declaredValue(order: { totalAmount: string }): string {
  return Number(order.totalAmount).toFixed(2);
}

/** The delivery method a label is bought for: the buyer's, unless staff picked another service. */
export function deliveryMethodOf(service: string, order: { deliveryMethodId: string | null }): string | null {
  return service === 'buyer_choice' ? order.deliveryMethodId : service;
}
