import { CheckCircle2, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatValue, MARKETPLACE_COLORS } from '@/components/analytics/format';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, Card, CardBody, CardHeader, Field, Input, Select, Textarea, td, th } from '@/components/ui';
import { overdueCustomers, SEGMENTS, segmentCustomers } from '@/lib/crm/segments';
import { shortDay } from '@/lib/tasks/dates';
import { cn, formatDate, MARKETPLACE_LABELS } from '@/lib/utils';
import { can } from '@/lib/permissions';
import { requireUser } from '@/server/auth';
import { allCustomers, loadCustomer } from '@/server/services/customers';
import { listUsers } from '@/server/services/settings';
import { STATUS_LABELS } from '@/server/services/workflow';
import { addNoteAction, addTaskAction, saveTagsAction, toggleTaskAction } from '../actions';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Customer') };
}

const IDENTITY_LABELS: Record<string, string> = { shopify: 'Shopify', allegro: msg('Allegro buyer'), empik: msg('Empik customer'), vonhalsky: 'Von Halsky', hebe: msg('HEBE customer'), email: msg('E-mail') };
const DAY = 86_400_000;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const viewer = await requireUser();
  const showProfit = can(viewer.role, 'profit');
  const { id } = await params;
  const [detail, everyone, users] = await Promise.all([loadCustomer(id), allCustomers(), listUsers()]);
  if (!detail) notFound();
  const { customer: c, identities, orders, notes, tasks, products, addresses } = detail;
  const scored = segmentCustomers(everyone).get(c.id);
  const live = orders.filter((o) => o.status !== 'cancelled').sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
  const gaps = live.slice(1).map((o, i) => (o.placedAt.getTime() - live[i].placedAt.getTime()) / DAY);
  const usualGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const nextExpected = usualGap && c.lastOrderAt ? new Date(c.lastOrderAt.getTime() + usualGap * DAY) : null;
  const overdue = overdueCustomers(new Map([[c.id, live.map((o) => o.placedAt)]])).length > 0;
  const path = `/customers/${c.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/customers" className="text-sm text-slate-500 hover:text-slate-800">
          {t('← All customers')}
        </Link>
        <h2 className="text-xl font-semibold text-slate-900">{c.displayName}</h2>
        {scored && <Badge tone={SEGMENTS[scored.segment].tone}>{t(SEGMENTS[scored.segment].label)}</Badge>}
        {c.marketingConsent && <Badge tone="green">{t('e-mail marketing: yes')}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          [t('Lifetime revenue'), formatValue(c.revenue, 'pln', false, t.locale)],
          ...(showProfit ? [[t('Lifetime profit'), formatValue(c.profit, 'pln', false, t.locale)]] : []),
          [t('Orders'), String(c.ordersCount)],
          [t('Average basket'), c.ordersCount ? formatValue(c.revenue / c.ordersCount, 'pln', false, t.locale) : '—'],
          [t('Usually orders every'), usualGap ? t.plural(Math.round(usualGap), '{n} day', '{n} days') : '—'],
          [t('Next order expected'), nextExpected ? `${formatDate(nextExpected, false, t.locale)}${overdue ? ` (${t('overdue')})` : ''}` : '—'],
        ].map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={cn('mt-1 text-lg font-semibold tabular-nums', label === t('Next order expected') && overdue && 'text-amber-700')}>{value}</p>
          </Card>
        ))}
      </div>
      {scored && <p className="text-sm text-slate-600">{t(SEGMENTS[scored.segment].description)} {t('Next step:')} {t(SEGMENTS[scored.segment].action)}</p>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card className="overflow-x-auto">
            <CardHeader title={t('Orders')} />
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>{t('Date')}</th>
                  <th className={th}>{t('Order')}</th>
                  <th className={th}>{t('Status')}</th>
                  <th className={cn(th, 'text-right')}>{t('Items')}</th>
                  <th className={cn(th, 'text-right')}>{t('Paid')}</th>
                  {showProfit && <th className={cn(th, 'text-right')}>{t('Profit')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className={o.status === 'cancelled' ? 'text-slate-400' : undefined}>
                    <td className={cn(td, 'whitespace-nowrap')}>{formatDate(o.placedAt, false, t.locale)}</td>
                    <td className={td}>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                        {o.externalNumber}
                      </Link>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <span className="inline-block size-2 rounded-sm" style={{ background: MARKETPLACE_COLORS[o.marketplace] }} aria-hidden />
                        {MARKETPLACE_LABELS[o.marketplace] ?? o.marketplace}
                      </span>
                    </td>
                    <td className={td}>{STATUS_LABELS[o.status as keyof typeof STATUS_LABELS] ?? o.status}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{o.items}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {o.totalAmount} {o.currency}
                    </td>
                    {showProfit && <td className={cn(td, 'text-right tabular-nums', (o.profit ?? 0) < 0 && 'text-red-700')}>{o.profit === null ? '—' : formatValue(o.profit, 'pln', false, t.locale)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {products.length > 0 && (
            <Card>
              <CardHeader title={t('What they buy')} />
              <CardBody>
                <ul className="grid grid-cols-1 gap-x-12 gap-y-1 text-sm md:grid-cols-2">
                  {products.map((p) => (
                    <li key={p.name} className="flex justify-between gap-3">
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {t('{n} pcs', { n: p.units })} · {formatValue(p.gross, 'pln', false, t.locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={t('Notes')} />
            <CardBody className="space-y-4">
              <ActionForm action={addNoteAction.bind(null, c.id)} resetOnSuccess showOk={false} className="space-y-2">
                <Textarea name="body" rows={2} placeholder={t('What should the team know about this customer?')} required />
                <SubmitButton size="sm">{t('Add note')}</SubmitButton>
              </ActionForm>
              <ul className="space-y-3">
                {notes.map(({ note, userName }) => (
                  <li key={note.id} className="text-sm">
                    <p className="whitespace-pre-wrap text-slate-800">{note.body}</p>
                    <p className="text-xs text-slate-500">
                      {userName ?? 'Someone'} · {formatDate(note.createdAt, true, t.locale)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title={t('Contact')} />
            <CardBody className="space-y-2 text-sm">
              {c.email ? <p>{c.email}</p> : <p className="text-slate-500">{t('No real e-mail (marketplace relay only)')}</p>}
              {c.phone && <p>{c.phone}</p>}
              {addresses.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500">{t('Delivered to')}</p>
                  <ul className="text-slate-700">
                    {addresses.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-slate-500">{t('Known as')}</p>
                <ul className="text-slate-700">
                  {identities.map((i) => (
                    <li key={i.id}>
                      {t(IDENTITY_LABELS[i.kind] ?? i.kind)}: <span className="font-mono text-xs">{i.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-slate-500">
                {t('Customer since {date}', { date: c.firstOrderAt ? formatDate(c.firstOrderAt, false, t.locale) : '—' })}
                {c.marketplaces.some((m) => m === 'allegro' || m === 'empik' || m === 'hebe') && ` · ${t('Allegro, Empik and HEBE buyer data may only be used to fulfil their orders, not for your own marketing.')}`}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Tags')} description={t('Comma separated. Tags can be written to Shopify (Segments tab).')} />
            <CardBody>
              <ActionForm action={saveTagsAction.bind(null, c.id)} className="flex gap-2">
                <Input name="tags" defaultValue={c.tags.join(', ')} placeholder={t('e.g. wholesale, sensitive-skin')} />
                <SubmitButton size="sm" variant="secondary">
                  {t('Save')}
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Tasks')} />
            <CardBody className="space-y-4">
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <form action={toggleTaskAction.bind(null, task.id, task.status !== 'done', path)}>
                      <button aria-label={task.status === 'done' ? t('Mark as not done') : t('Mark as done')} className="mt-0.5 text-slate-400 hover:text-brand-600">
                        {task.status === 'done' ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4" />}
                      </button>
                    </form>
                    <span className={cn(task.status === 'done' && 'text-slate-400 line-through')}>
                      <Link href={`/tasks/${task.id}`} className="hover:underline">
                        {task.title}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {task.dueDate ? t('due {date}', { date: shortDay(task.dueDate, undefined, t) }) : t('no due date')}
                        {task.assignees.length > 0 && ` · ${task.assignees.map((a) => a.name).join(', ')}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <ActionForm action={addTaskAction.bind(null, c.id)} resetOnSuccess showOk={false} className="space-y-2">
                <Input name="title" placeholder={t('e.g. Send a sample of the new serum')} required aria-label={t('Task')} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('Due')}>
                    <Input name="dueAt" type="date" />
                  </Field>
                  <Field label={t('For')}>
                    <Select name="assigneeId" defaultValue="">
                      <option value="">{t('Anyone')}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <SubmitButton size="sm">{t('Add task')}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
