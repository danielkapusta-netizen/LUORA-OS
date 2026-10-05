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

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
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
              {demoCount} demo account(s) from the first setup are still here. Their carriers can&apos;t buy real labels, and shipping rules
              that point at them are skipped.
            </span>
            <ActionForm action={removeDemoDataAction}>
              <SubmitButton size="sm" variant="danger" confirm="Delete all demo accounts, their orders, labels and shipping rules?">
                Remove demo accounts
              </SubmitButton>
            </ActionForm>
          </div>
        </Alert>
      )}
      {isMockMode() && (
        <Alert>
          Demo mode (<code>INTEGRATIONS_MODE=mock</code>): orders and labels are generated locally and nothing is sent to Shopify, Allegro,
          Empik or InPost. Set <code>INTEGRATIONS_MODE=live</code> to use real accounts.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Marketplaces"
          description="Where orders come from. Each account is synced every few minutes."
          actions={
            admin && (
              <>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=shopify">
                  + Shopify
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=allegro">
                  + Allegro
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=empik">
                  + Empik
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/marketplace/new?type=vonhalsky">
                  + Von Halsky
                </Link>
              </>
            )
          }
        />
        {marketplaces.length === 0 ? (
          <EmptyState title="No marketplace accounts yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {marketplaces.map((a) => {
              const keys = storedCredentialKeys(a.credentials);
              const allegroConnected = a.type === 'allegro' && keys.includes('refreshToken');
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <MarketplaceBadge marketplace={a.type} />
                      {!a.enabled && <Badge>Disabled</Badge>}
                      {a.stockSyncEnabled && <Badge tone={a.stockDryRun ? 'amber' : 'green'}>{a.stockDryRun ? 'Stock: dry run' : 'Stock sync on'}</Badge>}
                      {a.type === 'allegro' && !isMockMode() && (allegroConnected ? <Badge tone="green">Connected</Badge> : <Badge tone="red">Not connected</Badge>)}
                    </div>
                    <p className="text-xs text-slate-500">Last sync {timeAgo(a.lastSyncedAt)}</p>
                    {a.lastError && <p className="text-xs text-red-700">Error: {a.lastError}</p>}
                    {a.type === 'shopify' && (
                      <p className="text-xs text-slate-500">
                        Webhook URL (orders/create, orders/updated): <code className="select-all">{`${env().APP_URL}/api/webhooks/shopify/${a.id}`}</code>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {a.type === 'allegro' && admin && !isMockMode() && (
                      <a className={buttonClass(allegroConnected ? 'secondary' : 'primary', 'sm')} href={`/api/oauth/allegro/start?accountId=${a.id}`}>
                        {allegroConnected ? 'Reconnect Allegro' : 'Connect Allegro'}
                      </a>
                    )}
                    <ActionForm action={syncAccountAction.bind(null, a.id)}>
                      <SubmitButton size="sm" variant="secondary">
                        Sync now
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={testMarketplaceAction.bind(null, a.id)}>
                      <SubmitButton size="sm" variant="secondary" pendingText="Testing…">
                        Test
                      </SubmitButton>
                    </ActionForm>
                    {admin && (
                      <Link className={buttonClass('secondary', 'sm')} href={`/settings/integrations/marketplace/${a.id}`}>
                        Edit
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
          title="Carriers"
          description="Who prints the labels. Allegro Delivery ships Allegro orders only; InPost ships anything."
          actions={
            admin && (
              <>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/carrier/new?type=inpost">
                  + InPost
                </Link>
                <Link className={buttonClass('secondary', 'sm')} href="/settings/integrations/carrier/new?type=allegro_shipping">
                  + Allegro Delivery
                </Link>
              </>
            )
          }
        />
        {carriers.length === 0 ? (
          <EmptyState title="No carrier accounts yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {carriers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge tone="violet">{CARRIER_LABELS[c.type]}</Badge>
                    {!c.enabled && <Badge>Disabled</Badge>}
                    {!c.sender && <Badge tone="red">No sender address</Badge>}
                    {!c.configured && (
                      <Badge tone="red">{c.type === 'allegro_shipping' ? 'Allegro account not connected' : 'No API credentials'}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Labels: {(c.settings.labelFormat ?? 'pdf').toUpperCase()} {c.settings.labelSize ?? 'A6'}
                    {c.sender ? ` · from ${c.sender.city}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <ActionForm action={testCarrierAction.bind(null, c.id)}>
                    <SubmitButton size="sm" variant="secondary" pendingText="Testing…">
                      Test
                    </SubmitButton>
                  </ActionForm>
                  {admin && (
                    <Link className={buttonClass('secondary', 'sm')} href={`/settings/integrations/carrier/${c.id}`}>
                      Edit
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
