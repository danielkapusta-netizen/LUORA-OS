import { Suspense, type ReactNode } from 'react';
import { requireCapability } from '@/server/auth';
import { PageHeader } from '@/components/ui';
import { AnalyticsTabs } from './tabs';

export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  await requireCapability('analytics');
  return (
    <>
      <PageHeader title="Analytics" description="Sales, profit and margins from every marketplace, worked out from the orders, their fees and your product costs." />
      <Suspense>
        <AnalyticsTabs />
      </Suspense>
      {children}
    </>
  );
}
