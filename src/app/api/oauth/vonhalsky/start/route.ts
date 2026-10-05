import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { randomToken } from '@/server/crypto';
import { env } from '@/server/env';
import {
  VON_HALSKY_REDIRECT_PATH,
  pkcePair,
  vonHalskyAuthorizeUrl,
  type VonHalskyCredentials,
} from '@/server/integrations/marketplaces/vonhalsky/client';
import { loadMarketplaceAccount, readCredentials } from '@/server/services/accounts';

/** Sends the user to InPost to authorise this app for the given Von Halsky account. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (user?.role !== 'admin') return new Response('Only admins can connect accounts', { status: 403 });
  const accountId = new URL(request.url).searchParams.get('accountId');
  if (!accountId) return new Response('accountId is required', { status: 400 });
  const account = await loadMarketplaceAccount(accountId);
  const creds = readCredentials<VonHalskyCredentials>(account.credentials);
  if (account.type !== 'vonhalsky' || !creds?.clientId) {
    return new Response('Save the Von Halsky Client ID first', { status: 400 });
  }
  const state = randomToken(16);
  const { verifier, challenge } = pkcePair();
  (await cookies()).set('vonhalsky_oauth', JSON.stringify({ state, accountId, verifier }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return NextResponse.redirect(vonHalskyAuthorizeUrl(creds, `${env().APP_URL}${VON_HALSKY_REDIRECT_PATH}`, state, challenge));
}
