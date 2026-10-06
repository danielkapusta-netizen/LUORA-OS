import { Suspense, type ReactNode } from 'react';
import { PageHeader } from '@/components/ui';
import { AnalyticsTabs } from './tabs';

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
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
