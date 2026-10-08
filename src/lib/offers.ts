// Prices of offers Luora creates from the Shopify product list.
export type PriceRounding = 'x.99' | 'x.00' | 'none';

/** Shopify price × (1 + markup/100), rounded as configured (x.99 / x.00 / none). */
export function markupPrice(shopifyPrice: string | number, markupPercent: number, rounding: PriceRounding): string {
  const marked = Number(shopifyPrice) * (1 + markupPercent / 100);
  switch (rounding) {
    case 'x.99':
      return (Math.ceil(marked - 0.005) - 0.01).toFixed(2);
    case 'x.00':
      return Math.ceil(marked - 0.005).toFixed(2);
    default:
      return marked.toFixed(2);
  }
}

// ---------------------------------------------------------------- descriptions

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", oacute: 'ó', ndash: '–', mdash: '—', hellip: '…' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Allegro's limit for one text item of a description. */
const ITEM_LIMIT = 9000;

/**
 * Shopify's description HTML reduced to what Allegro accepts in a description: <h2>, <p>, <ul>, <ol>, <li> and <b>,
 * without attributes. Returned as text items (Allegro limits their size), empty when there is no text.
 */
export function allegroDescriptionItems(html: string): string[] {
  const cleaned = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const blocks: string[] = [];
  let buffer = '';
  let bold = false;
  let wrap = 'p';
  const flush = () => {
    if (bold) {
      buffer += '</b>';
      bold = false;
    }
    const content = buffer.replace(/<b><\/b>/g, '').trim();
    if (content.replace(/<\/?b>/g, '').trim()) blocks.push(`<${wrap}>${content}</${wrap}>`);
    buffer = '';
    wrap = 'p';
  };
  for (const token of cleaned.split(/(<[^>]+>)/)) {
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    if (!tag) {
      if (!token.startsWith('<')) buffer += escapeText(decode(token).replace(/\s+/g, ' '));
      continue;
    }
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    if (name === 'b' || name === 'strong') {
      if (!closing && !bold) {
        buffer += '<b>';
        bold = true;
      } else if (closing && bold) {
        buffer += '</b>';
        bold = false;
      }
    } else if (/^h[1-6]$/.test(name)) {
      flush();
      if (!closing) wrap = 'h2';
    } else if (name === 'ul' || name === 'ol') {
      flush();
      blocks.push(closing ? `</${name}>` : `<${name}>`);
    } else if (name === 'li') {
      flush();
      if (!closing) wrap = 'li';
    } else if (['p', 'div', 'br', 'section', 'article', 'tr', 'table'].includes(name)) {
      flush();
    }
  }
  flush();
  // Drop lists that ended up empty and keep every list open/close balanced.
  const joined = blocks.join('').replace(/<(ul|ol)><\/\1>/g, '');
  const pieces = joined.match(/<(h2|p|ul|ol)>[\s\S]*?<\/\1>/g) ?? [];
  const items: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > ITEM_LIMIT) {
      items.push(current);
      current = '';
    }
    current += piece;
  }
  if (current) items.push(current);
  return items;
}

/** The same description as plain text on one line, for marketplaces that take no markup (Empik). */
export function plainDescription(html: string): string {
  return allegroDescriptionItems(html)
    .join(' ')
    .replace(/<\/(p|h2|li)>/g, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\.\s*\.\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}
