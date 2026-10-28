import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';
import { CustomerTabs } from './tabs';
import { getT } from '@/lib/i18n/server';

export default async function CustomersLayout({ children }: { children: ReactNode }) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t('Customers')} description={t('Everyone who bought from you, on every marketplace, with what they are worth and what to do next.')} />
      <CustomerTabs />
      {children}
    </>
  );
}
