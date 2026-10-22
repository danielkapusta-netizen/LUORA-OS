import type { MarketplaceSettings } from '../../../db/schema';
import { MiraklAdapter, type MiraklMarketplace } from '../mirakl/adapter';
import type { MiraklCredentials } from '../mirakl/client';

/**
 * HEBE Marketplace runs on Mirakl, like Empik: the same Seller API (OR11 orders, OR21 accept,
 * OR23/OR24 tracking and shipment, OR74 invoices, OF01/OF21/STO01 offers, prices and stock, SH21
 * carriers, P31 catalogue). HEBE publishes no carrier coding of its own, so carriers are always
 * looked up in its SH21 list (by code, label, or the carrier's own name), and the order fields
 * HEBE uses for the buyer's tax number and Paczkomat are matched by name.
 */
export const HEBE: MiraklMarketplace = {
  marketplace: 'hebe',
  label: 'HEBE',
  taxIdField: /nip|vat|tax/i,
  pickupPointField: /paczkomat|locker|pudo|delivery-point|pickup-point/i,
  documentedCarrierCode: () => null,
  matchCarrierByName: true,
};

export class HebeAdapter extends MiraklAdapter {
  constructor(creds: MiraklCredentials, settings: MarketplaceSettings = {}, saveSettings?: (next: MarketplaceSettings) => Promise<void>) {
    super(HEBE, creds, settings, saveSettings);
  }
}
