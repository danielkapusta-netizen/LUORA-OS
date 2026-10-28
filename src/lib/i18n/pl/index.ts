import { PL_PLURALS_ALL, type PluralForms } from './plurals';

/**
 * Polish translations, keyed by the English source text used in the code: `t('Orders')` looks up `PL['Orders']`.
 * Split by area so each file stays reviewable; `scripts/check-i18n.ts` (and `tests/i18n.test.ts`) fail when a
 * string used in the code has no entry here.
 */
export const PL: Record<string, string> = {};

export const PL_PLURALS: Record<string, PluralForms> = PL_PLURALS_ALL;

export type { PluralForms };
