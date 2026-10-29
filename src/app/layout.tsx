import type { Metadata, Viewport } from 'next';
import { LocaleProvider } from '@/lib/i18n/client';
import { getLocale, getT } from '@/lib/i18n/server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: 'Luora OS', template: '%s · Luora OS' },
    description: t('Orders and shipping for Shopify, Allegro, Empik and HEBE'),
  };
}

// viewport-fit=cover lets the bars reach under the notch and home indicator; the layout pads for the safe areas.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#1f3530' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
