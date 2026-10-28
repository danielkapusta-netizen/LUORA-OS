// Picks a carrier, service and parcel size for an order from the shipping rules.
// Pure functions so the rules are easy to test.
import type { RuleConditions } from '../db/schema';
import type { Marketplace } from '../integrations/types';
import { createT, type T } from '@/lib/i18n/translate';

export interface RoutableOrder {
  accountId: string;
  marketplace: Marketplace;
  deliveryMethodName: string | null;
  pickupPointId: string | null;
  codAmount: string | null;
}

export interface RuleLike {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  carrierAccountId: string;
  service: string;
  packagePresetId: string | null;
}

export interface CarrierLike {
  id: string;
  type: 'inpost' | 'allegro_shipping';
  enabled: boolean;
  /** Has working credentials (always true in demo mode). */
  configured: boolean;
  /** Allegro Delivery: the Allegro account whose connection it uses. */
  marketplaceAccountId: string | null;
}

export interface RouteDecision {
  ruleId: string;
  ruleName: string;
  carrierAccountId: string;
  service: string;
  packagePresetId: string | null;
}

export function matchesRule(order: RoutableOrder, conditions: RuleConditions): boolean {
  if (conditions.marketplaces?.length && !conditions.marketplaces.includes(order.marketplace)) return false;
  if (conditions.deliveryMethodContains) {
    const needle = conditions.deliveryMethodContains.toLowerCase();
    if (!(order.deliveryMethodName ?? '').toLowerCase().includes(needle)) return false;
  }
  if (conditions.hasPickupPoint !== undefined && conditions.hasPickupPoint !== Boolean(order.pickupPointId)) return false;
  if (conditions.cod !== undefined && conditions.cod !== (Number(order.codAmount ?? 0) > 0)) return false;
  return true;
}

/**
 * A carrier can ship an order when it has credentials and, for Allegro Delivery,
 * when it uses the same Allegro account the order was bought on.
 */
export function carrierSupportsOrder(carrier: CarrierLike, order: RoutableOrder): boolean {
  if (!carrier.configured) return false;
  if (carrier.type === 'allegro_shipping') return order.marketplace === 'allegro' && carrier.marketplaceAccountId === order.accountId;
  return true;
}

export function chooseRoute(order: RoutableOrder, rules: RuleLike[], carriers: CarrierLike[]): RouteDecision | null {
  const byId = new Map(carriers.map((c) => [c.id, c]));
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const rule of sorted) {
    if (!rule.enabled) continue;
    const carrier = byId.get(rule.carrierAccountId);
    if (!carrier?.enabled || !carrierSupportsOrder(carrier, order)) continue;
    if (!matchesRule(order, rule.conditions)) continue;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      carrierAccountId: rule.carrierAccountId,
      service: rule.service,
      packagePresetId: rule.packagePresetId,
    };
  }
  return null;
}

/** A rule's conditions in words. Pass a translator to read them in the person's language. */
export function describeConditions(c: RuleConditions, t: T = createT('en')): string {
  const parts: string[] = [];
  if (c.marketplaces?.length) parts.push(t('marketplace is {names}', { names: c.marketplaces.join(t(' or ')) }));
  if (c.deliveryMethodContains) parts.push(t('delivery method contains "{text}"', { text: c.deliveryMethodContains }));
  if (c.hasPickupPoint !== undefined) parts.push(c.hasPickupPoint ? t('has a pickup point') : t('has no pickup point'));
  if (c.cod !== undefined) parts.push(c.cod ? t('is cash on delivery') : t('is prepaid'));
  return parts.length ? parts.join(', ') : t('every order');
}
