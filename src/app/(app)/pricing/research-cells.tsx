import { Badge } from '@/components/ui';
import { getT } from '@/lib/i18n/server';
import { formatPrice, samePrice } from '@/lib/price';
import { rationaleParts, recommendationNeedsRefresh, RECOMMENDATION_LABELS } from '@/lib/pricing-research';
import type { PricedListing, PricingRecommendation } from '@/server/services/pricing';
import { UseRecommendedPrice } from './price-cell';

export async function ResearchCells({ recommendations, listings, productName, multipleAccounts }: {
  recommendations: PricingRecommendation[]; listings: PricedListing[]; productName: string; multipleAccounts: boolean;
}) {
  const t = await getT();
  const dateFormat = new Intl.DateTimeFormat(t.locale === 'pl' ? 'pl-PL' : 'en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw',
  });
  return <>
    <td className="min-w-44 px-4 py-3 max-md:px-0 max-md:py-2">
      <p className="mb-1 text-xs text-slate-500 md:hidden">{t('Recommended price')}</p>
      {recommendations.length === 0 ? <span className="text-xs text-slate-500">{t('No research yet')}</span> :
        <div className="space-y-4">{recommendations.map((r) => {
          const listing = listings.find((l) => l.id === r.listingId && l.accountId === r.accountId);
          const refresh = r.status === 'change_price' && recommendationNeedsRefresh(r.researchedAt, r.observedLuoraPrice, listing?.price ?? null);
          const canUse = r.status === 'change_price' && r.recommendedPrice && listing?.active && listing.currency === 'PLN' && !refresh && !samePrice(listing.price, r.recommendedPrice);
          return <div key={r.id}>
            {multipleAccounts && <p className="mb-1 text-xs font-medium text-slate-500">{r.accountName}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {r.recommendedPrice ? <span className="font-semibold tabular-nums text-emerald-800">{formatPrice(r.recommendedPrice)}</span> :
                <Badge tone={r.status === 'keep_price' ? 'green' : r.status === 'needs_review' ? 'gray' : 'amber'}>{t(RECOMMENDATION_LABELS[r.status])}</Badge>}
              {canUse && <UseRecommendedPrice listingId={listing!.id} price={r.recommendedPrice!} productName={productName} />}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {t('Last researched')}<br />
              <time dateTime={r.researchedAt.toISOString()} title={`${dateFormat.format(r.researchedAt)} · Europe/Warsaw`}>{dateFormat.format(r.researchedAt)}</time>
            </p>
            {refresh && <p className="mt-1 text-xs text-amber-700">{t('Recheck before use: research is old or the current price has changed.')}</p>}
          </div>;
        })}</div>}
    </td>
    <td className="min-w-64 max-w-96 px-4 py-3 max-md:min-w-0 max-md:px-0 max-md:py-2">
      <p className="mb-1 text-xs text-slate-500 md:hidden">{t('Rationale')}</p>
      {recommendations.length === 0 ? <span className="text-xs text-slate-500">{t('Daily research will appear here.')}</span> :
        <div className="space-y-4 text-xs leading-relaxed text-slate-600">{recommendations.map((r) => {
          const parts = rationaleParts(r.rationale, r.sources);
          const extra = r.sources.filter((s) => !parts.some((p) => p.url === s.url));
          return <div key={r.id}>
            {multipleAccounts && <p className="mb-1 font-medium">{r.accountName}</p>}
            <p className="whitespace-pre-line">{parts.map((part, i) => part.url ?
              <a key={i} href={part.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline decoration-slate-300 underline-offset-2 hover:decoration-brand-600">{part.text}</a> : part.text)}</p>
            {extra.length > 0 && <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{extra.map((s, i) =>
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline underline-offset-2">{s.label} ↗</a>)}</p>}
          </div>;
        })}</div>}
    </td>
  </>;
}
