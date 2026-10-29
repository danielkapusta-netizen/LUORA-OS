# Analytics — overrides

Source: `src/app/(app)/analytics/*`, `src/components/analytics/*`.

- **Header**: the serif "Analytics" title with a one-line description; the tabs are a segmented track that scrolls with an edge fade on phones.
- **Toolbar**: one row holding the period control, the marketplace pills and the date range (muted, pushed right on large screens).
- **Figures**: always `MetricTile` (white, mono numbers). Pastel tiles are reserved for the Dashboard's order states.
- **Tables**: no grey header band; an expanded row uses `bg-sidebar`.
- **Business review**: summary tiles (3 per row), narrative and observations, Business health, Questions worth asking (3 shown, the rest behind "Show all"), Trend, the heatmap, then day by day.
- **Charts**: lazy-loaded with a reserved height. Gridlines are `#ece9e2`, tooltips rounded-xl, bars have a 6 px radius, and the series and marketplace colours are unchanged.
