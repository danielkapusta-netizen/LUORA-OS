import { desc } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Calculator } from '@/components/analytics/calculator';
import { channelCommissionRates, type Candidate } from '@/lib/analytics/calculator';
import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { calculatorCandidates } from '@/server/db/schema';
import { analyticsView } from '@/server/analytics/view';
import { plnRateOn } from '@/server/services/fx';
import { deleteCandidateAction, saveCandidateAction } from './actions';

export const metadata: Metadata = { title: 'Analytics · Calculator' };

export default async function CalculatorPage() {
  await requireUser();
  const [view, saved, usd, eur, krw] = await Promise.all([
    analyticsView({}, 'quarter'),
    getDb().select().from(calculatorCandidates).orderBy(desc(calculatorCandidates.updatedAt)),
    plnRateOn('USD'),
    plnRateOn('EUR'),
    plnRateOn('KRW'),
  ]);
  const fx: Record<string, number> = {};
  if (usd) fx.USD = usd;
  if (eur) fx.EUR = eur;
  if (krw) fx.KRW = krw;
  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        Will this product make money? Enter the supplier&apos;s quote and the price you&apos;d sell at. Fee rates are measured from your own sales of the last quarter
        on each marketplace.
      </p>
      <Calculator
        rates={channelCommissionRates(view.fullSnapshot.orders)}
        fx={fx}
        products={view.snapshot.products}
        saved={saved.map((s) => s.data as unknown as Candidate)}
        save={saveCandidateAction}
        remove={deleteCandidateAction}
      />
    </>
  );
}
