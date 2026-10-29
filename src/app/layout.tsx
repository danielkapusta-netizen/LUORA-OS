import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import { LocaleProvider } from '@/lib/i18n/client';
import { getLocale, getT } from '@/lib/i18n/server';
import './globals.css';

// Self-hosted at build time. latin-ext covers Polish. The variables feed the font tokens in globals.css.
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin', 'latin-ext'], weight: ['600', '700'], variable: '--font-serif', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], weight: ['500'], variable: '--font-jetbrains', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: 'Luora OS', template: '%s · Luora OS' },
    description: t('Orders and shipping for Shopify, Allegro, Empik and HEBE'),
  };
}

// viewport-fit=cover lets the bars reach under the notch and home indicator; the layout pads for the safe areas.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f6f4ef' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
