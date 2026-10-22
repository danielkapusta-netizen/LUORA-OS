import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Luora OS', template: '%s · Luora OS' },
  description: 'Orders and shipping for Shopify, Allegro, Empik and HEBE',
};

// viewport-fit=cover lets the bars reach under the notch and home indicator; the layout pads for the safe areas.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#1f3530' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
