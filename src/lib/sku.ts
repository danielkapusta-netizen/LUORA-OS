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
