import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';
import { CustomerTabs } from './tabs';

export default function CustomersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Customers" description="Everyone who bought from you, on every marketplace, with what they are worth and what to do next." />
      <CustomerTabs />
      {children}
    </>
  );
}
