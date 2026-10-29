import { Suspense, type ReactNode } from 'react';
import { requireCapability } from '@/server/auth';
import { PageHeader } from '@/components/ui';
import { AnalyticsTabs } from './tabs';
import { getT } from '@/lib/i18n/server';

export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  const t = await getT();
  await requireCapability('analytics');
  return (
    <>
      <PageHeader title={t('Analytics')} description={t('Sales, profit and margins from every marketplace, worked out from the orders, their fees and your product costs.')} />
      <Suspense>
        <AnalyticsTabs />
      </Suspense>
      {children}
    </>
  );
}
