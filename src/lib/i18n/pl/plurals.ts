/** Polish has four plural categories. `other` is used for fractions. */
export type PluralForms = { one: string; few: string; many: string; other: string };

/** Keyed by the English singular passed to `t.plural`. */
export const PL_PLURALS_ALL: Record<string, PluralForms> = {};
