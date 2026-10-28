import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TaskTabs } from '@/components/tasks/tabs';
import { PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Tasks') };
}

export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t('Tasks')} description={t('What the team has to do, who is on it and when.')} />
      <Suspense fallback={null}>
        <TaskTabs />
      </Suspense>
      {children}
    </>
  );
}
