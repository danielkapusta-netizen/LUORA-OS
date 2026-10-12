import { describe, expect, it } from 'vitest';
import { inferBrand } from '@/lib/analytics/orders';

describe('inferBrand', () => {
  it('reads the brand from the listing title', () => {
    expect(inferBrand('NIDA Youthful Formula™ Ultimate Moisturizing Cream – krem 100 ml')).toBe('NIDA');
    expect(inferBrand('Serum pod oczy - VT Cosmetics PDRN Reedle Shot')).toBe('VT Cosmetics');
    expect(inferBrand('Dr Jart+ Ceramidin Skin Barrier Cream')).toBe('Dr. Jart+');
    expect(inferBrand('Dr. Jart+ Cicapair Tiger Grass')).toBe('Dr. Jart+');
    expect(inferBrand('SKIN1004, Krem Madagascar Hyalu-Cica')).toBe('SKIN1004');
  });

  it('does not find a short brand inside another word, and falls back to Other', () => {
    expect(inferBrand('Krem Hyaluronida 50 ml')).toBe('Other');
    expect(inferBrand('Krem przeciwsłoneczny do twarzy SPF50')).toBe('Other');
  });
});
