// What an Allegro offer shows from Shopify: the title fitted to Allegro's limits, the description in Allegro's
// format, and the responsible person and producer per product.
import { describe, expect, it } from 'vitest';
import { allegroDescription, allegroDescriptionBlocks, allegroTitle, allegroTitleLength, gpsrChoice } from '@/server/integrations/marketplaces/allegro/offer-content';

describe('Allegro titles', () => {
  it('keeps a title that fits, with whitespace collapsed', () => {
    expect(allegroTitle('  Luora   Night Cream 50 ml ')).toEqual({ ok: true, title: 'Luora Night Cream 50 ml', shortened: false });
  });

  it('cuts a long title after the last whole word that fits', () => {
    const r = allegroTitle('Luora Regenerating Night Cream with Hyaluronic Acid and Ceramides for Dry Skin 50 ml');
    expect(r).toMatchObject({ ok: true, shortened: true, title: 'Luora Regenerating Night Cream with Hyaluronic Acid and Ceramides for Dry' });
    expect(allegroTitleLength(r.title)).toBeLessThanOrEqual(75);
  });

  it('does not end a shortened title on a dash or a conjunction', () => {
    const r = allegroTitle('Luora Serum Witaminowe Rozświetlające do Twarzy z Witaminą C i Niacynamidem - 30 ml - zestaw');
    expect(r.ok && r.title).toBe('Luora Serum Witaminowe Rozświetlające do Twarzy z Witaminą C i Niacynamidem');
  });

  it('counts characters Allegro stores as entities', () => {
    expect(allegroTitleLength('A & B "C"')).toBe(5 + 1 + 1 + 1 + 1 + 1 + 6 + 1 + 6);
    const r = allegroTitle('Cream & Serum & Toner & Mask & Oil & Balm & Mist & Gel & Foam & Lotion');
    expect(r.ok).toBe(true);
    expect(allegroTitleLength(r.title)).toBeLessThanOrEqual(75);
  });

  it('refuses titles that are too short', () => {
    expect(allegroTitle('Cream')).toMatchObject({ ok: false, problem: expect.stringContaining('title too short') });
    expect(allegroTitle('Moisturising Cream')).toMatchObject({ ok: false });
  });
});

describe('Allegro descriptions', () => {
  it('keeps only the tags Allegro accepts', () => {
    expect(
      allegroDescriptionBlocks(
        '<h3 class="x">How to use</h3><p style="color:red">Apply <strong>twice</strong> a day.<br>Avoid <em>eyes</em>.</p>' +
          '<ul><li>Vegan</li><li>Made in <a href="https://x">Korea</a><ul><li>nested</li></ul></li></ul><img src="x.jpg"><script>alert(1)</script>',
      ),
    ).toEqual(['<h2>How to use</h2>', '<p>Apply <b>twice</b> a day.</p>', '<p>Avoid eyes.</p>', '<ul><li>Vegan</li><li>Made in Korea</li><li>nested</li></ul>']);
  });

  it('wraps loose text in paragraphs and escapes it', () => {
    expect(allegroDescriptionBlocks('Plain text &amp; more <3 &nbsp; <div>Second &quot;line&quot;</div>')).toEqual(['<p>Plain text &amp; more &lt;3</p>', '<p>Second &quot;line&quot;</p>']);
  });

  it('balances bold across blocks and drops empty bold', () => {
    expect(allegroDescriptionBlocks('<p><b>Bold start</p><p>still bold</b> plain</p><p><strong> </strong>x</p>')).toEqual([
      '<p><b>Bold start</b></p>',
      '<p><b>still bold</b> plain</p>',
      '<p>x</p>',
    ]);
  });

  it('is empty when nothing is left, so the catalogue description stays', () => {
    expect(allegroDescription('')).toBeNull();
    expect(allegroDescription('<p> </p><img src="a.jpg">')).toBeNull();
  });

  it('splits a long description into sections under Allegro’s limit', () => {
    const paragraph = `<p>${'Słowo '.repeat(300)}</p>`;
    const d = allegroDescription(paragraph.repeat(40))!;
    expect(d.sections.length).toBeGreaterThan(1);
    const bytes = new TextEncoder().encode(JSON.stringify(d)).length;
    expect(bytes).toBeLessThan(40_000);
    for (const s of d.sections) expect(s.items[0].content.startsWith('<p>')).toBe(true);
  });
});

describe('responsible person per product', () => {
  const options = [
    { id: 'p1', name: 'Jan Kowalski' },
    { id: 'p2', name: 'Luora Sp. z o.o.' },
  ];
  it('matches the metafield by name or id, ignoring case and spaces', () => {
    expect(gpsrChoice('responsible person', 'custom.rp', { 'custom.rp': ' luora  sp. z o.o. ' }, options, 'p1')).toEqual({ ok: true, id: 'p2', fromProduct: true });
    expect(gpsrChoice('responsible person', 'custom.rp', { 'custom.rp': 'p1' }, options, undefined)).toEqual({ ok: true, id: 'p1', fromProduct: true });
  });
  it('falls back to the default only when the product has no value', () => {
    expect(gpsrChoice('responsible person', 'custom.rp', {}, options, 'p1')).toEqual({ ok: true, id: 'p1', fromProduct: false });
    expect(gpsrChoice('responsible person', undefined, { 'custom.rp': 'x' }, options, 'p1')).toEqual({ ok: true, id: 'p1', fromProduct: false });
  });
  it('refuses a name Allegro does not know, rather than using the default', () => {
    expect(gpsrChoice('responsible person', 'custom.rp', { 'custom.rp': 'Anna Nowak' }, options, 'p1')).toEqual({ ok: false, problem: 'responsible person "Anna Nowak" is not set up on Allegro' });
    expect(gpsrChoice('responsible producer', 'custom.rp', { 'custom.rp': 'gid://shopify/Metaobject/1' }, options, 'p1')).toMatchObject({ ok: false });
  });
});

describe('responsible person without any source', () => {
  it('leaves it to the account settings check', () => {
    expect(gpsrChoice('responsible person', undefined, {}, [], undefined)).toEqual({ ok: true, id: undefined, fromProduct: false });
  });
});
