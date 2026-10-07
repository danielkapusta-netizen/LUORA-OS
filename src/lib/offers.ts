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
