# Orders — overrides

Source: `src/app/(app)/orders/page.tsx`, `orders-table.tsx`, `order-panel.tsx`.

- **Header**: the eyebrow is "All marketplaces · last sync …"; the serif title is "Orders"; search pill and Sync now sit on the right.
- **Status tabs**: one segmented track; the active tab is white, and counts are muted mono.
- **Toggles**: Returning, With notes and Important are outline chips with a coloured dot, filled ink when on. Filters sits at the far right.
- **Table**: no header band; hairline row dividers; 16 px row padding; order numbers in mono. The selected row is `bg-sidebar` with a 2 px ink inset, and returning rows keep a violet inset.
- **Bulk actions**: a floating white bar, sticky to the top of the list, with a soft shadow.
- **Phone**: each order is its own white rounded card (gap 8 px); the checkbox keeps its 48 px target.
