import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TaskTabs } from '@/components/tasks/tabs';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Tasks" description="What the team has to do, who is on it and when." />
      <Suspense fallback={null}>
        <TaskTabs />
      </Suspense>
      {children}
    </>
  );
}
