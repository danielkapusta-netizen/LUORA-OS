# Luora OS

One place for every order from **Shopify, Allegro and Empik**, with shipping labels bought
through **InPost** and **Allegro Delivery (Wysyłam z Allegro)**.

- **Orders:** every marketplace in one list, synced every few minutes. You can filter, search, assign orders, tag them and add notes.
- **Labels:**
  - The app picks the carrier automatically: Allegro orders go through Allegro Delivery with the buyer's method, parcel-locker orders through InPost Paczkomat, everything else through InPost courier.
  - Staff can override the carrier, service and parcel on any order.
  - Labels come as PDF or ZPL, in A6 or A4.
- **Bulk labels:** select many orders, create all their labels at once, then print them as one PDF.
- **Tracking writeback:** the tracking number goes back to the marketplace and the order is marked shipped. Shopify creates a fulfilment, Allegro gets the waybill and `SENT`, and Empik gets tracking plus a shipment confirmation.
- **Workflow:** `new → processing → label created → shipped → delivered`, plus on hold and cancelled, with a full activity log on every order.
- **Stock sync:**
  - The app's stock is the master; every sale lowers it.
  - The new quantity is pushed to every listing with the same SKU.
  - A dry-run switch per account lets you watch what would be sent before going live.
- **Analytics:** revenue per day by marketplace, average order value, top products, labels by carrier, time to ship, and the open backlog.

## Runs on Cloudflare

| Piece | Cloudflare service |
|---|---|
| Web app (Next.js) | **Workers**, via [OpenNext](https://opennext.js.org/cloudflare) |
| Database | **D1** (SQLite), schema in `src/server/db/schema.ts`, migrations in `drizzle/` |
| Background jobs | **Queues** (`luora-jobs`, with a dead-letter queue) |
| Schedules | **Cron Triggers** (order sync, label sweep, delivery check, nightly stock check) |
| Label files | **R2** (`luora-labels`) |

Queues and Cron Triggers need the **Workers Paid** plan.

## Quick start (demo mode, no accounts needed)

Requirements: Node 22.12+ and pnpm 10. Local D1, Queues and R2 are simulated by wrangler, so no database install is needed.

```bash
pnpm install
cp .dev.vars.example .dev.vars       # INTEGRATIONS_MODE=mock
pnpm db:migrate:local
pnpm db:seed:local                   # admin user, demo accounts, rules, products
pnpm preview                         # the real Worker locally on http://localhost:8787
```

- Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.dev.vars`.
- Crons don't fire on their own locally. Trigger the order sync with
  `curl "localhost:8787/__scheduled?cron=*/3+*+*+*+*"` (run `wrangler dev` with `--test-scheduled`, which `pnpm preview` passes through).
- `pnpm dev` (plain `next dev`) also works for UI work. Background jobs only run under `pnpm preview`.

## Deploying

```bash
npx wrangler login
npx wrangler d1 create luora                 # paste the database_id into wrangler.jsonc
npx wrangler queues create luora-jobs
npx wrangler queues create luora-jobs-dlq
npx wrangler r2 bucket create luora-labels
npx wrangler secret put ENCRYPTION_KEY       # openssl rand -base64 32 — keep it safe
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
# In wrangler.jsonc "vars": set APP_URL to your workers.dev or custom domain, INTEGRATIONS_MODE to "live"
pnpm db:migrate:remote
pnpm deploy
curl -X POST https://<your-app>/api/admin/seed   # first run only: creates the admin user
```

## Connecting real accounts

1. Set `INTEGRATIONS_MODE` to `live` and `APP_URL` to the public address (in `wrangler.jsonc`, or `.dev.vars` locally). Make sure `ENCRYPTION_KEY` is set; credentials are stored encrypted with it.
2. Go to **Settings → Integrations**, add each account, and press **Test**.
3. You can also check an account from the command line (against the local D1 database). This command is read-only: it never changes anything.
   ```bash
   pnpm integration:check "Allegro – main"
   ```

| Account | What you need | Where to get it |
|---|---|---|
| **Shopify** | Shop domain, Client ID, Client secret | Shopify **Dev Dashboard** → create an app, install it on the store. Since January 2026 new apps use client credentials, and tokens expire every 24 h (the app refreshes them automatically). A legacy `shpat_…` token also works. Scopes: `read_orders`, `read_products`, `read_locations`, `write_inventory`, `write_merchant_managed_fulfillment_orders`. For the history import add `read_all_orders` (otherwise Shopify only returns the last 60 days). |
| **Allegro** | Client ID, Client secret | [apps.developer.allegro.pl](https://apps.developer.allegro.pl) (or the sandbox). Set the redirect URI to `APP_URL/api/oauth/allegro/callback`, save the account, then press **Connect Allegro**. For fees and refunds in analytics the app also needs the **Billing (read)** and **Payments (read)** permissions; after enabling them press **Connect Allegro** again. |
| **Empik** | Marketplace URL, API key | Empik seller panel → My account → API key (Empik runs on Mirakl). |
| **InPost** | API token, Organization ID | InPost Manager Paczek → My account → API (ShipX). A sandbox is available. |
| **Allegro Delivery** | A connected Allegro account, an IBAN for cash on delivery | No extra keys: it uses the Allegro account's connection. |

For Shopify you can also add webhooks for `orders/create` and `orders/updated`, pointing at the URL shown on the Integrations page. They make new orders appear within seconds instead of at the next sync.

Parcel locker codes for Shopify orders are read from order note attributes whose key contains `paczkomat`, `inpost_point`, `pickup_point`, and so on (you can change the list per account). If a code isn't found, it can be typed on the order page.

## Analytics data: history, fees and costs

Profit per order needs more than the order itself. This is where each part comes from:

| Data | Source |
|---|---|
| Past orders | **Settings → Integrations → (account) → Import past orders.** A one-off, resumable import of every past order. Past orders are stored with `historical = true` and status Shipped or Cancelled: they never get labels, invoices or stock movements. Open orders from the last few days are left to the regular sync. |
| Marketplace fees | Empik commission and Shopify Payments fees come inside the order. Allegro commission, Smart delivery and promotion charges come from `/billing/billing-entries`, read every two hours (`fees-sync`). Stored in `order_fees`, one row per charge, keyed by the provider's id. |
| Refunds | Shopify and Empik refunds come inside the order; Allegro refunds from `/payments/refunds`. Stored in `order_refunds`. |
| Discounts | Per line (`order_items.discount_amount`) and per order. Prices stay as paid. |
| Exchange rates | NBP table A, stored per day in `fx_rates` (`fx-sync`, nightly). Each order converts at the rate of its day. |
| Product costs | **Settings → Costs & margins.** Landed cost per unit in PLN, dated so that a new cost never rewrites past margins. Enter it by hand (or from a purchase price in USD/EUR/KRW at the NBP rate), paste two columns from a spreadsheet, import the Luora Analytics Google Sheet once, or take Shopify's "Cost per item". |
| Profit settings | Same page: fallback commission per marketplace (only for orders without a reported fee), label and packaging cost, margin targets. VAT comes from the Accounting settings. |

## Dashboard and analytics

The analytics from the former Luora Analytics app (Google Sheet) now run on Luora OS data:

- **Dashboard** (`/`): executive brief, KPIs with sparklines, top products, questions answered from your numbers, business health, risks and opportunities, the business pulse and the channel split, plus today's open orders.
- **Analytics** (`/analytics`): Operations (labels, time to ship, backlog), Action centre, Business review, Products (by product, brand or category, with monthly history), Pricing (price needed for a margin, recommendations, simulator, margin at risk), Trends (any metric with previous period, last year, moving average and projection), Orders P&L, and the pre-purchase Calculator.
- Every order shows its profit breakdown, and Inventory shows each product's margin.

How it fits together: `services/profit.ts` keeps `sales_lines` (profit per order line, PLN) up to date; `src/server/analytics/dataset.ts` turns those lines into the domain model; the calculations in `src/lib/analytics/` are the Luora Analytics domain modules, ported almost unchanged (they keep that project's code style).

## Customers (CRM)

- Every order is linked to a customer (`services/customers.ts`). A buyer is recognised by the marketplace's buyer id (Allegro, Empik) or a real e-mail; Allegro and Empik relay e-mails are never used to join people. The same real e-mail on two marketplaces makes one customer. Orders synced before the CRM are linked in the background (`customers-backfill`, every 15 minutes).
- **Customers** (`/customers`): lifetime revenue and profit, orders, basket, segment, marketplaces and tags; filters, sorting and a CSV export (admins). Each customer has a profile with their orders and profit, what they buy, contact details and identities, notes, tags and tasks.
- **Segments**: VIP, Loyal, Promising, New, One-time, At risk, Can't lose and Lost (by recency, number of orders and spend), monthly cohorts, and regulars who went quiet. **Possible duplicates** lists customers with the same phone, or the same name at the same postcode, to merge. Follow-ups you add on a customer are ordinary tasks (see Tasks), linked back to the customer.
- **Shopify tags**: chosen segments (and optionally staff tags) are written to Shopify customers as tags such as `luora-vip`, for Shopify Email or Klaviyo. It needs the `read_customers` and `write_customers` scopes, starts in dry run, and only covers customers who bought on Shopify: Allegro and Empik buyer data may not be used for your own marketing.

## Tasks

What the team has to do, who is on it and when (`/tasks`, in the sidebar with a badge for your tasks due today or late).

- **Overview**: Projects (cards with the people on them and "N tasks open"), Tags, the tasks of a day as cards (overdue first, then the day, then tasks without a day, then what is coming up), productivity (tasks done today, finished on time, and a bar for each of the last seven days) and a week calendar. Click a day to see it.
- **Board**: To do, In progress and Done as columns of cards. Drag a card to another column; on a touch screen use the card's menu ("Move to…").
- **Calendar**: a month, Monday first, with each day's tasks as chips in the colour of their project; click a day to list it and add a task to it.
- **Projects**: a card per project with progress, open and overdue counts and its people; a project page shows its tasks as a board. Archive a project to hide it; delete is only possible while it has no tasks.
- **A task** has a title, description, status, priority, project, a day with an optional time slot, tags, a checklist, comments, and **several people** it is assigned to. Every change (status, people, day, priority, project) is written to the task's activity trail. A task can be linked to a customer or an order: the order page has a Tasks card, the customer page lists its tasks.
- Filters on every page: everyone, mine, one person or unassigned; a project; a tag; a search. They live in the address, so a view can be shared.
- Anyone who is signed in can create and edit tasks; only the person who created a task, or an admin, can delete it. There are no e-mail notifications: people see their tasks in the sidebar badge and on the Dashboard ("My tasks").
- In demo mode the seed adds two colleagues, four projects and about thirty tasks around today; "Remove demo data" takes them away.

Dates are plain Warsaw days (`YYYY-MM-DD`) and times (`HH:MM`), so the calendar needs no time-zone arithmetic. The code is in `services/tasks.ts` (database), `src/lib/tasks/` (dates, colours, grouping and figures, with no database) and `src/components/tasks/`.

## Publishing products to Allegro and Empik

Inventory → **Publish to Allegro / Empik** (admins) lists the Shopify products that have no offer in that account yet, and creates offers for the ones you tick (25 at a time). Only products the marketplace's catalogue already knows by EAN can be listed; others show "Not in the catalogue". Price = Shopify price + the account's markup % (Settings → Integrations → the account → "Offers created from Shopify"), stock = the master stock; once the offer exists the normal stock sync takes over.

- **Allegro:** the Allegro app needs the permissions "Offers: read and write" and "Seller settings: read" (reconnect Allegro after enabling them). In the account settings press "Load choices from Allegro", then pick the shipping rates, return policy and implied warranty, and fill in where the goods are sent from. Offers are published at once unless "create as drafts" is ticked.
- **Empik:** offers are sent with an OF01 import for the EAN; the offer state code defaults to 11 (new).

## Roles and access

Every user has one role (Settings → Users; admins change it with the Role selector, and the last admin can't be demoted or deleted):

| Role | Sees | Doesn't see |
| --- | --- | --- |
| **Admin** | everything | |
| **Logistics** | Orders, Shipments, Inventory, Customers, Tasks, Accounting. The Dashboard shows only the orders still to send, the parcels per courier and your tasks | Analytics, Settings, and profit or margin anywhere (order page, inventory, customers) |
| **Marketing** | every page except Settings, with margins in % | how much profit was made: profit amounts, columns, charts, and the sentences and findings that quote them |

The rules live in one table, `src/lib/permissions.ts`, used by the sidebar, the page guards (`requireCapability`) and the data loaders. For marketing the profit figures are removed on the server (`src/server/analytics/view.ts`, `src/lib/analytics/redact.ts`), not just hidden, so they never reach the browser. Courier names come from the delivery method the buyer chose (`src/lib/couriers.ts`).

Migration `0012_roles` turns the old `staff` users into `logistics`.

## How it works

```
One Worker (src/worker/cloudflare.ts)
   ├─ fetch      Next.js app: UI, server actions, API routes      ─┐
   ├─ scheduled  Cron Triggers → sync all accounts, label sweep,    ├── D1 (orders, labels, stock, job locks)
   │             delivery check, nightly stock reconcile           │   R2 (label PDFs/ZPL)
   └─ queue      luora-jobs consumer:                              ─┘
        orders-sync      upsert orders, take stock
        shipment-create  buy label → shipment-poll until the carrier confirms → store file in R2
        tracking-push    tracking number → marketplace, order → shipped
        stock-push       master stock → every linked listing (debounced per account)
```

- Each marketplace and carrier has an adapter in `src/server/integrations/`, made of three files:
  - `client.ts`: authentication, token refresh and retries.
  - `mapper.ts`: provider JSON ↔ the app's own types.
  - `adapter.ts`: the actions the rest of the app calls.
- The rest of the app only talks to the `MarketplaceAdapter` and `CarrierAdapter` interfaces.
- Business logic lives in `src/server/services/`: `orders`, `shipping`, `routing`, `workflow`, `tracking`, `inventory` and `analytics`, plus `history`, `fees`, `fx` and `costs` for the analytics data.

Guards against buying a label twice:

- **Duplicate clicks:** the database allows only one live label per order.
- **Allegro retries:** Allegro label requests reuse the label's own id as the command id.
- **InPost retries:** InPost label requests are never retried automatically.
- **Stuck labels:** a sweep job re-checks labels left "pending" (for example when a poll message ran out of retries) instead of buying again.

D1 has no interactive transactions, so writes that belong together (a new order with its items, stock changes, a finished label) go in one `db.batch()`. Status changes are compare-and-set on the old status. Cloudflare Queues has no built-in dedupe, so one-sync-per-account and the stock-push debounce use a small `job_locks` table.

Why each API endpoint was chosen:

| Marketplace / carrier | Endpoints |
|---|---|
| **Allegro** | `/order/events` journal plus `/order/checkout-forms`; `/shipment-management/*` for labels |
| **Empik (Mirakl)** | OR11 (orders), OR21 (accept), OR23 + OR24 (tracking and shipment). Stock uses the **STO01** CSV import, not OF24, because OF24 resets every offer field you don't send. |
| **InPost ShipX** | `POST /v1/organizations/{id}/shipments`, polled until `confirmed`. InPost is moving merchants to its new Global API; that would be one more adapter behind the same interface. |

## Testing

```bash
pnpm lint && pnpm typecheck
pnpm test          # unit, mocked-HTTP adapter tests, queue consumer, and the full flow on local D1 + R2
pnpm preview &     # then, in mock mode, after migrating and seeding local D1:
E2E_BASE_URL=http://localhost:8787 PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e
```

The adapter tests check requests and responses against payloads written from each provider's API documentation.

**Before going live, run one order through each sandbox.** Some request fields are the most likely to need adjusting against the real APIs, especially:

- InPost parcel and address options,
- Allegro shipment-management package fields,
- Mirakl carrier codes.

## Project layout

```
src/app/(app)/         orders, shipments, inventory, analytics, settings pages
src/app/api/           label downloads, Allegro OAuth, Shopify webhooks, first-run seed, health check
src/server/db/         Drizzle schema (D1/SQLite), seed
src/server/cf.ts       access to the D1 / Queue / R2 bindings
src/server/integrations/{marketplaces,carriers}/   one folder per provider (+ mock)
src/server/services/   business logic
src/server/jobs/       job names, enqueue (Cloudflare Queues), handlers
src/worker/            Worker entry: OpenNext fetch + queue consumer + cron
tests/                 Vitest (unit, adapter, consumer, D1 flow) and Playwright (e2e)
drizzle/               D1 migrations (generate with `pnpm db:generate`)
wrangler.jsonc         bindings, crons and vars
```
