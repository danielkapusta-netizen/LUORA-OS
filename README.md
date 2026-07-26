# Luora OS

Internal business intelligence for the Luora e-commerce business — Korean skincare sold on
Allegro and Empik.

The product answers three questions on every screen: **how is the business performing, why,
and what should I do next.**

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
```

No environment variables are required. `VITE_LUORA_API_URL` overrides the API endpoint if the
Apps Script deployment URL ever changes.

## Architecture

The rule that shapes everything: **no business calculation lives in React.**

```
src/
  domain/        Pure TypeScript. No React imports anywhere in this folder.
    api.ts         Transport — one Apps Script URL, `action` selects the endpoint
    mappers.ts     Raw spreadsheet payload → domain model
    parse.ts       Defensive coercion (the sheet emits "" for blank numbers)
    sku.ts         SKU reconciliation between transactions and cost records
    metrics.ts     Aggregation: daily series, product/channel performance, comparisons
    health.ts      Business Health Score, decomposed and explainable
    insights.ts    Rule engine producing quantified findings
    brief.ts       Morning Brief composition
    context.ts     Folds all of the above into one BusinessContext
  hooks/         React Query bindings — the only bridge between domain and UI
  components/    Reusable presentation. Receives finished numbers, never computes them.
  app/           Shell, sidebar, navigation
  pages/         Route-level composition
```

`buildBusinessContext()` runs once per data load and produces every figure the UI displays.
Components are presentational, which keeps calculations unit-testable and means this layer
could be lifted into Apps Script unchanged if aggregation ever moves server-side.

### Data flow

Four endpoints are fetched in parallel (`transactions`, `productCosts`, `summary`, `byMonth`)
and folded into a single derived context. Transactions are the spine — if the others fail,
their values are recomputed locally rather than failing the page.

Apps Script caches responses for five minutes, so React Query's `staleTime` matches it and
refetch-on-focus is disabled. Refetching faster only re-downloads identical bytes.

In development, requests are proxied through Vite at `/luora-api`, so the app never depends on
Apps Script's CORS behaviour while running on localhost.

## What the data actually looks like

These were verified against the live endpoint, and the UI is built around them rather than
around an idealised dataset.

**The trading history is short.** Roughly ten days of orders. A "last 7 days vs previous 7"
comparison would compare seven days against three and overstate growth, so the comparison
window halves the available history and labels itself honestly. Monthly views, moving averages
and seasonality are deliberately not built yet — there is nothing truthful to put in them.

**"Today" is not today.** The most recent order is meaningfully older than the current date.
Every figure is anchored to the last order on file, and the header states the edge of the data
rather than implying live trading.

**SKUs need reconciliation.** Transaction rows carry marketplace listing titles; cost records
carry catalogue titles. They diverge by appended offer ids (`… 30 ml (18505316304)`),
semicolon-joined multi-item orders, and trailing pack descriptors (`… 1 sztuka`). Matching raw
strings covers 148 of 183 orders; normalising in `sku.ts` covers 173. The pack-descriptor case
alone was splitting one Centellian24 serum into two products, halving its revenue and
surfacing it twice in the same recommendation list.

**Some profit is unverified.** A small share of revenue matches no cost record. Those orders
still report a margin, but it excludes COGS and is therefore overstated — they average a far
higher margin than the rest of the book, which is a data artefact rather than performance.
This is quantified in the Data Confidence component of the health score and raised as an
explicit finding rather than silently averaged in.

**Not every row parses.** At least one order arrives with empty PLN price and margin. Such rows
are excluded from totals and counted in the footer, never silently dropped.

## Design decisions worth knowing

- **The health score is decomposed on screen.** Five weighted components, each with its own
  score, plain-language explanation and the figure it came from. A score you cannot
  interrogate cannot be acted on.
- **Insights must be quantified.** Every rule states the evidence that triggered it, the action
  to take, and the money at stake. Rules that cannot express impact as a number do not fire.
  Recommendations to spend advertising budget require at least three orders of demand — one
  sale is an anecdote.
- **Rates move in percentage points.** A margin going 30% → 33% has risen 3pp, not 3%. The
  delta component distinguishes the two.
- **Charts where time matters, ranked bars where comparison matters.** Two marketplaces do not
  need a chart library; they need a proportional bar and an honest label.
- **Quiet days are zeros, not gaps.** The daily series spans the full calendar range so a slow
  Sunday reads as a slow Sunday instead of disappearing.

## Status

**Overview is complete and production-ready.** Action Centre, Business Review, Products,
Transactions, Trends and Settings are routed and scoped, with the domain layer that powers
them already built and live — the insight engine behind Action Centre runs today and feeds
Overview.

## Stack

React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 · React Query · React Router ·
Recharts · Framer Motion · Radix primitives · Lucide icons
