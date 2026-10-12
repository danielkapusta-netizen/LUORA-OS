// The customer list with segments, filtered and sorted in memory (customer counts are small).
import { segmentCustomers, type Scored, type SegmentKey } from '@/lib/crm/segments';
import type { Customer } from '../db/schema';
import { allCustomers } from './customers';

export interface CustomerFilter {
  q?: string;
  segment?: string;
  marketplace?: string;
  tag?: string;
  sort?: string;
}

export interface CustomerRow {
  customer: Customer;
  scored: Scored | undefined;
}

export const CUSTOMER_SORTS = [
  { value: 'last', label: 'Last order' },
  { value: 'revenue', label: 'Lifetime revenue' },
  { value: 'profit', label: 'Lifetime profit' },
  { value: 'orders', label: 'Orders' },
];

export async function customerRows(filter: CustomerFilter = {}, now = new Date()): Promise<{ rows: CustomerRow[]; all: CustomerRow[] }> {
  const list = await allCustomers();
  const segments = segmentCustomers(list, now);
  const all = list.map((customer) => ({ customer, scored: segments.get(customer.id) }));
  const q = filter.q?.trim().toLowerCase();
  const rows = all
    .filter(({ customer: c }) => !q || `${c.displayName} ${c.email ?? ''} ${c.phone ?? ''} ${c.city ?? ''}`.toLowerCase().includes(q))
    .filter((r) => !filter.segment || r.scored?.segment === (filter.segment as SegmentKey))
    .filter((r) => !filter.marketplace || r.customer.marketplaces.includes(filter.marketplace))
    .filter((r) => !filter.tag || r.customer.tags.includes(filter.tag))
    .sort((a, b) => {
      const x = a.customer;
      const y = b.customer;
      if (filter.sort === 'revenue') return y.revenue - x.revenue;
      if (filter.sort === 'profit') return y.profit - x.profit;
      if (filter.sort === 'orders') return y.ordersCount - x.ordersCount || y.revenue - x.revenue;
      return (y.lastOrderAt?.getTime() ?? 0) - (x.lastOrderAt?.getTime() ?? 0);
    });
  return { rows, all };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function customersCsv(rows: CustomerRow[]): string {
  const header = ['Name', 'E-mail', 'Phone', 'City', 'Country', 'Marketplaces', 'Segment', 'Orders', 'Revenue PLN', 'Profit PLN', 'First order', 'Last order', 'Tags'];
  const lines = rows.map(({ customer: c, scored }) =>
    [c.displayName, c.email, c.phone, c.city, c.countryCode, c.marketplaces.join(' '), scored?.segment ?? '', c.ordersCount, c.revenue.toFixed(2), c.profit.toFixed(2), c.firstOrderAt, c.lastOrderAt, c.tags.join(' ')]
      .map(csvCell)
      .join(';'),
  );
  return `﻿${[header.join(';'), ...lines].join('\n')}\n`;
}
