# Reconciliation: Luora Analytics sheet vs LUORA OS

Date: 2026-10-07. Window: 2026-09-01 to 2026-10-06.
Aggregates only. No names, e-mails or order ids.

## What was compared

- **Sheet:** the Apps Script `transactions` feed used by Luora Analytics (Allegro and Empik, 5,659 lines in total).
- **LUORA OS:** the production D1 database `luora` (read-only SELECTs). It still has the old schema, so the new profit engine could not run on it. The comparison uses the synced orders (prices, quantities, currency, country, Empik commission in the payload) and applies the new rules to them by hand.
- Lines were matched on marketplace, product name, quantity and order time (the offsets are about 10 seconds). 236 of the 269 production lines in the window matched. Production only holds orders from about 2026-09-24 (Allegro) and mid-September (Empik), so the rest of the sheet's history is not comparable until the history import has run.

## Result per channel (matched PLN lines)

| | Allegro | Empik |
|---|---|---|
| Matched lines / orders | 158 / 128 | 48 / 46 |
| Gross, sheet vs ours | 13,087.32 = 13,087.32 | 3,961.27 = 3,961.27 |
| Net, sheet vs ours (23% VAT) | 10,640.10 = 10,640.10 | 3,220.54 = 3,220.54 |
| Sheet commission | 1,963.10 (15.0% of gross) | 730.35 (18.4% of gross) |
| Commission in the order payload | not in payload (needs Allegro billing) | 382.83 net (9.7% of gross, about 11.9% with VAT) |
| Sheet margin | 4,499.96 (42.3% of net) | 1,273.69 (39.5% of net) |

Revenue and net revenue agree exactly on PLN orders.

## Why the margin will differ (all intended)

1. **Commission.**
   - The sheet deducts a flat 15% (Allegro) and 18.4% (Empik) of the gross price, VAT included.
   - We use the real fee, net of VAT. For Empik that is about half of what the sheet deducts. For Allegro it is the billing entries once the account is reconnected, and a 12% net fallback until then.
   - Effect: our Empik margin is higher than the sheet's. Our Allegro margin is higher by the VAT part (about 0.15 / 1.23 versus 0.15) until real fees arrive.
2. **Delivery.** The sheet deducts no label or packaging cost. We deduct the configured label per carrier plus packaging (defaults 12.5 to 15.5 plus 1.5 PLN per order). This is the largest effect and lowers margin: roughly 128 orders x 12.5 to 14 PLN on Allegro and 46 x 14 on Empik for the matched lines.
3. **Shipping paid by the buyer.** We add it (net). The sheet only has it on Allegro (255.33 PLN on the matched lines) and does not include it in margin.
4. **Foreign orders (CZ, SK, HU).**
   - The sheet uses 23% VAT everywhere. We use the destination rate (CZ 21%, SK 23%, HU 27%).
   - We use the NBP rate of the order day. The sheet's gross differs by up to 0.4 PLN per CZK line and by more on EUR and HUF lines.
   - A few sheet rows have net greater than gross (two EUR rows at a gross/net ratio of 0.61 and one HUF row at 0.41). That is a conversion bug in the sheet. Our figures do not have it.
5. **Product cost.** Same source (the sheet's cost tab, imported once). Orders on a product without a cost show as "missing cost" instead of being back-solved.

Expected net effect: Allegro margin below the sheet's (delivery dominates), Empik about level or above (commission outweighs delivery).

## Order coverage

- The sheet lacks about 30 production lines from 2026-09-25 to 2026-10-06, mostly Allegro lines of three products (a gap in the sheet's feed).
- Production lacks 3 Empik lines of one product on 2026-10-05, created within one minute of each other. They are either duplicates in the sheet or orders production has not synced. Check these first.

## To finish after deploy

1. Run migrations 0006 to 0009.
2. Allegro: enable Billing (read) and Payments (read), reconnect. Shopify: add `read_all_orders`.
3. Press "Import past orders" on each account, then Costs & margins, "Import from sheet".
4. For one closed month, compare per channel the totals of orders, gross, net and fees from LUORA OS (`sales_lines`, or Analytics, Orders P&L) with the sheet. Revenue and orders should match. Margin should differ by the causes above only.
5. Keep Luora Analytics live until step 4 is accepted.
