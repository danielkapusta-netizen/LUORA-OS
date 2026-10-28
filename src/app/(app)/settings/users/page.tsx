import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { listUsers } from '@/server/services/settings';
import { createUserAction, deleteUserAction, resetPasswordAction, setRoleAction } from '../actions';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Users') };
}

export default async function UsersPage() {
  const t = await getT();
  const me = await requireUser();
  const users = await listUsers();
  const admin = me.role === 'admin';

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader title={t('Team')} description={t('What each role can see is shown below. Admins also manage integrations, rules and users.')} />
        <ul className="divide-y divide-slate-100">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {u.name} {u.id === me.id && <span className="text-xs text-slate-500">{t('(you)')}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {u.email} · {t('added {date}', { date: formatDate(u.createdAt, false, t.locale) })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!admin && <Badge tone={u.role === 'admin' ? 'violet' : 'gray'}>{t(ROLE_LABEL[u.role])}</Badge>}
                {admin && (
                  <>
                    <ActionForm action={setRoleAction.bind(null, u.id)} className="flex gap-1.5" showOk={false}>
                      <Select name="role" defaultValue={u.role} className="h-8 w-32" aria-label={t('Role of {name}', { name: u.name })}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(ROLE_LABEL[r])}
                          </option>
                        ))}
                      </Select>
                      <SubmitButton size="sm" variant="secondary">
                        {t('Save')}
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={resetPasswordAction.bind(null, u.id)} className="flex gap-1.5" resetOnSuccess>
                      <Input name="password" type="password" placeholder={t('New password')} className="h-8 w-40" minLength={8} required autoComplete="new-password" />
                      <SubmitButton size="sm" variant="secondary">
                        {t('Set')}
                      </SubmitButton>
                    </ActionForm>
                    {u.id !== me.id && (
                      <ActionForm action={deleteUserAction.bind(null, u.id)} showOk={false}>
                        <SubmitButton size="sm" variant="danger" confirm={t('Delete {name}?', { name: u.name })}>
                          {t('Delete')}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t('Roles')} />
        <dl className="divide-y divide-slate-100 text-sm">
          {ROLES.map((r) => (
            <div key={r} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
              <dt className="font-medium">{t(ROLE_LABEL[r])}</dt>
              <dd className="text-slate-600">{t(ROLE_DESCRIPTION[r])}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {admin && (
        <Card>
          <CardHeader title={t('Add a user')} />
          <CardBody>
            <ActionForm action={createUserAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('Name')}>
                <Input name="name" required />
              </Field>
              <Field label={t('Email')}>
                <Input name="email" type="email" required />
              </Field>
              <Field label={t('Password')} hint={t('At least 8 characters')}>
                <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
              </Field>
              <Field label={t('Role')}>
                <Select name="role" defaultValue="logistics">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(ROLE_LABEL[r])}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <SubmitButton>{t('Add user')}</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
