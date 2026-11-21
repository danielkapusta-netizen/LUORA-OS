// What an Allegro offer shows from the Shopify product: its title fitted to Allegro's limits, its description
// turned into Allegro's description sections, and the responsible person and producer (GPSR) per product.
// Pure functions, so the publish preview and the offer itself always agree.

/** Allegro's limits for an offer title: 12–75 characters (some characters count as their HTML entity), at least 3 words. */
export const TITLE_MAX = 75;
export const TITLE_MIN = 12;
const TITLE_MIN_WORDS = 3;

/** Characters Allegro stores as HTML entities, so they count as that many characters. */
const ENTITY_LENGTH: Record<string, number> = { '&': 5, '"': 6, '<': 4, '>': 4 };

/** The length Allegro counts for a title. */
export function allegroTitleLength(title: string): number {
  let n = 0;
  for (const ch of title) n += ENTITY_LENGTH[ch] ?? 1;
  return n;
}

export type AllegroTitle = { ok: true; title: string; shortened: boolean } | { ok: false; title: string; problem: string };

/** The title to send: whitespace collapsed and, when too long, cut after the last whole word that fits. */
export function allegroTitle(raw: string): AllegroTitle {
  const clean = raw.replace(/\s+/g, ' ').trim();
  let title = clean;
  if (allegroTitleLength(title) > TITLE_MAX) {
    const words = clean.split(' ');
    title = '';
    for (const word of words) {
      const next = title ? `${title} ${word}` : word;
      if (allegroTitleLength(next) > TITLE_MAX) break;
      title = next;
    }
    // Words that can't end a title: a dangling dash, comma or conjunction is dropped with the cut.
    title = title.replace(/(\s+(?:[-–—,;:+&\/|]|i|oraz|z|w|do|na|dla))+$/i, '').replace(/[\s,;:\-–—+&\/|]+$/, '');
    // A single word longer than the limit: cut it, rather than send nothing.
    if (!title) title = [...clean].slice(0, TITLE_MAX).join('').trim();
  }
  if (allegroTitleLength(title) < TITLE_MIN || title.split(' ').filter(Boolean).length < TITLE_MIN_WORDS) {
    return { ok: false, title, problem: `title too short for Allegro (needs ${TITLE_MIN}+ characters and ${TITLE_MIN_WORDS}+ words)` };
  }
  return { ok: true, title, shortened: title !== clean };
}

// ---------------------------------------------------------------- description

export interface AllegroDescription {
  sections: { items: { type: 'TEXT'; content: string }[] }[];
}

/** Allegro's limit for the whole description is 40,000 bytes; a margin covers the JSON around it. */
const DESCRIPTION_MAX_BYTES = 38_000;
/** Blocks per section: long descriptions read better split, and each item stays small. */
const SECTION_MAX_BYTES = 8_000;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', laquo: '«', raquo: '»', bdquo: '„', rdquo: '”', ldquo: '“', rsquo: '’', lsquo: '‘', deg: '°', reg: '®', trade: '™', copy: '©', times: '×', micro: 'µ', sup2: '²', sup3: '³' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Block = { tag: 'h1' | 'h2' | 'p'; html: string } | { tag: 'ul' | 'ol'; items: string[] };

/**
 * Shopify's HTML as Allegro accepts it: only h1, h2, p, ul, ol, li and b, without attributes. Other headings become h2,
 * strong becomes b, line breaks and divs become paragraphs, links and other inline tags keep only their text, and
 * scripts, styles, images and comments are dropped. Nested lists are flattened into the outer list.
 */
export function allegroDescriptionBlocks(html: string): string[] {
  const source = (html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|iframe|object|video|audio)\b[\s\S]*?<\/\1\s*>/gi, '');
  const blocks: Block[] = [];
  let inline: { tag: 'h1' | 'h2' | 'p'; html: string } | null = null;
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let listDepth = 0;
  let item: string | null = null;
  let bold = 0;

  const finishInline = () => {
    if (inline) {
      const text = tidy(inline.html);
      if (text) blocks.push({ tag: inline.tag, html: text });
    }
    inline = null;
  };
  const finishItem = () => {
    if (list && item !== null) {
      const text = tidy(item);
      if (text) list.items.push(text);
    }
    item = null;
  };
  const finishList = () => {
    finishItem();
    if (list && list.items.length) blocks.push(list);
    list = null;
    listDepth = 0;
  };
  const append = (fragment: string) => {
    if (list) {
      if (item === null) item = bold ? '<b>' : '';
      item += fragment;
      return;
    }
    if (!inline) inline = { tag: 'p', html: bold ? '<b>' : '' };
    inline.html += fragment;
  };
  const setBold = (on: boolean) => {
    const before = bold;
    bold = Math.max(0, bold + (on ? 1 : -1));
    if (inline?.tag !== 'p' && !list) return; // headings carry no bold
    if (before === 0 && bold === 1 && (inline || item !== null)) append('<b>');
    if (before === 1 && bold === 0 && (inline || item !== null)) append('</b>');
  };

  const tokens = source.split(/(<\/?[a-zA-Z][^>]*>)/);
  for (const token of tokens) {
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(token);
    if (!tag) {
      const text = decodeEntities(token.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
      if (text.trim() || ((inline || item !== null) && text === ' ')) append(escapeText(text));
      continue;
    }
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    switch (name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (list) finishList();
        finishInline();
        if (!closing) inline = { tag: name === 'h1' ? 'h1' : 'h2', html: '' };
        break;
      case 'ul': case 'ol':
        if (closing) {
          listDepth = Math.max(0, listDepth - 1);
          if (listDepth === 0) finishList();
        } else {
          if (!list) {
            finishInline();
            list = { tag: name, items: [] };
          } else finishItem();
          listDepth++;
        }
        break;
      case 'li':
        if (!list) {
          finishInline();
          list = { tag: 'ul', items: [] };
          listDepth = 1;
        }
        finishItem();
        if (!closing) item = bold ? '<b>' : '';
        break;
      case 'b': case 'strong':
        setBold(!closing);
        break;
      case 'br':
        if (list) finishItem();
        else finishInline();
        break;
      case 'p': case 'div': case 'section': case 'article': case 'blockquote': case 'header': case 'footer': case 'table': case 'tr': case 'dl': case 'dt': case 'dd': case 'figure': case 'figcaption': case 'pre': case 'hr':
        if (list && !closing && listDepth > 0 && item !== null) finishItem();
        else if (!list) finishInline();
        break;
      case 'td': case 'th':
        if (closing) append(' ');
        break;
      default:
        // a, span, i, em, u, img, font, …: their text stays, the tag goes.
        break;
    }
  }
  finishList();
  finishInline();
  return blocks.map((b) => ('items' in b ? `<${b.tag}>${b.items.map((i) => `<li>${i}</li>`).join('')}</${b.tag}>` : `<${b.tag}>${b.html}</${b.tag}>`));
}

/** Trims a fragment, balances its bold tags and drops bold that wraps nothing. */
function tidy(fragment: string): string {
  let html = fragment.replace(/\s+/g, ' ');
  const opens = (html.match(/<b>/g) ?? []).length;
  const closes = (html.match(/<\/b>/g) ?? []).length;
  if (opens > closes) html += '</b>'.repeat(opens - closes);
  for (let previous = ''; previous !== html; ) {
    previous = html;
    html = html.replace(/<b>(\s*)<\/b>/g, '$1').replace(/<\/b>(\s*)<b>/g, '$1');
  }
  html = html.replace(/^(\s|<b>\s*<\/b>)+/, '').replace(/^<b>\s+/, '<b>').replace(/\s+<\/b>$/, '</b>').trim();
  return html.replace(/<\/?b>/g, '').trim() ? html : '';
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Allegro's description sections for Shopify's HTML, or null when nothing is left (Allegro's catalogue description is used). */
export function allegroDescription(html: string): AllegroDescription | null {
  const blocks = allegroDescriptionBlocks(html);
  const sections: AllegroDescription['sections'] = [];
  let current = '';
  let total = 0;
  for (const block of blocks) {
    const size = byteLength(block);
    if (total + size > DESCRIPTION_MAX_BYTES) break;
    if (current && byteLength(current) + size > SECTION_MAX_BYTES) {
      sections.push({ items: [{ type: 'TEXT', content: current }] });
      current = '';
    }
    current += block;
    total += size;
  }
  if (current) sections.push({ items: [{ type: 'TEXT', content: current }] });
  return sections.length ? { sections } : null;
}

// ---------------------------------------------------------------- responsible person and producer

export interface NamedOption {
  id: string;
  name: string;
}

/** `id` is unset when neither the product nor the account names one (the account's setup problems say so). */
export type GpsrChoice = { ok: true; id: string | undefined; fromProduct: boolean } | { ok: false; problem: string };

/**
 * The responsible person or producer for one product: the value of the product's Shopify metafield, matched by
 * name or id to the ones set up on Allegro, else the account's default. A value that matches nothing is a problem:
 * this is a legal field, so it is never silently replaced by the default.
 */
export function gpsrChoice(
  kind: 'responsible person' | 'responsible producer',
  metafieldKey: string | undefined,
  metafields: Record<string, string>,
  options: NamedOption[] | undefined,
  fallbackId: string | undefined,
): GpsrChoice {
  const key = metafieldKey?.trim();
  const value = key ? metafields[key]?.trim() : '';
  if (value) {
    if (value.startsWith('gid://')) return { ok: false, problem: `${kind} metafield holds a Shopify reference; use a text metafield with the name from Allegro` };
    const wanted = normalise(value);
    const hit = (options ?? []).find((o) => o.id === value || normalise(o.name) === wanted);
    if (hit) return { ok: true, id: hit.id, fromProduct: true };
    return { ok: false, problem: `${kind} "${value}" is not set up on Allegro` };
  }
  return { ok: true, id: fallbackId || undefined, fromProduct: false };
}

function normalise(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
}
