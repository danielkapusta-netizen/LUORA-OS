# Dashboard — overrides

Source: `src/app/(app)/page.tsx`, `logistics-dashboard.tsx`, `dashboard-parts.tsx`.

- **Header**: `Greeting`. The eyebrow is today's date (Europe/Warsaw); the serif title reads "Welcome back, {first name}"; the period control sits on the right.
- **Order tiles**: four `StatTile`s (New sky, Processing blush, Label created butter, On hold peach), each linking to its Orders tab.
- **Order of sections**: brief, then KPI row (5 `MetricTile`s), then a 3:2 grid (left: Top products in sky with the Pulse chart beneath; right: My tasks in butter, Customers in blush, Where you sell), then Insights in peach (2 risks and 1 opportunity), then the coverage note.
- **What moved**: Questions worth asking and Business health went to Analytics → Business review; the full findings list is under Analytics → Action centre.
- **Logistics roles**: greeting, the same four tiles, the brief, then Parcels by courier next to My tasks. No money anywhere.
