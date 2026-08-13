# RPA Vendor Monitor

A standalone HTML dashboard for monitoring RPA transaction health by brand. It answers two
operational questions at a glance:

1. **Which brands are failing** — spikes, critical failure rates, clusters, and consecutive streaks.
2. **Which brands have gone quiet** — judged against each brand's own history, so a brand that is
   normally idle at 03:00 on a Sunday is not alerted on.

Open `rpa-monitor.html` by double-clicking it. No server, no build step, no network access, no
dependencies. Every KPI, alert, chart, brand status and explanation is computed in the browser from
raw transaction rows.

## Pages

| Tab | Purpose |
|---|---|
| **Today** | The daily check. Today's transactions, failures, failure rate and every alert raised today — one card per brand. No all-time totals |
| **Live Monitor** | Current state per live brand: both traffic lights, last seen, current-window volume and rate. Click a row for the full signal and cadence detail |
| **Operations** | All historical analysis, filtered by brand, period (week / month / custom) and granularity. Trends, brand performance, Rule 2 breach history, category breakdown |
| **Reasons** | Failure categories and the unmapped-reason list that keeps the keyword map current |
| **Vendor Detail** | One brand in depth: daily history, cadence profile, hour-of-day pattern, recent raw transactions |

### Brand scope

Only brands that are still live appear by default. A brand is **live if its last transaction falls
on or after `CONFIG.vendorScope.liveSince`** (currently 1 August 2026). On the shipped dataset that
keeps 24 of 51 monitored brands; the 27 excluded are the Arrow ECS entities, HPE Services and a tail
of one-off names that all stopped transacting in June/July — decommissioned, not broken.

Retired brands keep their full history and stay reachable: Operations has an **include retired
brands** toggle, and Vendor Detail lists them under a separate group. The header always states the
active cutoff and the resulting count.

> **The cutoff is a fixed date and does not maintain itself.** Update it when the reporting period
> moves. If a dataset has nothing after the cutoff the dashboard falls back to showing every
> monitored brand with a warning rather than rendering an empty page — but it will not re-exclude
> newly retired brands on its own.

### "Today" on a partial day

Today is the calendar day of the `MAX(Date)` anchor, which is usually **partial** — the shipped
dataset's anchor is 02:22, so today holds 39 transactions against a typical full day of ~150.
Comparing that against yesterday's total would read as a 70% collapse when nothing is wrong, so
every comparison on the Today page is **like-for-like**: today's elapsed window against the same
time-of-day slice on each of the previous 7 days, reported as a range (`typically 0–24 at this
hour`) rather than a percentage, because a delta like "+875%" is noise on numbers that small.

## Calibration

Thresholds are **per brand**, derived from a year of history rather than fixed for everyone.

The dashboard shipped with the workbook's flat rules: Rule 2 alerts above a 20% daily failure rate,
Critical Spike above 40%. Backtested against 73,481 historical transactions those fire on **54.5% of
all eligible brand-days** — SPLUNK breaches on 93.8% of its days, VMWARE on 75.9%. Those brands are
not broken; their normal operating rates are 53.5% and 50.4%, so the thresholds sit *below* their
baseline. An alert that fires more than half the time carries no information.

`tools/calibrate.py` reads the history export and records each brand's own distribution of daily
failure rates. At runtime the flat values become **floors**:

```
rule2Threshold(brand)    = reliable ? clamp(max(20%, brand p90), 20%, 90%) : 20%
criticalThreshold(brand) = reliable ? clamp(max(40%, brand p95), 40%, 90%) : 40%
```

- **Reliability gate** — a brand needs ≥30 eligible days before its percentiles are trusted. Split
  the history in half and high-volume brands move ~1pp (FORTINET −0.9, VMWARE −0.1, SPLUNK −1.6)
  while thin ones swing 20–30pp (KASPERSKY −27.6 on 25 days). Below the gate, the flat rules apply
  unchanged. Today 19 of 21 brands are adaptive.
- **Ceiling** — no adapted threshold may exceed 90%. Without it a badly degraded brand raises its own
  percentile out of reach and goes silent: TENABLE's p95 is already 100% after an August regression.
- **Floors** — the documented 20%/40% business rules still hold as minimums, so calibration can only
  ever make a brand *harder* to alert on, never easier.

Result on the live dashboard: **Rule 2 alerts fall from 282 to 72**, and SPLUNK stops being Red —
its 62.5% current-window rate is below its own p95 of 80%. Every explanation cites which threshold
was used and where it came from, rather than quoting a bare number.

### Chronic brands

Adaptive thresholds create an obvious risk: a brand that has *always* been bad becomes "normal" and
stops alerting. SPLUNK at 53.5% and VMWARE at 50.4% would simply go quiet.

Those are two different questions, so the dashboard answers them separately. Alerts say *what broke
today*; a **chronic** badge (calibrated baseline ≥40%) marks structurally underperforming brands as
standing context. Four qualify: SPLUNK 53.5%, FORCEPOINT 42.4%, COMMVAULT 40.3%, VMWARE 50.4%.
It is never a traffic light and never suppresses a genuine same-day anomaly.

### Trend detection

A 2-hour window cannot see a slow regression — each day looks close enough to the last. The **30d
trend** column compares the last 30 days against the preceding 90 (falling back to the calibrated
baseline when the live export is too short), flagging movement past ±8pp and calling ≥20pp severe.

This is also the counterweight to adaptive thresholds: a degrading brand raises its own percentile,
so its threshold quietly stops alerting. Trend catches exactly the movement the threshold absorbs —
HP is currently +24.6pp and VMWARE +9.1pp, neither of which trips any spike rule.

### Reason rules learned from history

The history export carries a curated `Reason2` label per row; the live Sheet1 export does not. But
the two share ~98% of their PO numbers, so `calibrate.py` joins them and recovers a category for
free-text reasons the hand-written keyword map misses.

19 rules are learned this way (≥3 observations, ≥80% agreement) and spliced in **immediately before
the final `N/A` rule**, so all 40 hand-written rules keep priority and the learned ones only catch
what would otherwise fall through. **Unmapped failures drop from 355 to 30.** Categories sourced this
way are marked `LEARNED` on the Reasons tab.

### Regenerating

```bash
python3 tools/calibrate.py data/history_dca_2026.xlsx data/calibration.json
python3 tools/build.py
python3 tools/backtest.py data/history_dca_2026.xlsx     # the evidence, re-runnable
```

The calibration is a frozen snapshot and **ages**: thresholds derived from months-old behaviour stop
describing a brand that has moved. The header shows the source range and warns when the calibration
lags the live data by more than `CONFIG.calibration.staleAfterDays`. It is never a hard dependency —
delete `data/calibration.json` and the dashboard runs exactly as it did on flat thresholds, with
trend detection off. That path is covered by tests.

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
src/rpa-monitor.template.html source, with __DATA_PAYLOAD__ / __CALIBRATION_PAYLOAD__ placeholders
data/source_workbook.xlsx     live export (Sheet1 is the only sheet read)
data/history_dca_2026.xlsx    historical export, used offline for calibration only
data/sheet1_payload.json      extracted transactions, dictionary-encoded
data/calibration.json         per-brand thresholds + learned reason rules
tools/extract_sheet1.py       live workbook -> payload
tools/calibrate.py            history workbook -> calibration
tools/backtest.py             flat vs per-brand threshold evidence
tools/build.py                template + payload + calibration -> rpa-monitor.html
tools/reference_engine.py     independent Python implementation (the test oracle)
tools/run_selftest.js         runs the page in Chromium, dumps its computed state
tools/compare.py              diffs browser state against the oracle, field by field
tools/test_robustness.js      parity, recalculation and edge-case tests
```

Rebuild after changing the template or the data:

```bash
python3 tools/extract_sheet1.py data/source_workbook.xlsx data/sheet1_payload.json
python3 tools/calibrate.py data/history_dca_2026.xlsx data/calibration.json
python3 tools/build.py
```

The two workbooks play different roles. `source_workbook.xlsx` is the **live feed** the dashboard
runs on. `history_dca_2026.xlsx` is a richer, longer export (73,494 rows, Jan–Aug 2026, one sheet
per brand, with latency and country fields) used **only offline, to calibrate thresholds**. It is
never ingested at runtime.

## Verifying it

Two independent implementations of the same specification — the browser engine and
`tools/reference_engine.py` — are diffed against each other on every field of every vendor.

```bash
python3 tools/reference_engine.py data/sheet1_payload.json -o data/oracle.json
node tools/run_selftest.js          # -> data/selftest.json
python3 tools/compare.py            # -> ALL FIELDS MATCH
node tools/test_robustness.js       # -> 95 passed, 0 failed
```

`reference_engine.py --parity` disables the three documented deviations below and reproduces the
workbook's own cached values.

The dashboard reproduces `Signal Monitor`!C4:C6 and B9:F9 exactly:

| | |
|---|---|
| CurrentEnd / CurrentStart / BaselineStart | `2026-08-13 02:22:10` / `00:22:10` / `2026-08-06 00:22:10` |
| Red brands / Yellow brands | 1 / 0 |
| SPLUNK | 8 txns, 5 failures, 62.5% current, 54.386% baseline, Red at alert score 2 |
| Workbook `Total Transactions` / failure rate | 19,869 / `0.2817957622426896` |

Figures that count brands are now scoped to live brands, so they differ from the workbook's
unscoped equivalents. Both are reported: streak-active is 8 live (10 across all monitored brands),
Rule 2 is 282 live (293 across all monitored). Engine parity — signals, activity, streaks and the
registry — stays **unscoped**, so the two implementations are still compared across all 51 brands.

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

**D1 — Dormancy override** (`CONFIG.activity.dormancy`). Silence beyond
`max(7 days, 3 × the brand's longest historical gap)` escalates GREY to RED as a distinct `DORMANT`
signal, because quiet-hour suppression is right for a 90-minute gap at 03:00 and wrong for a six-day
outage. The original QUIET reasoning stays visible in the explanation.

*Now largely redundant, deliberately kept.* Every brand D1 escalated on the shipped dataset — 7 Arrow
ECS / HPE entities — turns out to be retired, and the brand-scope filter removes them more cleanly
than an alert does. Within the live scope D1 currently fires on **nobody**. It stays configured
because it is what will catch a *live* brand going silent, which is the case that actually matters.
Note the 7-day floor means a live brand quiet for, say, 5 days during a quiet hour still shows GREY
(`Forcepoint` is one today) — lower `hardCeilingMinutes` if that is too permissive.

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
| `calibration` | reliability gate (30 days), adaptive ceiling (90%), chronic baseline (40%), staleness window |
| `drift` | 30d recent vs 90d prior, ±8pp regression, 20pp severe, minimum volumes |
| `vendorScope` | `liveSince` — the brand-liveness cutoff |
| `today` | `comparisonDays` — how many prior days form the like-for-like band |
| `freshness` | Fresh ≤60 min, Delayed ≤240 min, Stale beyond |

`vendorScope.liveSince`, `dormancy`, `freshness` and the WATCH escalation are the ones worth
revisiting once someone has seen the alert volume they produce in practice — the values shipped are
reasonable defaults, not measurements.

## Known open questions

- `HPE File has been processed successfully for` (287 rows) looks like a parse artefact rather than a
  real brand, but it passes every documented filter — and it is live, transacting today, one of only
  five brands active in the current window. `MYD - SPLUNK` and `MYD -Citrix` are similar. All are
  treated as real brands pending confirmation.
- The `liveSince` cutoff is a fixed date that needs updating by hand as the reporting period moves.
  The header displays it and the zero-live guard prevents a silent empty dashboard, but it will not
  self-maintain.
- TENABLE's p95 shifted from 35.8% to 100% between halves of the history — a genuine August
  regression, not noise. Its calibrated threshold is therefore built partly on already-degraded
  behaviour. The 90% ceiling stops it going silent and trend detection flags the movement, but it is
  worth a human look before trusting its numbers.
- The history export carries **processing latency** (`SentTime`−`ReceivedTime`) and a **country**
  dimension, both currently unused. Latency regimes differ enormously by brand (REDHAT ~5.6 min
  median, BROADCOM ~440 min) and real incidents show up clearly — FORTINET went from 8 minutes to
  30 hours on 12 July. Failure rates also vary by country (Ireland 49%, Poland 19%) and by hour
  (13% at 04:00, 50% at 02:00). None of these fields exist in the live Sheet1 export, so using them
  would mean ingesting the history schema at runtime rather than only calibrating from it.
- `Arrow ECS *` entities are internal and all now fall outside the live scope. They remain available
  through the Operations "include retired brands" toggle.
