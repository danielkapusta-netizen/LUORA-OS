import { requireCapability } from '@/server/auth';
import { SettingsTabs } from './tabs';
import { getT } from '@/lib/i18n/server';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  await requireCapability('settings');
  return (
    <>
      <h1 className="mb-3 text-xl font-semibold tracking-tight">{t('Settings')}</h1>
      <SettingsTabs />
      {children}
    </>
  );
}
