import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  marketplace?: string;
}

function orderScope(f: AnalyticsFilters) {
  return sql`o.placed_at >= ${f.from.getTime()} and o.placed_at < ${f.to.getTime()}
    ${f.marketplace ? sql`and o.marketplace = ${f.marketplace}` : sql``}`;
}

/** Offset of Europe/Warsaw from UTC in ms at a given moment (CET/CEST). */
export function warsawOffsetMs(at: Date): number {
  const local = new Date(at.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return local.getTime() - utc.getTime();
}

// Amounts are stored as decimal text in the order's own currency; cast for arithmetic and convert to PLN with the
// rate of the order (the one its profit lines were costed at, else the NBP rate on or before the day, else 1).
// Timestamps are ms integers.
const fxRate = `coalesce(
  (select sl.fx_rate from sales_lines sl where sl.order_id = o.id limit 1),
  (select r.rate from fx_rates r where r.currency = o.currency and r.day <= strftime('%Y-%m-%d', o.placed_at / 1000, 'unixepoch') order by r.day desc limit 1),
  case when o.currency = 'PLN' then 1.0 end,
  1.0)`;
const amount = sql.raw(`(cast(o.total_amount as real) * ${fxRate})`);

export async function analytics(f: AnalyticsFilters) {
  const db = getDb();
  const scope = orderScope(f);
  const offset = warsawOffsetMs(f.to);

  const [kpis] = await db.all<{
    orders: number;
    cancelled: number;
    revenue: number | null;
    aov: number | null;
    shipped: number;
    avg_hours_to_ship: number | null;
    currencies: string | null;
  }>(sql`
    select
      sum(case when o.status <> 'cancelled' then 1 else 0 end) as orders,
      sum(case when o.status = 'cancelled' then 1 else 0 end) as cancelled,
      sum(case when o.status <> 'cancelled' then ${amount} end) as revenue,
      avg(case when o.status <> 'cancelled' then ${amount} end) as aov,
      sum(case when o.status in ('shipped', 'delivered') then 1 else 0 end) as shipped,
      avg(case when o.shipped_at is not null then (o.shipped_at - o.placed_at) / 3600000.0 end) as avg_hours_to_ship,
      group_concat(distinct o.currency) as currencies
    from orders o where ${scope}`);

  const daily = await db.all<{ day: string; marketplace: string; orders: number; revenue: number }>(sql`
    select strftime('%Y-%m-%d', (o.placed_at + ${offset}) / 1000, 'unixepoch') as day,
           o.marketplace, count(*) as orders, sum(${amount}) as revenue
    from orders o where ${scope} and o.status <> 'cancelled'
    group by 1, 2 order by 1`);

  const byMarketplace = await db.all<{ marketplace: string; orders: number; revenue: number; aov: number }>(sql`
    select o.marketplace, count(*) as orders, sum(${amount}) as revenue, avg(${amount}) as aov
    from orders o where ${scope} and o.status <> 'cancelled'
    group by 1 order by revenue desc`);

  // Lines without a SKU (every Allegro line) are told apart by product, else by name, never lumped together.
  const itemKey = sql.raw("coalesce(i.product_id, nullif(lower(i.sku), ''), lower(i.name))");
  const itemRevenue = sql.raw(`sum(coalesce(sl.gross, i.quantity * cast(i.unit_price as real) * ${fxRate}))`);
  const topSkus = await db.all<{ sku: string | null; name: string; quantity: number; revenue: number }>(sql`
    select min(i.sku) as sku, coalesce(min(p.name), min(i.name)) as name, sum(i.quantity) as quantity, ${itemRevenue} as revenue
    from order_items i join orders o on o.id = i.order_id
      left join products p on p.id = i.product_id
      left join sales_lines sl on sl.item_id = i.id
    where ${scope} and o.status <> 'cancelled'
    group by ${itemKey} order by quantity desc limit 10`);

  const carriers = await db.all<{ carrier: string; service: string; shipments: number }>(sql`
    select s.carrier, s.service, count(*) as shipments
    from shipments s join orders o on o.id = s.order_id
    where ${scope} and s.state = 'created'
    group by 1, 2 order by shipments desc`);

  const shipTime = await db.all<{ marketplace: string; avg_hours: number; shipped: number }>(sql`
    select o.marketplace, avg((o.shipped_at - o.placed_at) / 3600000.0) as avg_hours, count(*) as shipped
    from orders o where ${scope} and o.shipped_at is not null
    group by 1 order by 1`);

  const backlog = await db.all<{ status: string; orders: number; oldest: number | null }>(sql`
    select o.status, count(*) as orders, min(o.placed_at) as oldest
    from orders o
    where o.status in ('new', 'processing', 'label_created', 'on_hold')
      ${f.marketplace ? sql`and o.marketplace = ${f.marketplace}` : sql``}
    group by 1`);

  return {
    kpis: {
      orders: kpis?.orders ?? 0,
      cancelled: kpis?.cancelled ?? 0,
      revenue: Number(kpis?.revenue ?? 0),
      aov: Number(kpis?.aov ?? 0),
      shipped: kpis?.shipped ?? 0,
      avgHoursToShip: kpis?.avg_hours_to_ship != null ? Number(kpis.avg_hours_to_ship) : null,
      currencies: (kpis?.currencies ?? '').split(',').filter(Boolean),
    },
    daily: [...daily].map((r) => ({ ...r, revenue: Number(r.revenue) })),
    byMarketplace: [...byMarketplace].map((r) => ({ ...r, revenue: Number(r.revenue), aov: Number(r.aov) })),
    topSkus: [...topSkus].map((r) => ({ ...r, revenue: Number(r.revenue) })),
    carriers: [...carriers],
    shipTime: [...shipTime].map((r) => ({ ...r, avgHours: Number(r.avg_hours) })),
    backlog: backlog.map((b) => ({ ...b, oldest: b.oldest !== null ? new Date(b.oldest).toISOString() : null })),
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof analytics>>;
