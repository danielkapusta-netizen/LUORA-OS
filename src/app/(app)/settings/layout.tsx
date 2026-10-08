import { requireCapability } from '@/server/auth';
import { SettingsTabs } from './tabs';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireCapability('settings');
  return (
    <>
      <h1 className="mb-3 text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsTabs />
      {children}
    </>
  );
}
