// Address helpers for Polish carriers, which want street and house number
// separately and a 9-digit phone number.

/**
 * Splits "ul. Marszałkowska 10/5" into { street: "ul. Marszałkowska", buildingNumber: "10/5" }.
 * The number may carry a flat after a slash, dash, "m." or "lok." (digits or a letter: "38/E", "7 lok. B",
 * "3/5/7") or a letter after a space ("45 B" → "45B").
 * When no number can be found the whole line stays in `street`.
 */
export function splitStreet(line: string): { street: string; buildingNumber: string } {
  const value = line.replace(/\s+/g, ' ').trim();
  const match = value.match(/^(.*?\D)\s*(\d+[A-Za-z]?(?:\s*[/\\-]\s*[\dA-Za-z]+)*)(?:\s*(?:m\.?|lok\.?)\s*([\dA-Za-z]+)|\s+([A-Za-z]))?\s*$/i);
  if (!match) return { street: value, buildingNumber: '' };
  const [, street, number, flat, letter] = match;
  return {
    street: street.replace(/[\s,]+$/, '').trim(),
    buildingNumber: number.replace(/\s+/g, '') + (flat ? `/${flat}` : '') + (letter ?? ''),
  };
}

/** Normalises a Polish phone number to 9 digits; other numbers keep their digits and leading +. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  const pl = digits.replace(/^(\+48|0048)/, '');
  if (/^\d{9}$/.test(pl)) return pl;
  return digits;
}

/** Formats "00123" / "00-123" as "00-123" for Polish postal codes. */
export function formatPostalCode(code: string, countryCode = 'PL'): string {
  const trimmed = code.trim();
  if (countryCode.toUpperCase() !== 'PL') return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 5 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : trimmed;
}

/** InPost parcel locker codes look like "KRA010", "WAW01A" or "POZ08M". */
const LOCKER_CODE = /\b([A-Z]{3}\d{2,3}[A-Z]{0,3})\b/;

export function findLockerCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.toUpperCase().match(LOCKER_CODE);
  return match ? match[1] : null;
}
