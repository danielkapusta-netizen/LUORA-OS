import { DEFAULT_LOCALE, type Locale } from './locales';
import { PL, PL_PLURALS } from './pl';

/** Values that fill `{name}` placeholders. */
export type Vars = Record<string, string | number>;

export type T = {
  /** Translates an English source string. Unknown strings fall back to the English text, so a missing translation never breaks a page. */
  (text: string, vars?: Vars): string;
  /** Picks the right plural form: `t.plural(n, '{n} order', '{n} orders')`. `{n}` is filled with the count. */
  plural(count: number, one: string, other: string, vars?: Vars): string;
  locale: Locale;
};

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

export function createT(locale: Locale = DEFAULT_LOCALE): T {
  const rules = new Intl.PluralRules(locale === 'pl' ? 'pl-PL' : 'en-GB');
  const t = ((text: string, vars?: Vars) => fill(locale === 'pl' ? (PL[text] ?? text) : text, vars)) as T;
  t.locale = locale;
  t.plural = (count, one, other, vars) => {
    const category = rules.select(count);
    let template: string;
    if (locale === 'pl') {
      const forms = PL_PLURALS[one];
      template = forms ? (forms[category as keyof typeof forms] ?? forms.other) : category === 'one' ? one : other;
    } else {
      template = category === 'one' ? one : other;
    }
    return fill(template, { n: count.toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-GB'), ...vars });
  };
  return t;
}
