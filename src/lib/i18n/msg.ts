/**
 * Marks an English string that is declared away from where it is shown (a label table, a column list) so it can be
 * translated later with `t(label)`. It returns the text unchanged; the point is that `scripts/check-i18n.ts` finds
 * every `msg('...')` and checks it has a Polish entry.
 */
export const msg = <S extends string>(text: S): S => text;
