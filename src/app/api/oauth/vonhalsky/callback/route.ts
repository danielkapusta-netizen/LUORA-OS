import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { encryptJson } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { marketplaceAccounts } from '@/server/db/schema';
import { env } from '@/server/env';
import {
  VON_HALSKY_REDIRECT_PATH,
  exchangeVonHalskyCode,
  type VonHalskyCredentials,
} from '@/server/integrations/marketplaces/vonhalsky/client';
import { loadMarketplaceAccount, readCredentials } from '@/server/services/accounts';

export async function GET(request: Request) {
  const back = (message: string) =>
    NextResponse.redirect(`${env().APP_URL}/settings/integrations?message=${encodeURIComponent(message)}`);
  if ((await currentUser())?.role !== 'admin') return new Response('Only admins can connect accounts', { status: 403 });

  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get('vonhalsky_oauth')?.value;
  jar.delete('vonhalsky_oauth');
  const { state, accountId, verifier } = saved
    ? (JSON.parse(saved) as { state: string; accountId: string; verifier: string })
    : { state: '', accountId: '', verifier: '' };
  if (!state || state !== url.searchParams.get('state')) return back('Von Halsky login expired or was tampered with. Try again.');
  if (url.searchParams.get('error')) {
    return back(`Von Halsky refused access: ${url.searchParams.get('error')} ${url.searchParams.get('error_description') ?? ''}`.trim());
  }
  const code = url.searchParams.get('code');
  if (!code) return back('Von Halsky did not return an authorisation code');

  const account = await loadMarketplaceAccount(accountId);
  const creds = readCredentials<VonHalskyCredentials>(account.credentials);
  if (!creds) return back('The Von Halsky account has no client credentials');
  try {
    const next = await exchangeVonHalskyCode(creds, code, `${env().APP_URL}${VON_HALSKY_REDIRECT_PATH}`, verifier);
    await getDb()
      .update(marketplaceAccounts)
      .set({ credentials: encryptJson(next), lastError: null })
      .where(eq(marketplaceAccounts.id, accountId));
  } catch (err) {
    return back(`Could not connect Von Halsky: ${err instanceof Error ? err.message : err}`);
  }
  return back(`${account.name} connected`);
}
