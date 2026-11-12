// What stands between Luora's stock and the marketplaces: per account whether stock gets through, and what the last
// full update found when it read every marketplace back.
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { msg } from '@/lib/i18n/msg';
import type { T } from '@/lib/i18n/translate';
import { cn, formatDate } from '@/lib/utils';
import type { MarketplaceAccount, StockSyncAccountResult, StockSyncRun } from '@/server/db/schema';
import type { StockSyncStatus } from '@/server/services/inventory';

const STEP: Record<StockSyncAccountResult['step'], string> = {
  waiting: msg('waiting'),
  reading: msg('reading offers'),
  sending: msg('sending stock'),
  checking: msg('checking'),
  done: msg('done'),
  failed: msg('failed'),
  skipped: msg('read only'),
};

/** What the update found for one marketplace, in a few words. */
function outcome(a: StockSyncAccountResult, t: T): { text: string; ok: boolean } {
  if (a.step === 'failed') return { text: a.error ?? t('failed'), ok: false };
  const differ = a.differing ? t('{n} differ', { n: a.differing }) : '';
  if (a.step === 'skipped') return { text: [t('stock sync off'), differ].filter(Boolean).join(', '), ok: false };
  if (!a.live) return { text: a.differing ? t('not sent yet, {n} differ', { n: a.differing }) : t('not sent yet, all {n} match', { n: a.matching }), ok: false };
  const parts = [t('{n} match', { n: a.matching }), differ, a.refused ? t('{n} refused', { n: a.refused }) : ''].filter(Boolean);
  return { text: parts.join(', '), ok: a.differing === 0 && a.refused === 0 };
}

export function SyncPanel({
  accounts,
  status,
  pending,
  run,
  t,
}: {
  accounts: MarketplaceAccount[];
  status: Map<string, StockSyncStatus>;
  pending: Map<string, number>;
  run: StockSyncRun | null;
  t: T;
}) {
  if (accounts.length === 0) return null;
  const running = run?.status === 'running';
  const problems = running || !run ? [] : run.accounts.flatMap((a) => (a.problems ?? []).map((p) => ({ ...p, account: a.name })));
  return (
    <section className="mb-5 rounded-3xl border border-black/[0.06] bg-white px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {accounts.map((a) => {
          const s = status.get(a.id);
          const waiting = pending.get(a.id) ?? 0;
          const state = !a.stockSyncEnabled ? 'off' : a.stockDryRun ? 'dry' : s?.failing ? 'failing' : 'ok';
          const tone = state === 'failing' ? 'red' : state === 'ok' ? (waiting ? 'amber' : 'green') : 'amber';
          const label =
            state === 'off'
              ? t('Stock sync off')
              : state === 'dry'
                ? t('Not sent yet')
                : state === 'failing'
                  ? t.plural(s!.failing, '{n} offer refused', '{n} offers refused')
                  : waiting
                    ? t('{n} to send', { n: waiting })
                    : t('Up to date');
          const title = [s?.lastSuccessAt ? t('Last sent {time}', { time: formatDate(s.lastSuccessAt, true, t.locale) }) : t('Never sent'), s?.firstError ?? ''].filter(Boolean).join(' · ');
          return (
            <span key={a.id} title={title} className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white py-1 pr-1 pl-2.5 text-xs">
              <span className="font-medium text-ink">{a.name}</span>
              <Badge tone={tone}>{label}</Badge>
            </span>
          );
        })}
      </div>

      {run && (
        <div className="mt-2.5 text-xs text-slate-600" role="status">
          {running ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                {t('Updating every marketplace…')}
              </span>
              {run.accounts.map((a) => (
                <span key={a.accountId}>
                  {a.name}: {t(STEP[a.step])}
                </span>
              ))}
            </p>
          ) : run.status === 'failed' ? (
            <p className="flex items-center gap-1.5 text-red-700">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              {t('The update started {time} did not finish. Press “Update all stock” to run it again.', { time: formatDate(run.startedAt, true, t.locale) })}
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{t('Last full update {time}', { time: formatDate(run.finishedAt ?? run.startedAt, true, t.locale) })}</span>
                {run.accounts.map((a) => {
                  const o = outcome(a, t);
                  return (
                    <span key={a.accountId} className={cn('inline-flex items-center gap-1', a.step === 'failed' && 'text-red-700')}>
                      {o.ok ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <CircleAlert className={cn('size-3.5', a.step === 'failed' ? 'text-red-600' : 'text-amber-600')} aria-hidden />}
                      {a.name}: {o.text}
                    </span>
                  );
                })}
              </p>
              {problems.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer font-medium text-ink">{t('Show what differs')}</summary>
                  <ul className="mt-1.5 space-y-1">
                    {problems.map((p, i) => (
                      <li key={i}>
                        <span className="font-medium text-ink">{p.account}</span> · {p.title}: {t('shows {has}, should show {want}', { has: p.has ?? '?', want: p.want })}
                        {p.reason && <span className="text-red-700"> · {p.reason}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
