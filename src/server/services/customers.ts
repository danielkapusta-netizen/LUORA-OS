// CRM customers: every order is linked to a customer, recognised by the marketplace's buyer id or
// a real e-mail. Allegro and Empik send relay e-mails (one per buyer, never the real address), so
// those are not used to join people across marketplaces; a real e-mail on two marketplaces is.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { chunk, getDb } from '../db/client';
import {
  customerIdentities,
  customerNotes,
  customers,
  orders,
  salesLines,
  tasks,
  users,
  type Customer,
  type CustomerIdentityKind,
  type Order,
} from '../db/schema';
import { listTasks } from './tasks';

/** E-mail domains that are marketplace relays, not the buyer's own address. */
const RELAY = /@(.+\.)?(allegromail\.(pl|com)|allegro\.pl|mirakl\.net|empik\.com|marketplace\.empik\.com|inpost\.pl|members\.ebay\.com)$/i;

export function realEmail(email: string | null | undefined): string | null {
  const clean = email?.trim().toLowerCase();
  if (!clean || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean) || RELAY.test(clean)) return null;
  return clean;
}

/** Digits of a phone number without the Polish prefix, for comparing ("+48 600 100 200" → "600100200"). */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

export interface IdentityKey {
  kind: CustomerIdentityKind;
  value: string;
}

/** The keys an order's buyer is recognised by, strongest first. */
export function identityKeys(o: Pick<Order, 'marketplace' | 'buyer' | 'shippingAddress' | 'raw'>): IdentityKey[] {
  const raw = (o.raw ?? {}) as { buyer?: { id?: string; login?: string }; customer?: { customer_id?: string | number } };
  const keys: IdentityKey[] = [];
  if (o.marketplace === 'allegro') {
    const id = raw.buyer?.id ?? raw.buyer?.login ?? o.buyer.login;
    if (id) keys.push({ kind: 'allegro', value: String(id) });
  } else if (o.marketplace === 'empik') {
    const id = raw.customer?.customer_id;
    if (id !== undefined && id !== null && String(id)) keys.push({ kind: 'empik', value: String(id) });
  }
  const email = realEmail(o.buyer.email) ?? realEmail(o.shippingAddress.email);
  if (email) keys.push({ kind: 'email', value: email });
  if (!keys.length) {
    // Nothing stable: the same name at the same postcode is the best guess.
    const name = (o.buyer.name || o.shippingAddress.name).trim().toLowerCase();
    keys.push({ kind: o.marketplace, value: `${name}|${o.shippingAddress.postalCode}` });
  }
  return keys;
}

/** Links these orders to customers (creating or merging customers as needed), then refreshes their totals. */
export async function resolveCustomers(orderIds: string[]): Promise<{ linked: number; created: number; merged: number }> {
  const db = getDb();
  const result = { linked: 0, created: 0, merged: 0 };
  const touched = new Set<string>();
  for (const ids of chunk([...new Set(orderIds)], 60)) {
    const rows = await db.select().from(orders).where(inArray(orders.id, ids)).orderBy(asc(orders.placedAt));
    for (const o of rows) {
      const keys = identityKeys(o);
      const found = await db
        .select({ customerId: customerIdentities.customerId, kind: customerIdentities.kind, value: customerIdentities.value })
        .from(customerIdentities)
        .where(sql`(${customerIdentities.kind}, ${customerIdentities.value}) in (${sql.join(keys.map((k) => sql`(${k.kind}, ${k.value})`), sql`, `)})`);
      let ids = [...new Set(found.map((f) => f.customerId))];
      if (o.customerId && !ids.includes(o.customerId)) ids = [o.customerId, ...ids];
      let customerId: string;
      if (!ids.length) {
        const email = realEmail(o.buyer.email) ?? realEmail(o.shippingAddress.email);
        const [created] = await db
          .insert(customers)
          .values({
            displayName: o.buyer.name || o.shippingAddress.name || 'Buyer',
            email,
            phone: o.buyer.phone ?? o.shippingAddress.phone ?? null,
            city: o.shippingAddress.city || null,
            countryCode: o.shippingAddress.countryCode || null,
          })
          .returning({ id: customers.id });
        customerId = created.id;
        result.created++;
      } else if (ids.length === 1) {
        customerId = ids[0];
      } else {
        customerId = await mergeInto(ids);
        result.merged += ids.length - 1;
      }
      for (const k of keys) {
        await db.insert(customerIdentities).values({ customerId, kind: k.kind, value: k.value }).onConflictDoNothing();
      }
      if (o.customerId !== customerId) {
        await db.update(orders).set({ customerId }).where(eq(orders.id, o.id));
        await db.update(salesLines).set({ customerId }).where(eq(salesLines.orderId, o.id));
        result.linked++;
      }
      touched.add(customerId);
    }
  }
  await refreshCustomerStats([...touched]);
  return result;
}

/** Merges customers into the oldest of them; returns the one kept. */
async function mergeInto(ids: string[]): Promise<string> {
  const db = getDb();
  const rows = await db.select().from(customers).where(inArray(customers.id, ids)).orderBy(asc(customers.createdAt));
  if (!rows.length) return ids[0];
  const [target, ...sources] = rows;
  await mergeCustomers(target.id, sources.map((s) => s.id), rows);
  return target.id;
}

/** Moves orders, identities, notes and tasks of `sourceIds` to `targetId` and deletes the sources. */
export async function mergeCustomers(targetId: string, sourceIds: string[], known?: Customer[]): Promise<void> {
  const db = getDb();
  const sources = sourceIds.filter((id) => id !== targetId);
  if (!sources.length) return;
  const all = known ?? (await db.select().from(customers).where(inArray(customers.id, [targetId, ...sources])));
  const target = all.find((c) => c.id === targetId);
  if (!target) throw new Error('Customer not found');
  const tags = [...new Set(all.flatMap((c) => c.tags))];
  const email = target.email ?? all.find((c) => c.email)?.email ?? null;
  // Identities that both have would collide on the unique key: drop the source's copy first.
  await db.run(sql`
    delete from ${customerIdentities} where customer_id in ${sources}
      and exists (select 1 from ${customerIdentities} t where t.customer_id = ${targetId} and t.kind = ${customerIdentities.kind} and t.value = ${customerIdentities.value})`);
  await db.batch([
    db.update(orders).set({ customerId: targetId }).where(inArray(orders.customerId, sources)),
    db.update(salesLines).set({ customerId: targetId }).where(inArray(salesLines.customerId, sources)),
    db.update(customerIdentities).set({ customerId: targetId }).where(inArray(customerIdentities.customerId, sources)),
    db.update(customerNotes).set({ customerId: targetId }).where(inArray(customerNotes.customerId, sources)),
    db.update(tasks).set({ customerId: targetId }).where(inArray(tasks.customerId, sources)),
    db.update(customers).set({ tags, email }).where(eq(customers.id, targetId)),
    db.delete(customers).where(inArray(customers.id, sources)),
  ]);
  await refreshCustomerStats([targetId]);
}

/** Recomputes orders, revenue, profit, dates, marketplaces and the latest contact details. */
export async function refreshCustomerStats(customerIds: string[]): Promise<void> {
  const db = getDb();
  for (const ids of chunk([...new Set(customerIds)])) {
    const counts = await db
      .select({
        customerId: orders.customerId,
        orders: sql<number>`count(*)`,
        first: sql<number>`min(${orders.placedAt})`,
        last: sql<number>`max(${orders.placedAt})`,
        marketplaces: sql<string>`group_concat(distinct ${orders.marketplace})`,
      })
      .from(orders)
      .where(and(inArray(orders.customerId, ids), ne(orders.status, 'cancelled')))
      .groupBy(orders.customerId);
    const money = await db
      .select({ customerId: salesLines.customerId, revenue: sql<number>`sum(${salesLines.gross})`, profit: sql<number>`sum(${salesLines.profit})` })
      .from(salesLines)
      .where(inArray(salesLines.customerId, ids))
      .groupBy(salesLines.customerId);
    const latest = await db.all<{ customerId: string; name: string; phone: string | null; city: string; country: string }>(sql`
      select o.customer_id as customerId, json_extract(o.buyer, '$.name') as name,
        coalesce(json_extract(o.buyer, '$.phone'), json_extract(o.shipping_address, '$.phone')) as phone,
        json_extract(o.shipping_address, '$.city') as city, json_extract(o.shipping_address, '$.countryCode') as country
      from ${orders} o
      where o.customer_id in ${ids}
        and o.placed_at = (select max(p.placed_at) from ${orders} p where p.customer_id = o.customer_id)`);
    const byCount = new Map(counts.map((c) => [c.customerId!, c]));
    const byMoney = new Map(money.map((m) => [m.customerId!, m]));
    const byLatest = new Map(latest.map((l) => [l.customerId, l]));
    for (const id of ids) {
      const c = byCount.get(id);
      const m = byMoney.get(id);
      const l = byLatest.get(id);
      await db
        .update(customers)
        .set({
          ordersCount: c?.orders ?? 0,
          firstOrderAt: c ? new Date(c.first) : null,
          lastOrderAt: c ? new Date(c.last) : null,
          marketplaces: c?.marketplaces ? c.marketplaces.split(',').sort() : [],
          revenue: Math.round((m?.revenue ?? 0) * 100) / 100,
          profit: Math.round((m?.profit ?? 0) * 100) / 100,
          ...(l ? { displayName: l.name || undefined, phone: l.phone, city: l.city || null, countryCode: l.country || null } : {}),
        })
        .where(eq(customers.id, id));
    }
  }
}

/** Links orders that have no customer yet (older orders, after the CRM arrived), oldest first. */
export async function resolveMissingCustomers(limit = 300): Promise<{ resolved: number; remaining: boolean }> {
  const ids = (
    await getDb().select({ id: orders.id }).from(orders).where(isNull(orders.customerId)).orderBy(asc(orders.placedAt)).limit(limit)
  ).map((r) => r.id);
  if (ids.length) await resolveCustomers(ids);
  return { resolved: ids.length, remaining: ids.length === limit };
}

// ---------------------------------------------------------------- reading

export async function loadCustomer(id: string) {
  const db = getDb();
  const [customer] = await db.select().from(customers).where(eq(customers.id, id));
  if (!customer) return null;
  const [identities, orderRows, notes, customerTasks, products] = await Promise.all([
    db.select().from(customerIdentities).where(eq(customerIdentities.customerId, id)),
    db.all<{ id: string; externalNumber: string; marketplace: string; status: string; placedAt: number; totalAmount: string; currency: string; gross: number | null; profit: number | null; items: number }>(sql`
      select o.id, o.external_number as externalNumber, o.marketplace, o.status, o.placed_at as placedAt, o.total_amount as totalAmount, o.currency,
        (select sum(gross) from ${salesLines} l where l.order_id = o.id) as gross,
        (select sum(profit) from ${salesLines} l where l.order_id = o.id) as profit,
        (select sum(quantity) from order_items i where i.order_id = o.id) as items
      from ${orders} o where o.customer_id = ${id} order by o.placed_at desc`),
    db
      .select({ note: customerNotes, userName: users.name })
      .from(customerNotes)
      .leftJoin(users, eq(users.id, customerNotes.userId))
      .where(eq(customerNotes.customerId, id))
      .orderBy(desc(customerNotes.createdAt)),
    listTasks({ customerId: id }),
    db.all<{ name: string; units: number; gross: number }>(sql`
      select coalesce(p.name, i.name) as name, sum(l.quantity) as units, sum(l.gross) as gross
      from ${salesLines} l join order_items i on i.id = l.item_id left join products p on p.id = l.product_id
      where l.customer_id = ${id} group by coalesce(l.product_id, i.name) order by units desc limit 8`),
  ]);
  const addresses = await db.all<{ address: string }>(sql`
    select distinct json_extract(shipping_address, '$.street') || ', ' || json_extract(shipping_address, '$.postalCode') || ' ' || json_extract(shipping_address, '$.city') as address
    from ${orders} where customer_id = ${id} limit 10`);
  return { customer, identities, orders: orderRows.map((o) => ({ ...o, placedAt: new Date(o.placedAt) })), notes, tasks: customerTasks, products, addresses: addresses.map((a) => a.address) };
}

export async function allCustomers(): Promise<Customer[]> {
  return getDb().select().from(customers).orderBy(desc(customers.lastOrderAt));
}

/** Every customer's order dates, oldest first (cancelled orders left out), for cohorts and gaps. */
export async function orderDatesByCustomer(): Promise<Map<string, Date[]>> {
  const rows = await getDb()
    .select({ customerId: orders.customerId, placedAt: orders.placedAt })
    .from(orders)
    .where(and(ne(orders.status, 'cancelled'), sql`${orders.customerId} is not null`))
    .orderBy(asc(orders.placedAt));
  const out = new Map<string, Date[]>();
  for (const r of rows) out.set(r.customerId!, [...(out.get(r.customerId!) ?? []), r.placedAt]);
  return out;
}

/** Pairs of customers that are probably one person: the same phone, or the same name at the same postcode. */
export async function duplicateSuggestions(limit = 50) {
  const rows = await getDb().all<{ customerId: string; name: string; phone: string | null; postalCode: string }>(sql`
    select distinct o.customer_id as customerId, lower(trim(json_extract(o.buyer, '$.name'))) as name,
      coalesce(json_extract(o.buyer, '$.phone'), json_extract(o.shipping_address, '$.phone')) as phone,
      json_extract(o.shipping_address, '$.postalCode') as postalCode
    from ${orders} o where o.customer_id is not null`);
  const groups = new Map<string, Set<string>>();
  const add = (key: string | null, id: string) => {
    if (!key) return;
    groups.set(key, (groups.get(key) ?? new Set()).add(id));
  };
  for (const r of rows) {
    add(phoneKey(r.phone) && `phone:${phoneKey(r.phone)}`, r.customerId);
    if (r.name && r.postalCode) add(`name:${r.name}|${r.postalCode}`, r.customerId);
  }
  const pairs = new Map<string, { ids: string[]; reason: string }>();
  for (const [key, ids] of groups) {
    if (ids.size < 2) continue;
    const list = [...ids].sort();
    const id = list.join('|');
    if (!pairs.has(id)) pairs.set(id, { ids: list, reason: key.startsWith('phone:') ? 'Same phone number' : 'Same name and postcode' });
  }
  const wanted = [...pairs.values()].slice(0, limit);
  const people = new Map((await getDb().select().from(customers).where(inArray(customers.id, [...new Set(wanted.flatMap((p) => p.ids))].slice(0, 400)))).map((c) => [c.id, c]));
  return wanted.map((p) => ({ reason: p.reason, customers: p.ids.map((id) => people.get(id)).filter((c): c is Customer => Boolean(c)) })).filter((p) => p.customers.length > 1);
}

// ---------------------------------------------------------------- notes and tags (tasks live in services/tasks.ts)

export async function addCustomerNote(customerId: string, body: string, userId: string): Promise<void> {
  const text = body.trim();
  if (text) await getDb().insert(customerNotes).values({ customerId, body: text, userId });
}

export async function setCustomerTags(customerId: string, tags: string[]): Promise<void> {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
  await getDb().update(customers).set({ tags: clean }).where(eq(customers.id, customerId));
}
