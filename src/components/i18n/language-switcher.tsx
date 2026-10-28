'use client';

import { Languages } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocaleAction } from '@/app/locale-actions';
import { useLocale, useT } from '@/lib/i18n/client';
import { LOCALES, LOCALE_NAME, type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** A two-button language switch. `tone` matches the surface it sits on: the dark sidebar or a light card. */
export function LanguageSwitcher({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const current = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (locale: Locale) => {
    if (locale === current || pending) return;
    start(async () => {
      await setLocaleAction(locale);
      router.refresh();
    });
  };

  const dark = tone === 'dark';
  return (
    <div className={cn('flex items-center gap-2', className)} role="group" aria-label={t('Language')}>
      <Languages className={cn('size-4 shrink-0', dark ? 'text-white/60' : 'text-slate-500')} aria-hidden />
      <div className={cn('flex rounded-full p-0.5 text-xs font-medium', dark ? 'bg-white/10' : 'bg-slate-900/[0.06]')}>
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={locale === current}
            disabled={pending}
            onClick={() => choose(locale)}
            className={cn(
              'press rounded-full px-3 py-1 transition-colors max-md:px-4 max-md:py-1.5 max-md:text-sm',
              locale === current
                ? dark
                  ? 'bg-white text-slate-900'
                  : 'bg-white text-slate-900 shadow-sm'
                : dark
                  ? 'text-white/70 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {LOCALE_NAME[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
