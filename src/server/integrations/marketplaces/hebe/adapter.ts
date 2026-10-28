import type { MarketplaceSettings } from '../../../db/schema';
import type { TrackingInfo } from '../../types';
import { MiraklAdapter, type MiraklMarketplace } from '../mirakl/adapter';
import type { MiraklCredentials } from '../mirakl/client';

/** HEBE's carrier codes (its SH21 list), by the carrier id Allegro Delivery reports. HEBE has one InPost carrier for lockers and couriers alike. */
const BY_CARRIER_ID: Record<string, string> = {
  INPOST: 'inpost-pl',
  DPD: 'dpd-pl',
  DHL: 'dhl-pl',
  FEDEX: 'fedex-pl',
  GLS: 'gls',
  UPS: 'ups',
  POCZTA_POLSKA: 'pl-post',
  POCZTEX: 'pl-post',
};

function hebeCarrierCode(tracking: TrackingInfo): string | null {
  const id = tracking.carrier === 'inpost' ? 'INPOST' : (tracking.carrierCode?.toUpperCase() ?? '');
  return BY_CARRIER_ID[id] ?? null;
}

/**
 * HEBE Marketplace runs on Mirakl, like Empik: the same Seller API (OR11 orders, OR21 accept,
 * OR23/OR24 tracking and shipment, OR74 invoices, OF01/OF21/STO01 offers, prices and stock, SH21
 * carriers, P31 catalogue). Carriers are looked up in HEBE's SH21 list (by code, label, or the
 * carrier's own name) and the order fields HEBE uses for the buyer's tax number and Paczkomat are
 * matched by name.
 */
export const HEBE: MiraklMarketplace = {
  marketplace: 'hebe',
  label: 'HEBE',
  taxIdField: /nip|vat|tax/i,
  pickupPointField: /paczkomat|locker|pudo|delivery-point|pickup-point/i,
  documentedCarrierCode: hebeCarrierCode,
  matchCarrierByName: true,
};

export class HebeAdapter extends MiraklAdapter {
  constructor(creds: MiraklCredentials, settings: MarketplaceSettings = {}, saveSettings?: (next: MarketplaceSettings) => Promise<void>) {
    super(HEBE, creds, settings, saveSettings);
  }
}
