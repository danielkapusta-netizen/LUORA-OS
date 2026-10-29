import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketplaceBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Alert, Badge, buttonClass, Card, CardHeader, EmptyState } from '@/components/ui';
import { CARRIER_LABELS, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { env, isMockMode } from '@/server/env';
import { withConfigured } from '@/server/services/accounts';
import { demoAccountCount, listCarrierAccounts, listMarketplaceAccounts, storedCredentialKeys } from '@/server/services/settings';
import { removeDemoDataAction, syncAccountAction, testCarrierAction, testMarketplaceAction } from '../actions';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Integrations') };
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const t = await getT();
  const user = await requireUser();
  const { message } = await searchParams;
  const [marketplaces, carriers, demoCount] = await Promise.all([
    listMarketplaceAccounts(),
    listCarrierAccounts().then(withConfigured),
    demoAccountCount(),
  ]);
  const admin = user.role === 'admin';

  return (
    <div className="space-y-5">
      {message && <Alert tone="blue">{message}</Alert>}
      {!isMockMode() && demoCount > 0 && admin && (
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {t.plural(demoCount, "{n} demo account from the first setup is still here. Its carriers can't buy real labels, and shipping rules that point at it are skipped.", "{n} demo accounts from the first setup are still here. Their carriers can't buy real labels, and shipping rules that point at them are skipped.")}
            </span>
            <ActionForm action={removeDemoDataAction}>
              <SubmitButton size="sm" variant="danger" confirm={t('Delete all demo accounts, their orders, labels and shipping rules?')}>
                {t('Remove demo accounts')}
              </SubmitButton>
            </ActionForm>
          </div>
        </Alert>
      )}
      {isMockMode() && (
        <Alert>
          {t('Demo mode (INTEGRATIONS_MODE=mock): orders and labels are generated locally and nothing is sent to Shopify, Allegro, Empik, HEBE or InPost. Set INTEGRATIONS_MODE=live to use real accounts.')}
        </Alert>
      )}

      <Card>
        <CardHeader
          title={t('Marketplaces')}
          description={t('Where orders come from. Each account is synced every few minutes.')}
          actions={
            admin && (
              <>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=shopify">
                  {t('+ Shopify')}
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=allegro">
                  {t('+ Allegro')}
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=empik">
                  {t('+ Empik')}
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=hebe">
                  {t('+ HEBE')}
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=vonhalsky">
                  {t('+ Von Halsky')}
                </Link>
              </>
            )
          }
        />
        {marketplaces.length === 0 ? (
          <EmptyState title={t('No marketplace accounts yet')} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {marketplaces.map((a) => {
              const keys = storedCredentialKeys(a.credentials);
              const allegroConnected = a.type === 'allegro' && keys.includes('refreshToken');
              const vonHalskyConnected = a.type === 'vonhalsky' && (keys.includes('refreshToken') || keys.includes('accessToken'));
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <MarketplaceBadge marketplace={a.type} />
                      {!a.enabled && <Badge>{t('Disabled')}</Badge>}
                      {a.stockSyncEnabled && <Badge tone={a.stockDryRun ? 'amber' : 'green'}>{a.stockDryRun ? t('Stock: dry run') : t('Stock sync on')}</Badge>}
                      {a.type === 'allegro' && !isMockMode() && (allegroConnected ? <Badge tone="green">{t('Connected')}</Badge> : <Badge tone="red">{t('Not connected')}</Badge>)}
                      {a.type === 'vonhalsky' && !isMockMode() && (vonHalskyConnected ? <Badge tone="green">{t('Connected')}</Badge> : <Badge tone="red">{t('Not connected')}</Badge>)}
                    </div>
                    <p className="text-xs text-slate-500">{t('Last sync {when}', { when: timeAgo(a.lastSyncedAt, t) })}</p>
                    {a.lastError && <p className="text-xs text-red-700">{t('Error:')} {a.lastError}</p>}
                    {a.type === 'shopify' && (
                      <p className="text-xs text-slate-500">
                        {t('Webhook URL (orders/create, orders/updated):')} <code className="break-all select-all">{`${env().APP_URL}/api/webhooks/shopify/${a.id}`}</code>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {a.type === 'allegro' && admin && !isMockMode() && (
                      <a className={buttonClass(allegroConnected ? 'secondary' : 'primary', 'sm')} href={`/api/oauth/allegro/start?accountId=${a.id}`}>
                        {allegroConnected ? t('Reconnect Allegro') : t('Connect Allegro')}
                      </a>
                    )}
                    {a.type === 'vonhalsky' && admin && !isMockMode() && (
                      <a className={buttonClass(vonHalskyConnected ? 'secondary' : 'primary', 'sm')} href={`/api/oauth/vonhalsky/start?accountId=${a.id}`}>
                        {vonHalskyConnected ? t('Reconnect Von Halsky') : t('Connect Von Halsky')}
                      </a>
                    )}
                    <ActionForm action={syncAccountAction.bind(null, a.id)}>
                      <SubmitButton size="sm" variant="secondary">
                        {t('Sync now')}
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={testMarketplaceAction.bind(null, a.id)}>
                      <SubmitButton size="sm" variant="secondary" pendingText={t('Testing…')}>
                        {t('Test')}
                      </SubmitButton>
                    </ActionForm>
                    {admin && (
                      <Link className={buttonClass('secondary', 'sm')} href={`/settings/integrations/marketplace/${a.id}`}>
                        {t('Edit')}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t('Carriers')}
          description={t('Who prints the labels. Allegro Delivery ships Allegro orders only; InPost ships anything.')}
          actions={
            admin && (
              <>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/carrier/new?type=inpost">
                  {t('+ InPost')}
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/carrier/new?type=allegro_shipping">
                  {t('+ Allegro Delivery')}
                </Link>
              </>
            )
          }
        />
        {carriers.length === 0 ? (
          <EmptyState title={t('No carrier accounts yet')} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {carriers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge tone="violet">{CARRIER_LABELS[c.type]}</Badge>
                    {!c.enabled && <Badge>{t('Disabled')}</Badge>}
                    {!c.sender && <Badge tone="red">{t('No sender address')}</Badge>}
                    {!c.configured && (
                      <Badge tone="red">{c.type === 'allegro_shipping' ? t('Allegro account not connected') : t('No API credentials')}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t('Labels:')} {(c.settings.labelFormat ?? 'pdf').toUpperCase()} {c.settings.labelSize ?? 'A6'}
                    {c.sender ? ` · ${t('from {city}', { city: c.sender.city })}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <ActionForm action={testCarrierAction.bind(null, c.id)}>
                    <SubmitButton size="sm" variant="secondary" pendingText={t('Testing…')}>
                      {t('Test')}
                    </SubmitButton>
                  </ActionForm>
                  {admin && (
                    <Link className={buttonClass('secondary', 'sm')} href={`/settings/integrations/carrier/${c.id}`}>
                      {t('Edit')}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
