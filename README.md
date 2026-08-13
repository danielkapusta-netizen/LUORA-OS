# RPA Vendor Monitor

A standalone HTML dashboard for monitoring RPA transaction health by vendor. It answers two
operational questions at a glance:

1. **Which vendors are failing** — spikes, critical failure rates, clusters, and consecutive streaks.
2. **Which vendors have gone quiet** — judged against each vendor's own history, so a vendor that is
   normally idle at 03:00 on a Sunday is not alerted on.

Open `rpa-monitor.html` by double-clicking it. No server, no build step, no network access, no
dependencies. Every KPI, alert, chart, vendor status and explanation is computed in the browser from
raw transaction rows.

## Why this exists

The logic previously lived in an Excel workbook, implemented three times over: as formulas across
`Signal Helper` / `Hub Calc` / `Rule Monitor`, as a Python package, and as a condensed script. It
worked, but it depended on the Excel calculation engine, spill ranges, `NOW()`, and at least one
formula that hardcoded `Sheet1!$B$2:$B$3228` and therefore only ever saw the first 3,227 rows.

This port owns the business logic outright. Swap the dataset and every number changes — that is the
property the test suite is built around.

## Layout

```
rpa-monitor.html              the deliverable — open this
src/rpa-monitor.template.html source, with a __DATA_PAYLOAD__ placeholder
data/source_workbook.xlsx     the source workbook (Sheet1 is the only sheet read)
data/sheet1_payload.json      extracted transactions, dictionary-encoded
tools/extract_sheet1.py       workbook  -> payload
tools/build.py                template + payload -> rpa-monitor.html
tools/reference_engine.py     independent Python implementation (the test oracle)
tools/run_selftest.js         runs the page in Chromium, dumps its computed state
tools/compare.py              diffs browser state against the oracle, field by field
tools/test_robustness.js      parity, recalculation and edge-case tests
```

Rebuild after changing the template or the data:

```bash
python3 tools/extract_sheet1.py data/source_workbook.xlsx data/sheet1_payload.json
python3 tools/build.py
```

## Verifying it

Two independent implementations of the same specification — the browser engine and
`tools/reference_engine.py` — are diffed against each other on every field of every vendor.

```bash
python3 tools/reference_engine.py data/sheet1_payload.json -o data/oracle.json
node tools/run_selftest.js          # -> data/selftest.json
python3 tools/compare.py            # -> ALL FIELDS MATCH
node tools/test_robustness.js       # -> 37 passed, 0 failed
```

`reference_engine.py --parity` disables the three documented deviations below and reproduces the
workbook's own cached values.

The dashboard reproduces `Signal Monitor`!C4:C6 and B9:F9 exactly:

| | |
|---|---|
| CurrentEnd / CurrentStart / BaselineStart | `2026-08-13 02:22:10` / `00:22:10` / `2026-08-06 00:22:10` |
| Red vendors / Yellow vendors / Streak-active | 1 / 0 / 10 |
| SPLUNK | 8 txns, 5 failures, 62.5% current, 54.386% baseline, Red at alert score 2 |
| Workbook `Total Transactions` / failure rate | 19,869 / `0.2817957622426896` |

## Data contract

`Sheet1` is the only dataset. One row per transaction event:

| Column | Notes |
|---|---|
| `Status` | `Success` / `Failure`, matched case-insensitively |
| `Vendor` | free text; the original spelling is preserved for display |
| `Reason` | free text, often `N/A`; never rewritten |
| `PO` | purchase-order reference |
| `Date` | date+time, parsed as local |

A `Category` column may exist in the workbook. It is **ignored** — categories are recomputed in
JavaScript from `Reason` so the mapping can be edited in one place.

**Load data…** accepts CSV or JSON with those five columns. The CSV parser handles quoted fields,
embedded commas, embedded newlines and `""` escapes, and auto-detects comma, semicolon or tab
delimiters — necessary because reason texts in this dataset contain commas, quotes and raw HTML.
Loading a file rebuilds the entire application state; nothing survives from the previous dataset.

### Row handling

Every row is accounted for and nothing is dropped silently. The **Data quality** panel shows the
reconciliation, which for the shipped dataset is:

| | |
|---|---|
| Rows read from source | 19,910 |
| Empty rows | −109 |
| Rows with transaction content | 19,801 |
| Excluded — vendor blank | −39 |
| Excluded — date unparseable | −0 |
| **Analysed** | **19,762** |

The workbook's own `Total Transactions` of 19,869 sits between these figures because Sheet1's
`Category` formula spills past the data and leaves `#VALUE!` on 68 rows that hold no transaction;
those rows are counted as transactions by the workbook. The dashboard reports 19,762 and explains
the difference rather than picking a number.

The 39 excluded rows are genuine failures whose vendor name leaked into the `Reason` text
(`"HPE File has been processed successfully for PO#311-PO799837…"`). They are quarantined with their
row number, not repaired: inferring a vendor from error prose would be an undocumented business rule,
and the fix belongs upstream.

Duplicate rows are **preserved** — 914 exact five-field duplicates and 2,735 rows sharing a timestamp
exist in this data, and they represent real repeat events. Because streak direction depends on
ordering, rows are sorted by `(timestamp, ingestion index)` rather than timestamp alone, so streaks
are deterministic.

### Vendor identity

The workbook keyed its engines inconsistently: signals grouped on `UPPER(Vendor)` while the activity
engine and both rules grouped on the raw string. `Citrix` (817 rows) and `CITRIX` (3 rows) were
therefore one vendor to one engine and two to another, and Rule 1's "active streak" list contained an
HTML email body as a vendor name.

This build uses `vendorKey = UPPER(TRIM(Vendor))` everywhere, with one central junk filter, and makes
eligibility explicit:

| Tier | Condition | Effect |
|---|---|---|
| `EXCLUDED_JUNK` | name > 120 chars, or contains `VENDORBACKLOG` / `<HTML` | excluded from all monitoring, counted in Data quality |
| `SIGNAL_ONLY` | fewer than 20 transactions | failure signals only; too thin for a cadence profile |
| `FULL` | 20+ transactions | both engines |

Consequence: Rule 1 and Rule 2 counts differ slightly from the workbook's, which counted junk vendors
and split the case variants. Rule 2 is 293 alerts across 27 vendors here, against 297/30 when grouping
raw names with no junk filter.

## The engines

Pipeline, strictly one-directional:

```
L1 ingest -> L2 validate -> L3 normalise -> L4 categorise -> L5 vendor registry
   -> L6 failure rules -> L7 activity profile -> L8 signals -> L9 status
   -> L10 explain -> L11 render -> L12 interact
```

All computation is in pure functions above the render layer; every DOM write is below it.

**Failure monitoring** anchors to `CurrentEnd = MAX(Date)` — never the wall clock, so the same data
always gives the same answer. Current window is the last 2 hours; baseline is the 7 days before it,
falling back to the vendor's whole history when the baseline holds fewer than 30 transactions.

- **Failure Spike** — ≥5 current transactions AND (rate up ≥15pp OR ≥1.5× baseline with rate ≥10%)
- **Critical Spike** — rate ≥40% AND ≥3 failures. Produces Red on its own, independent of alert score
- **Cluster** — 4+ back-to-back failures, OR 5+ failures in any *rolling* 30-minute window
- **Volume Anomaly** — |current − expected| / σ ≥ 2.5 over hourly buckets

`Alert Score = 3×spike + 2×cluster + 1×volume anomaly`. Red when Critical Spike, or spike AND cluster,
or score ≥4. Yellow at score ≥2. A vendor can be **Red at score 0** when Critical Spike is the only
condition — SPLUNK is Red at score 2 for exactly this reason, and the explanation says so.

**Activity monitoring** profiles each vendor's own cadence (median/p75/p90 interval → frequency band →
base threshold), then classifies the current weekday+hour against that vendor's history:

| Class | Condition | Mode | Threshold |
|---|---|---|---|
| `PEAK` | ≥70% of the vendor's busiest hour that weekday | Strict | ×1.0 |
| `ACTIVE` | ≥30% | Normal | ×1.5 |
| `WATCH` | 2+ historical transactions in the slot | Relaxed | ×3.0 |
| `QUIET` | otherwise | Suppressed | — |

Statuses are RED / YELLOW / GREEN / GREY. **GREY is not GREEN** — it means no meaningful activity
assessment can currently be made.

**Reason categorisation** scans the raw `Reason` for the first matching keyword in `REASON_MAP`
(case-insensitive, order significant) and falls through to `Unspecified`. The **Unmapped reasons**
panel lists every raw text still landing there — 355 failures across 56 distinct texts in this
dataset — because that panel is how the mapping stays current.

**Data freshness** compares the wall clock against `MAX(Date)` and colours an indicator only. It never
moves the analysis window. This exists because anchoring everything to `MAX(Date)` makes results
reproducible but hides a total feed outage: the anchor simply stops moving.

## Deviations from the workbook

Three, each deliberate and switchable. `reference_engine.py --parity` turns all three off.

**D1 — Dormancy override** (`CONFIG.activity.dormancy`). At the data anchor, 28 of 31 vendors were
GREY, including 7 silent for 40+ days and `Warehouse` — which normally transacts every ~1.1 minutes —
silent for 6.6 days. Quiet-hour suppression is right for a 90-minute gap at 03:00 and wrong for a
six-day outage. Silence beyond `max(7 days, 3 × the vendor's longest historical gap)` now escalates to
RED as a distinct `DORMANT` signal, so the original QUIET reasoning stays visible in the explanation.
Normal quiet hours still suppress as before.

**D2 — WATCH escalation** (`CONFIG.activity.watchCanEscalate`). The workbook gated RED on
`PEAK`/`ACTIVE`, so a WATCH vendor was capped at YELLOW however overdue it became: `FORTINET` sat at
129 minutes against a 45-minute threshold (2.9×) and would have stayed YELLOW indefinitely. Since
WATCH already carries a 3× relaxed threshold, breaching *that* is meaningful, so WATCH can now reach RED.

**D3 — Volume-anomaly scaling** (`CONFIG.volume`). The signal fires for **0 of 51 vendors** on this
data (highest deviation 2.11σ). Two causes: hourly buckets over 168 hours are mostly zeros with
occasional bursts, inflating σ; and the test compares a **2-hour** current count against a **1-hour**
bucket mean. The original formula is kept as the scored signal for parity, and the window-scaled
figures (`expected × 2`, `σ × √2`) are computed alongside and shown in the UI. This signal cannot
carry low-activity detection — that is the threshold engine's job.

## Tuning

Every threshold is in the frozen `CONFIG` object at the top of the `<script>` block; no bare numbers
appear in the logic. `REASON_MAP` sits directly below it.

| Group | Constants |
|---|---|
| `window` | current 2h, baseline 7d, fallback minimum 30, 168 baseline hours, 1000 cap |
| `rule1` / `rule2` | min streak 2 · min 5 txns, >20% rate |
| `spike` | min volume 5, +0.15 absolute, 1.5× relative, 0.10 minimum rate |
| `critical` | rate 0.40, 3 failures |
| `cluster` | 4 consecutive, 5 in 30 minutes |
| `volume` | 2.5σ |
| `score` | 3 / 2 / 1 weights, Red ≥4, Yellow ≥2 |
| `vendor` | 20 txns to profile, 120/100 name lengths, 5 minimum for KPI tiles, junk substrings |
| `frequency` | median ≤2 / ≤30 min bands, threshold clamps (10–15, 30–60, 180–240) |
| `hourClass` | 0.70 peak, 0.30 active, 2 watch minimum, ×1.0/×1.5/×3.0 multipliers |
| `activity` | 0.75 yellow ratio, WATCH escalation, dormancy ceiling and gap multiple |
| `freshness` | Fresh ≤60 min, Delayed ≤240 min, Stale beyond |

`dormancy`, `freshness` and the WATCH escalation are the three worth revisiting once someone has seen
the alert volume they produce in practice — the values shipped are reasonable defaults, not
measurements.

## Known open questions

- `HPE File has been processed successfully for` (287 rows), `Partial - CHECKPOINT`, `MYD - SPLUNK`
  and `MYD -Citrix` look like parse artefacts rather than real vendors, but they pass every documented
  filter and are treated as real pending confirmation.
- `Arrow ECS *` entities are internal; the workbook's export dropped them. They are kept visible here
  with an `internal` flag, since 7 of them are among the long-dormant vendors.
