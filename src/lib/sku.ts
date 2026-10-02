// Shopify variants without a SKU still become products; they get a placeholder SKU so the
// product list keeps one unique key per product.
const PLACEHOLDER_PREFIX = 'shopify:';

export function placeholderSku(variantId: string): string {
  return `${PLACEHOLDER_PREFIX}${variantId.split('/').pop()}`;
}

export function hasRealSku(sku: string): boolean {
  return !sku.startsWith(PLACEHOLDER_PREFIX);
}

/** Shopify's "Product - Default Title" for products without variants reads as just the product. */
export function cleanShopifyTitle(title: string): string {
  return title.replace(/ - Default Title$/, '');
}

/**
 * Barcodes compared across platforms: digits only, and a 14-digit GTIN with a leading 0 is the
 * same product as its 13-digit EAN. Returns null for anything that isn't a barcode.
 */
export function normalizeEan(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  const ean = digits.length === 14 && digits.startsWith('0') ? digits.slice(1) : digits;
  return ean.length >= 8 && ean.length <= 14 ? ean : null;
}
