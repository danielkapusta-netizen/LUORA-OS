import { describe, expect, it } from 'vitest';
import { createMatcher, isClearSuggestion, normalizeTitle } from '@/server/services/matching';

// Real Shopify names (Shopify is the product list) and Allegro / Empik titles for the same products.
const SHOPIFY = [
  'Anua PDRN Collagen Glow Facial Serum Spray 100 ml',
  'Anua PDRN Hyaluronic Acid Capsule 100 Serum',
  'Anua PDRN Hydrating Capsule Mist – mgiełka nawilżająca 30 ml',
  'Anua Heartleaf Quercetinol Pore Deep Cleansing Foam',
  'Centellian24 Madeca Cream Time Reverse 50 ml',
  'Centellian24 Madeca Cream – krem regenerujący 100 ml',
  'Centellian24 360 Shot PDRN Lifting Eye Cream – krem pod oczy 30 ml',
  'ROUND LAB Birch Juice Moisturizing Sun Stick SPF50+',
  'ROUND LAB Birch Juice Moisturizing Sunscreen SPF50',
  'HaruHaru Wonder Black Rice Toner do cery wrażliwej 150ml',
  'VT Cosmetics PDRN Capsule Cream 100',
  'VT Cosmetics PDRN 100 Essence – esencja regenerująca',
  'Medicube Age-R Ultra Tune 40.68',
  'Medicube Age-R Booster Pro – urządzenie do pielęgnacji twarzy',
].map((name, i) => ({ id: `p${i}`, name }));
const id = (name: string) => SHOPIFY.find((p) => p.name === name)!.id;
const suggest = createMatcher(SHOPIFY);

describe('normalizeTitle', () => {
  it('drops accents, punctuation and filler words, and reads pack sizes', () => {
    expect(normalizeTitle('Krem Nawilżający do twarzy, 50ml – SPF 50+')).toEqual({
      words: ['krem', 'nawilzajacy', 'twarzy', 'spf50'],
      sizes: ['50ml'],
      condensed: 'kremnawilzajacytwarzyspf50',
    });
    expect(normalizeTitle('Anua PDRN 100 + Hyaluron Glow Pad 60 sztuk').sizes).toEqual(['60szt']);
  });
});

describe('createMatcher', () => {
  it.each([
    ['ANUA PDRN Collagen Glow Facial Serum Spray 100 ml', 'Anua PDRN Collagen Glow Facial Serum Spray 100 ml'],
    ['Anua PDRN Collagen Glow Facial Spray Mgiełka Nawilżająca - 100 ml', 'Anua PDRN Collagen Glow Facial Serum Spray 100 ml'],
    ['Anua - PDRN Hyaluronic Acid Hydrating Capsule Mist – Nawilżająca Mgiełka', 'Anua PDRN Hydrating Capsule Mist – mgiełka nawilżająca 30 ml'],
    ['Krem Nawilżający do twarzy Ujędrnia Centellian24 Madeca Cream Time 50ml', 'Centellian24 Madeca Cream Time Reverse 50 ml'],
    ['Round Lab Birch Juice Sunscreen SPF 50 krem przeciwsłoneczny 50 ml', 'ROUND LAB Birch Juice Moisturizing Sunscreen SPF50'],
    ['Haru Haru Wonder Black Rice tonic do twarzy do cery wrażliwej', 'HaruHaru Wonder Black Rice Toner do cery wrażliwej 150ml'],
    ['VT COSMETICS PDRN CAPSULE CREAM 100, 50ml - krem nawilżający z PDRN', 'VT Cosmetics PDRN Capsule Cream 100'],
    ['Urządzenie do pielęgnacji twarzy MEDICUBE Age-R Ultra Tune', 'Medicube Age-R Ultra Tune 40.68'],
  ])('%s → %s', (title, expected) => {
    const s = suggest(title);
    expect(s[0].productId).toBe(id(expected));
    expect(isClearSuggestion(s)).toBe(true);
  });

  it('does not offer a product of another brand, or a different size as a clear match', () => {
    expect(suggest('Kuracja w Ampułkach KOPHER Curepair Rozjaśniająca')).toEqual([]);
    expect(suggest('880972562432')).toEqual([]);
    expect(isClearSuggestion(suggest('Centellian24 - Madeca Cream Time Reverse Zero 80ml - nawilżający krem'))).toBe(false);
    expect(isClearSuggestion(suggest('Centellian24 - 360º Shot PDRN Active Serum – Regenerujące Serum – 50ml'))).toBe(false);
  });
});
