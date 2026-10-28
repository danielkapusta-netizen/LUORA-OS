import { msg } from '@/lib/i18n/msg';

/** Who may see what. One table, used by the sidebar, the page guards and the data loaders. */
export const ROLES = ['admin', 'logistics', 'marketing'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { admin: msg('Admin'), logistics: msg('Logistics'), marketing: msg('Marketing') };

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: msg('Sees and changes everything.'),
  logistics: msg('Orders, shipments, stock, customers, tasks and invoices. No analytics, pricing, profit or settings; the Dashboard shows what has to be shipped.'),
  marketing: msg('Every page except Settings. Margins in %, but never how much profit was made.'),
};

export const CAPABILITIES = ['analytics', 'profit', 'margin', 'settings', 'fullDashboard', 'pricing'] as const;
export type Capability = (typeof CAPABILITIES)[number];

const GRANTED: Record<Role, readonly Capability[]> = {
  admin: CAPABILITIES,
  logistics: [],
  marketing: ['analytics', 'margin', 'fullDashboard', 'pricing'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Unknown roles (e.g. an old value) get the least access, never the most. */
export function can(role: string | null | undefined, capability: Capability): boolean {
  return isRole(role) && GRANTED[role].includes(capability);
}

export function canSeePath(role: string | null | undefined, href: string): boolean {
  if (href === '/analytics' || href.startsWith('/analytics/')) return can(role, 'analytics');
  if (href === '/settings' || href.startsWith('/settings/')) return can(role, 'settings');
  if (href === '/pricing' || href.startsWith('/pricing/')) return can(role, 'pricing');
  return isRole(role);
}
