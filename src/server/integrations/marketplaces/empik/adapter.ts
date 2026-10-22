import type { MarketplaceSettings } from '../../../db/schema';
import type { TrackingInfo } from '../../types';
import { MiraklAdapter, resolveMiraklCarrier, type MiraklMarketplace } from '../mirakl/adapter';
import type { MiraklCredentials } from '../mirakl/client';
import { EMPIK_PROFILE } from '../mirakl/mapper';

/**
 * Empik's registered carrier codes (EmpikPlace help: "Kodowanie przewoźników").
 * Empik needs `carrier_code` from this list; a free-text carrier name is not accepted.
 */
export const EMPIK_CARRIER_CODES = {
  inpostLocker: 'paczkomatyinpost',
  inpostCourier: 'inpostpaczkakurierska',
  dpd: 'dpd',
  dhl: 'dhl',
  ups: 'ups',
  gls: 'gls',
  fedex: 'fedex',
  pocztex: 'pocztex',
  orlen: 'ORLEN',
} as const;

/** Carrier ids reported by Allegro Delivery → Empik code. */
const BY_CARRIER_ID: Record<string, string> = {
  DPD: EMPIK_CARRIER_CODES.dpd,
  DHL: EMPIK_CARRIER_CODES.dhl,
  UPS: EMPIK_CARRIER_CODES.ups,
  GLS: EMPIK_CARRIER_CODES.gls,
  FEDEX: EMPIK_CARRIER_CODES.fedex,
  POCZTA_POLSKA: EMPIK_CARRIER_CODES.pocztex,
  POCZTEX: EMPIK_CARRIER_CODES.pocztex,
  ORLEN: EMPIK_CARRIER_CODES.orlen,
  ORLEN_PACZKA: EMPIK_CARRIER_CODES.orlen,
};

/** Empik's carrier lookup is the shared Mirakl one. */
export const resolveEmpikCarrier = resolveMiraklCarrier;

/** Picks Empik's carrier code for a shipment; null when Empik has no code for it. */
export function empikCarrierCode(tracking: TrackingInfo): string | null {
  if (tracking.carrier === 'inpost') {
    return tracking.service === 'inpost_courier_standard' ? EMPIK_CARRIER_CODES.inpostCourier : EMPIK_CARRIER_CODES.inpostLocker;
  }
  const id = tracking.carrierCode?.toUpperCase() ?? '';
  if (id === 'INPOST') return tracking.service?.includes('courier') ? EMPIK_CARRIER_CODES.inpostCourier : EMPIK_CARRIER_CODES.inpostLocker;
  return BY_CARRIER_ID[id] ?? null;
}

export const EMPIK: MiraklMarketplace = {
  ...EMPIK_PROFILE,
  marketplace: 'empik',
  documentedCarrierCode: empikCarrierCode,
  matchCarrierByName: false,
};

/** Empik Marketplace runs on Mirakl. */
export class EmpikAdapter extends MiraklAdapter {
  constructor(creds: MiraklCredentials, settings: MarketplaceSettings = {}, saveSettings?: (next: MarketplaceSettings) => Promise<void>) {
    super(EMPIK, creds, settings, saveSettings);
  }
}
