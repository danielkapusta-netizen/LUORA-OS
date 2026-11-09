'use client';

import { ErrorScreen } from '@/components/error-screen';
import { useT } from '@/lib/i18n/client';

/** A page under the app failed: keep the navigation and offer a retry instead of a blank error screen. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  return <ErrorScreen error={error} retry={retry} t={t} />;
}
