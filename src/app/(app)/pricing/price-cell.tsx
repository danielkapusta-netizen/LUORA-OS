'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Input, buttonClass } from '@/components/ui';
import { parsePrice, priceChangePercent, samePrice } from '@/lib/price';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

/** A change this big is shown in amber, as it is more likely a typo than a decision. */
const BIG_CHANGE_PERCENT = 30;

const PriceDraftContext = createContext<{
  drafts: Record<string, string>;
  setDraft: (listingId: string, value: string) => void;
} | null>(null);

/** Shares a draft across the current-price and recommendation columns of one product row. */
export function PriceDraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return <PriceDraftContext.Provider value={{ drafts, setDraft: (id, value) => setDrafts((old) => ({ ...old, [id]: value })) }}>{children}</PriceDraftContext.Provider>;
}

/** Copies into the field only. Publishing still requires the existing Update button. */
export function UseRecommendedPrice({ listingId, price, productName }: { listingId: string; price: string; productName: string }) {
  const t = useT();
  const context = useContext(PriceDraftContext);
  const { pending } = useFormStatus();
  return <button type="button" disabled={pending || !context || context.drafts[listingId] === price}
    onClick={() => context?.setDraft(listingId, price)} className={buttonClass('secondary', 'sm')}
    aria-label={t('Use recommended price for {product}', { product: productName })}>{t('Use price')}</button>;
}

/**
 * One listing's price: the field (named `price:<id>` for the form), and a button that sends just
 * this price. Enter in the field does the same. The change in percent shows while typing.
 */
export function PriceCell({ listingId, current, label }: { listingId: string; current: string | null; label: string }) {
  const t = useT();
  const [localValue, setLocalValue] = useState(current ?? '');
  const context = useContext(PriceDraftContext);
  const value = context?.drafts[listingId] ?? localValue;
  const setValue = (next: string) => context ? context.setDraft(listingId, next) : setLocalValue(next);
  const button = useRef<HTMLButtonElement>(null);
  // Any submit locks every button; only the one that was pressed shows it is working.
  const { pending, data } = useFormStatus();
  const working = pending && (data?.get('only') ?? listingId) === listingId;
  const parsed = parsePrice(value);
  const invalid = value.trim() !== '' && !parsed;
  const changed = Boolean(parsed) && !samePrice(current, parsed);
  const change = changed ? priceChangePercent(current, parsed) : null;
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Input
          name={`price:${listingId}`}
          inputMode="decimal"
          autoComplete="off"
          aria-label={label}
          aria-invalid={invalid}
          placeholder="—"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (changed && !pending) e.currentTarget.form?.requestSubmit(button.current);
          }}
          className={cn('h-9 w-28 text-right font-semibold tabular-nums', invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20', changed && !invalid && 'border-brand-500 bg-brand-50/40')}
        />
      </div>
      <button ref={button} type="submit" name="only" value={listingId} disabled={!changed || pending} className={buttonClass('primary', 'sm')}>
        {working ? '…' : t('Update')}
      </button>
      <span className={cn('w-16 text-xs tabular-nums', invalid ? 'text-red-600' : change !== null && Math.abs(change) >= BIG_CHANGE_PERCENT ? 'font-medium text-amber-700' : 'text-slate-500')}>
        {invalid ? t('not a price') : change !== null ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : ''}
      </span>
    </div>
  );
}
