import { PL_PLURALS_ALL, type PluralForms } from './plurals';
import { accounting } from './accounting';
import { analytics } from './analytics';
import { customers } from './customers';
import { dashboard } from './dashboard';
import { inventory } from './inventory';
import { pricingResearch } from './pricing-research';
import { orders } from './orders';
import { settings_a } from './settings-a';
import { settings_b } from './settings-b';
import { shared } from './shared';
import { tasks } from './tasks';
import { weekdays } from './weekdays';
import { SAME_LIST } from './same';

/**
 * Polish translations, keyed by the English source text used in the code: `t('Orders')` looks up `PL['Orders']`.
 * Split by area so each file stays reviewable; `scripts/check-i18n.ts` (and `tests/i18n.test.ts`) fail when a
 * string used in the code has no entry here.
 */
export const PL: Record<string, string> = {
  ...accounting,
  ...analytics,
  ...customers,
  ...dashboard,
  ...inventory,
  ...pricingResearch,
  ...orders,
  ...settings_a,
  ...settings_b,
  ...shared,
  ...tasks,
  ...weekdays,
};

/** Strings that read the same in Polish (brand names, abbreviations, units). Listing them tells the checker they were considered. */
export const SAME: ReadonlySet<string> = new Set<string>(SAME_LIST);

export const PL_PLURALS: Record<string, PluralForms> = PL_PLURALS_ALL;

export type { PluralForms };
