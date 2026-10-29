import { Nav } from '@/components/nav';
import { requireUser } from '@/server/auth';
import { isMockMode } from '@/server/env';
import { myTaskBadge } from '@/server/services/tasks';
import { logoutAction } from '../auth-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const taskBadge = await myTaskBadge(user.id).catch(() => 0);
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Nav userName={user.name} role={user.role} mock={isMockMode()} taskBadge={taskBadge} logoutAction={logoutAction} />
      {/* On a phone the tab bar floats over the bottom, so the page leaves room for it and for the home indicator. */}
      <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-10 xl:px-12">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
