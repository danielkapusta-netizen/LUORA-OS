import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';
import { createT, type T } from '@/lib/i18n/translate';
import { can } from '@/lib/permissions';
import { readCookie, SESSION_COOKIE, userForSessionToken, type SessionUser } from '../session';
import { PRICING_SCOPES } from './pricing-tools';

// The pages a person sees when they connect an AI assistant: the consent screen at /oauth/authorize and the list of
// connections at /oauth/connections. They run in the Worker layer, in front of the app, and use the app's own login
// (the same session cookie); the OAuth library supplies the protocol, a one-time browser-bound form handle included.

export const AUTHORIZE_PATH = '/oauth/authorize';
export const CONNECTIONS_PATH = '/oauth/connections';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function translator(request: Request): T {
  const cookie = readCookie(request, LOCALE_COOKIE);
  return createT(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
}

function html(body: string, title: string, status = 200, headers?: Headers): Response {
  const out = new Headers(headers);
  out.set('Content-Type', 'text/html; charset=utf-8');
  out.set('Cache-Control', 'no-store');
  out.set('X-Frame-Options', 'DENY');
  // No form-action: approving ends in a redirect to the client (e.g. chatgpt.com), which Chrome would block under it.
  out.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  // Not no-referrer: with it browsers send `Origin: null` on the form post. same-origin still sends no referrer to other
  // sites, so the authorization URL is not leaked to the client on the redirect.
  out.set('Referrer-Policy', 'same-origin');
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>
body{margin:0;background:#fbfaf7;color:#1c1b19;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:30rem;margin:0 auto;padding:3rem 1rem}
.card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:1.5rem;padding:1.75rem}
h1{font-size:1.35rem;margin:0 0 .75rem}p{margin:.5rem 0;color:#3a3833}small{color:#6b6a66}
label{display:flex;gap:.6rem;align-items:flex-start;margin:.75rem 0}input[type=checkbox]{margin-top:.3rem}
.row{display:flex;gap:.6rem;margin-top:1.5rem}.btn{border:1px solid rgba(0,0,0,.15);border-radius:999px;padding:.6rem 1.3rem;font:inherit;font-weight:600;background:#fff;color:#1c1b19;cursor:pointer}
.btn.primary{background:#1c1b19;color:#fff;border-color:#1c1b19}.warn{background:#fdf8e4;border-radius:.75rem;padding:.6rem .8rem;color:#6b5300}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:.5rem .4rem;border-bottom:1px solid rgba(0,0,0,.08);vertical-align:top}
</style></head><body><main><div class="card">${body}</div></main></body></html>`;
  return new Response(page, { status, headers: out });
}

function redirect(location: string, status = 302, headers?: Headers): Response {
  const out = new Headers(headers);
  out.set('Location', location);
  return new Response(null, { status, headers: out });
}

function scopeLabel(scope: string, t: T): string {
  if (scope === PRICING_SCOPES.read) return t('Read the pricing catalogue: products, stock, offers and current prices');
  if (scope === PRICING_SCOPES.write) return t('Send researched price recommendations. They are stored for you to review and never change a price on any marketplace');
  return scope;
}

function consentPage(details: ConsentDescription, handle: string, user: SessionUser, t: T): string {
  const origin = details.clientDomain
    ? t('Published by {domain}.', { domain: `<strong>${escape(details.clientDomain)}</strong>` })
    : t('This app registered itself, so its name is not verified.');
  const scopes = [PRICING_SCOPES.read, PRICING_SCOPES.write]
    .map((scope) => `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked><span>${escape(scopeLabel(scope, t))}</span></label>`)
    .join('');
  return `<h1>${escape(t('Connect {app} to Luora OS?', { app: details.clientName }))}</h1>
<p>${origin} ${t('Access will be sent to {host}.', { host: `<strong>${escape(details.redirectHost)}</strong>` })}</p>
<p>${escape(t('It will act as {name}.', { name: user.name }))}</p>
${details.redirectIsLoopback ? `<p class="warn"><strong>${escape(t('This sends access to an app on your computer.'))}</strong> ${escape(t('Continue only if you just started signing in from it.'))}</p>` : ''}
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
${scopes}
<p><small>${escape(t('You can disconnect it at any time under Connected apps.'))}</small></p>
<div class="row"><button class="btn primary" name="decision" value="approve">${escape(t('Allow'))}</button><button class="btn" name="decision" value="deny">${escape(t('Deny'))}</button></div>
</form>`;
}

/**
 * Whether a form post comes from this site, as an extra layer next to the one-time form handle and the SameSite cookie.
 * Browsers send `Origin: null` for some same-site form posts, so `null` is accepted only when the browser also says the
 * post is same-origin (`Sec-Fetch-Site`, which a page's script cannot set). A missing Origin is a non-browser client.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  return origin === 'null' && request.headers.get('sec-fetch-site') === 'same-origin';
}

function errorPage(t: T, message: string, status = 400): Response {
  return html(`<h1>${escape(t('Could not connect'))}</h1><p>${escape(message)}</p>`, t('Could not connect'), status);
}

/** GET shows the consent screen, POST records the decision. */
export async function handleAuthorize(request: Request, oauth: OAuthHelpers): Promise<Response> {
  const t = translator(request);
  const url = new URL(request.url);
  const user = await userForSessionToken(readCookie(request, SESSION_COOKIE));
  if (!user) {
    if (request.method === 'GET') return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    return errorPage(t, t('Your session ended. Start connecting again from the app.'), 401);
  }
  if (!can(user.role, 'pricing')) return errorPage(t, t('Your Luora role does not allow pricing, so you cannot connect an app to it.'), 403);

  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return html(consentPage(details, consent.handle, user, t), t('Connect an app to Luora OS'), 200, consent.headers);
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    if (!sameOrigin(request)) return errorPage(t, t('This request did not come from Luora.'), 403);

    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    const scope = form.getAll('scope').map(String).filter((s) => s === PRICING_SCOPES.read || s === PRICING_SCOPES.write);
    // Write access without read access is not a useful grant; and no scope at all means the person declined.
    if (form.get('decision') !== 'approve' || scope.length === 0) {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle, { scope });
    // Only the person's id travels with the grant. Their role is read again on every tool call.
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { approvedAt: new Date().toISOString() },
      scope: approved.request.scope,
      props: { userId: user.id },
    });
    return redirect(redirectTo, 302, approved.headers);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return errorPage(t, error.description ?? t('The request is not valid. Start connecting again from the app.'));
    if (error instanceof CimdFetchError) return errorPage(t, t('This app could not be verified.'));
    throw error;
  }
}

/** The signed-in person's connected apps, with a button to disconnect each. */
export async function handleConnections(request: Request, oauth: OAuthHelpers): Promise<Response> {
  const t = translator(request);
  const url = new URL(request.url);
  const user = await userForSessionToken(readCookie(request, SESSION_COOKIE));
  if (!user) return request.method === 'GET' ? redirect(`/login?next=${encodeURIComponent(url.pathname)}`) : errorPage(t, t('Your session ended.'), 401);

  if (request.method === 'POST') {
    if (!sameOrigin(request)) return errorPage(t, t('This request did not come from Luora.'), 403);
    const grantId = String((await request.formData()).get('grantId') ?? '');
    // revokeGrant is scoped to the owner: a grant that is not this person's is not touched.
    if (grantId) await oauth.revokeGrant(grantId, user.id);
    return redirect(CONNECTIONS_PATH, 303);
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });

  const { items } = await oauth.listUserGrants(user.id);
  const dateText = (ms?: number) => (ms ? new Date(ms * (ms < 1e12 ? 1000 : 1)).toLocaleDateString(t.locale === 'pl' ? 'pl-PL' : 'en-GB') : '-');
  const rows = items
    .map(
      (grant) => `<tr><td>${escape(grant.clientId)}</td><td>${escape(grant.scope.join(', '))}</td><td>${escape(dateText(grant.createdAt))}</td><td>${escape(dateText(grant.expiresAt))}</td>
<td><form method="post"><input type="hidden" name="grantId" value="${escape(grant.id)}"><button class="btn">${escape(t('Disconnect'))}</button></form></td></tr>`,
    )
    .join('');
  const body = items.length
    ? `<table><thead><tr><th>${escape(t('App'))}</th><th>${escape(t('Access'))}</th><th>${escape(t('Connected'))}</th><th>${escape(t('Expires if unused'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>${escape(t('No apps are connected.'))}</p>`;
  return html(`<h1>${escape(t('Connected apps'))}</h1>${body}`, t('Connected apps'));
}
