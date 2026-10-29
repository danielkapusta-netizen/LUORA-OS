'use server';

import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { getT } from '@/lib/i18n/server';
import { login, logout } from '@/server/auth';

export async function loginAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!(await login(email, password))) return { error: (await getT())('Wrong email or password') };
  const next = String(formData.get('next') ?? '/orders');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/orders');
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect('/login');
}
