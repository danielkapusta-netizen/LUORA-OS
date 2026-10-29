# Luora OS — Design System (Master)

> When building a page, check `design-system/luora-os/pages/<page>.md` first; its rules override this file.
> Tokens live in code in `src/app/globals.css` (`@theme`) and components in `src/components/ui.tsx`. Keep all three in step.

Generated with the `ui-ux-pro-max` skill (`--design-system`, variance 3, density 6 → *Minimalism & Swiss Style*), then
adapted to the brand reference: warm, editorial, pastel. Where the skill's defaults (emerald palette, Rubik/Nunito) differed
from the reference, the reference won.

## Principles

- **Calm first.** Warm off-white canvas, white cards with hairline borders, no drop shadows on resting cards.
- **Colour means something.** Pastels mark the four open-order states and the big panels; ink is the only action colour.
- **One number, one place.** A tile shows one figure in mono, a label, and a caption, and nothing else.
- **Fast by default.** Charts load lazily with a reserved height; sparklines are plain SVG; fonts are self-hosted.

## Colour

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1c1b19` | Text, primary buttons, active tab, focus ring |
| `ink-soft` | `#3a3833` | Primary hover |
| `canvas` | `#fbfaf7` | Page background |
| `sidebar` | `#f6f4ef` | Sidebar, selected row, inset blocks |
| `sidebar-active` | `#ebe8e1` | Active nav item, avatar |
| `brand-*` | ink scale | Alias kept so older pages follow the neutral ink |

Pastels: each has a fill (stat tiles), a tint (panels) and an ink (text on either, AA ≥ 5.5:1).

| Tone | Fill | Tint | Ink | Meaning |
|---|---|---|---|---|
| `sky` | `#b9d6f2` | `#eef5fc` | `#1d4f80` | New · products |
| `blush` | `#f3c9dc` | `#fcf0f5` | `#7a2350` | Processing · customers |
| `butter` | `#f6e08f` | `#fdf8e4` | `#6b5300` | Label created · tasks |
| `peach` | `#f6b9a0` | `#fdf0ea` | `#7a2e14` | On hold · insights · COD |

Semantic colours stay Tailwind's `emerald` (good) and `red` (bad), always paired with an icon or a sign (+/−), never colour alone.
Marketplace colours (`src/components/analytics/format.ts`) are fixed app-wide: Shopify `#2a78d6`, Allegro `#eb6834`,
Empik `#1baf7a`, Von Halsky `#d4a017`, HEBE `#d6338a`.

Muted text is `slate-500` on white/canvas (4.56:1). On `sidebar` use `slate-600`. Never `slate-400` for text.

## Typography

| Role | Font | Class |
|---|---|---|
| Page title, greeting, brief verdict | Source Serif 4, 600 | `font-display` (36–48 px, `tracking-tight`) |
| UI and body | Inter | `font-sans` (14 px body, 12 px captions) |
| Big numbers, order numbers, counts | JetBrains Mono, 500 | `font-mono tabular-nums` |
| Eyebrow (date, scope, last sync) | Inter, 500 | `<Eyebrow>`: 12 px, uppercase, `tracking-[0.14em]`, slate-500 |

Loaded with `next/font/google` in `src/app/layout.tsx` (`latin` + `latin-ext` for Polish).

## Shape and spacing

- Radii: cards and tiles `rounded-3xl`; rows and inputs `rounded-2xl`/`rounded-xl`; buttons, pills, chips `rounded-full`.
- Borders: `border-black/[0.06]` on cards, `border-black/[0.04]` between table rows.
- Page: `max-w-[1400px]`, gutter 16 / 32 / 48 px. Section gap 24–32 px; grid gap 12–20 px.
- Shadows only on floating things (popovers, the bulk-action bar, the active segment): soft, ink-tinted.

## Components (`src/components/ui.tsx`)

- `PageHeader` with an optional `eyebrow`; the serif title.
- `StatTile`: a pastel fill, icon and uppercase label on top, a 48 px mono number, and a caption. It's a link with `.lift` hover.
- `MetricTile`: white, label, 24 px mono number, delta or caption. Used for KPIs everywhere.
- `Card tone="…"`: a tinted panel. `CardHeader` takes an `icon`, a `count` pill and `actions`, with `PanelLink` ("View all") on the right.
- `ListRow`: a white rounded row inside a tinted panel, with an icon chip, title and subtitle, and a `DatePill` or figure on the right.
- `Pills` / segmented tabs: a `bg-black/[0.04]` track; the active segment is white with a hairline shadow.
- Status badges use the pastel of their tile: new `sky`, processing `blush`, label `butter`, on hold `peach`.

## Interaction

- Hover and press animate `transform`, `opacity` or `background-color` only, over 120–200 ms. `.press` scales to 0.96 on active.
- `:focus-visible` gives a 2 px ink outline with a 2 px offset everywhere.
- `prefers-reduced-motion` turns off `.lift`, `.press` scaling and the skeleton pulse.
- Touch targets are at least 40–44 px on phones (`max-md:` sizes on buttons, tabs and chips).

## Performance

- Recharts only comes in through `src/components/analytics/lazy-charts.tsx` (`next/dynamic`, `ssr: false`, fixed-height skeleton).
- KPI sparklines are server-rendered SVG (`Sparkline` in `analytics/blocks.tsx`).

## Pre-delivery checklist

- [ ] No emoji icons (Lucide only, `strokeWidth` 1.75–2)
- [ ] Text contrast is at least 4.5:1, including captions on pastels
- [ ] A visible focus state on every link, button and tab
- [ ] `cursor-pointer` on every clickable element
- [ ] Reduced motion is respected
- [ ] Checked at 375, 768, 1024 and 1440 px, with no horizontal page scroll
- [ ] Every new string goes through `t()`/`msg()` with a Polish entry (`pnpm i18n:check`)
