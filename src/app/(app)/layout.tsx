import { Nav } from '@/components/nav';
import { requireUser } from '@/server/auth';
import { isMockMode } from '@/server/env';
import { myTaskBadge } from '@/server/services/tasks';
import { logoutAction } from '../auth-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const taskBadge = await myTaskBadge(user.id).catch(() => 0);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav userName={user.name} role={user.role} mock={isMockMode()} taskBadge={taskBadge} logoutAction={logoutAction} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
