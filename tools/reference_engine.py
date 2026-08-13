#!/usr/bin/env python3
"""
Reference implementation of the RPA monitoring logic — the oracle the JavaScript
engine is validated against.

This is a direct port of the `rpa_monitor` package exported into the workbook's
"Python Export" sheet, which is itself a cell-referenced translation of the Excel
formulas on 'Signal Helper', 'Hub Calc' and 'Rule Monitor'. Keeping it in the repo
means the browser engine can be diffed field-by-field against a known-good
implementation whenever the logic changes.

It reads the same dictionary-encoded payload the dashboard embeds, so both engines
start from byte-identical input and any difference is genuinely a logic difference.

Deviations from the workbook are gated behind the DECISIONS flags below and are
documented in README.md. Run with --parity to switch them all off and reproduce
the workbook's own cached values exactly.

    python3 tools/reference_engine.py data/sheet1_payload.json -o data/oracle.json
    python3 tools/reference_engine.py data/sheet1_payload.json --parity
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from collections import defaultdict

# ---------------------------------------------------------------------------
# CONFIG — mirrors CONFIG in rpa-monitor.html one-for-one.
# ---------------------------------------------------------------------------
CFG = {
    "currentHours": 2,
    "baselineDays": 7,
    "fallbackMinVolume": 30,
    "baselineHoursDefault": 168,
    "baselineHoursMax": 1000,
    "rule1MinStreak": 2,
    "rule2MinTxns": 5,
    "rule2RateThreshold": 0.20,
    "spikeMinCurrentVolume": 5,
    "spikeAbsoluteDelta": 0.15,
    "spikeRelativeRatio": 1.5,
    "spikeRelativeMinRate": 0.10,
    "criticalMinRate": 0.40,
    "criticalMinFailures": 3,
    "clusterMinConsecutive": 4,
    "clusterMinInWindow": 5,
    "clusterWindowMinutes": 30,
    "volumeSigmaThreshold": 2.5,
    "scoreSpike": 3,
    "scoreCluster": 2,
    "scoreVolume": 1,
    "scoreRedMin": 4,
    "scoreYellowMin": 2,
    "hubMinTxns": 20,
    "hubMaxNameLen": 120,
    "signalMaxNameLen": 100,
    "signalMinTotalVolume": 5,
    "excludeSubstrings": ("VENDORBACKLOG", "<HTML"),
    # A vendor is live if its LAST transaction falls on or after this date.
    # Mirrors CONFIG.vendorScope.liveSince in rpa-monitor.html.
    "liveSince": dt.datetime(2026, 8, 1),
    "todayComparisonDays": 7,
    "freqHighMaxMedian": 2,
    "freqMediumMaxMedian": 30,
    "freqBounds": {
        "HIGH_FREQUENCY": (10, 15),
        "MEDIUM_FREQUENCY": (30, 60),
        "LOW_FREQUENCY": (180, 240),
    },
    "hourPeakRatio": 0.70,
    "hourActiveRatio": 0.30,
    "hourWatchMinCount": 2,
    "hourMultiplier": {"PEAK": 1.0, "ACTIVE": 1.5, "WATCH": 3.0, "QUIET": None},
    "monitoringMode": {"PEAK": "Strict", "ACTIVE": "Normal",
                       "WATCH": "Relaxed", "QUIET": "Suppressed"},
    "yellowRatio": 0.75,
    "dormancyHardCeilingMinutes": 7 * 24 * 60,
    "dormancyHistoricalGapMultiple": 3,
}

# Deviations from workbook logic, each traced to a recorded decision.
DECISIONS = {
    "watchCanEscalate": True,   # D2: a WATCH vendor may reach RED
    "dormancyOverride": True,   # D1: long silence overrides QUIET suppression
    "scaleVolumeToWindow": True,  # D3: report a window-scaled anomaly alongside
}

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday",
             "Thursday", "Friday", "Saturday"]

REASON_MAP = [
    ("start and end date are missing", "Missing start/end date"),
    ("Contract End Date is different", "Contract end date mismatch"),
    ("contract start date is starting later", "Contract start date too late"),
    ("needs to be reconfirmed", "SO needs reconfirmation"),
    ("back to back order is in status PENDING", "Back-to-back order pending"),
    ("Operation canceled", "Operation canceled"),
    ("could not be found", "Order email not found"),
    ("Posting of journal has been failed", "Journal posting failed"),
    ("not recognized as a valid DateTime", "Invalid date format"),
    ("exceeds quantity on journal", "Quantity exceeds journal"),
    ("No inventory transactions with status Ordered", "No ordered inventory"),
    ("fulfillment email", "Missing fulfillment email"),
    ("is in status pending", "PO status pending"),
    ("hardware item", "Hardware-only PO"),
    ("Hard item", "Hardware-only PO"),
    ("Multi Year Deal", "Excluded - Multi Year Deal"),
    ("not set as a direct delivery", "Not direct delivery"),
    ("dispatch date", "Dispatch date issue"),
    ("delivery confirmation mail", "Delivery confirmation needed"),
    ("mismatch between", "Data mismatch"),
    ("Abbyy", "Attachment/PDF extraction"),
    ("valid attachments", "Attachment/PDF extraction"),
    ("LogonFailedException", "System/technical error"),
    ("server is unavailable", "System/technical error"),
    ("Exception has been thrown", "System/technical error"),
    ("Index was outside", "System/technical error"),
    ("Conversion from string", "System/technical error"),
    ("Cannot edit a record", "System/technical error"),
    ("target of an invocation", "System/technical error"),
    ("negative quantity", "Negative quantity on PO"),
    ("no standard lines to receive", "No standard lines to receive"),
    ("no Sales Order marked", "No linked sales order"),
    ("SOD record", "SOD record not found"),
    ("greater than 50", "Quantity limit exceeded"),
    ("already exists", "File already exists"),
    ("quantities are different", "Data mismatch"),
    ("is absent from the original PO", "Line missing from PO"),
    ("not completely received", "Partial receipt"),
    ("PO details not found", "PO not found in database"),
    ("N/A", "Unspecified"),
]
_LOWER_MAP = [(k.casefold(), c) for k, c in REASON_MAP]
DEFAULT_CATEGORY = "Unspecified"


def categorize(reason: str | None) -> str:
    """First matching keyword wins; order is significant."""
    text = "" if reason is None else str(reason).casefold()
    if not text.strip():
        return DEFAULT_CATEGORY
    for keyword, category in _LOWER_MAP:
        if keyword in text:
            return category
    return DEFAULT_CATEGORY


# ---------------------------------------------------------------------------
# Load + normalise
# ---------------------------------------------------------------------------
class Txn:
    __slots__ = ("seq", "vendor", "vendor_key", "is_failure", "reason",
                 "category", "po", "date", "day", "hour", "dow")

    def __init__(self, seq, vendor, is_failure, reason, po, date):
        self.seq = seq
        self.vendor = vendor
        self.vendor_key = vendor.upper()
        self.is_failure = is_failure
        self.reason = reason
        self.category = categorize(reason) if is_failure else ""
        self.po = po
        self.date = date
        self.day = date.date().isoformat()
        self.hour = date.hour
        # Excel WEEKDAY(...,1): Sunday=1..Saturday=7
        self.dow = (date.weekday() + 1) % 7 + 1


def load(path: str) -> tuple[list[Txn], dict]:
    """Apply the same admissibility rules the dashboard applies, so both engines
    analyse an identical row set."""
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    statuses, vendors, reasons = payload["statuses"], payload["vendors"], payload["reasons"]
    txns = []
    for i, (s, v, r, po, d) in enumerate(payload["rows"]):
        vendor = vendors[v].strip()
        try:
            date = dt.datetime.fromisoformat(d) if d else None
        except ValueError:
            date = None
        if not vendor or date is None:
            continue
        txns.append(Txn(len(txns), vendor,
                        statuses[s].strip().casefold() == "failure",
                        reasons[r], po, date))
    # Chronological, ties broken by ingestion order so streaks are deterministic.
    txns.sort(key=lambda t: (t.date, t.seq))
    return txns, payload["quality"]


def percentile(sorted_vals: list[float], p: float) -> float:
    """Linear interpolation between closest ranks — numpy's default method,
    which is what the exported package used."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] * (hi - k) + sorted_vals[hi] * (k - lo)


def stdev_sample(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))


# ---------------------------------------------------------------------------
# Vendor registry — one identity, applied to every engine (plan §7)
# ---------------------------------------------------------------------------
def build_registry(txns: list[Txn]) -> dict:
    by_key: dict[str, list[Txn]] = defaultdict(list)
    for t in txns:
        by_key[t.vendor_key].append(t)

    registry = {}
    for key, rows in by_key.items():
        junk = (not key
                or len(key) > CFG["hubMaxNameLen"]
                or any(bad in key for bad in CFG["excludeSubstrings"]))
        signal_ok = (not junk) and len(key) <= CFG["signalMaxNameLen"]
        spellings: dict[str, int] = defaultdict(int)
        for r in rows:
            spellings[r.vendor] += 1
        display = max(sorted(spellings), key=lambda s: spellings[s])
        last_txn = max(t.date for t in rows)
        registry[key] = {
            "vendorKey": key,
            "displayName": display,
            "spellings": dict(sorted(spellings.items(), key=lambda kv: -kv[1])),
            "rows": rows,
            "tier": ("EXCLUDED_JUNK" if junk
                     else "FULL" if len(rows) >= CFG["hubMinTxns"]
                     else "SIGNAL_ONLY"),
            "signalEligible": signal_ok,
            "internal": key.startswith("ARROW ECS"),
            "lastTxn": last_txn,
            # Scope filter, not an exclusion tier: retired vendors keep their
            # tier and full history and stay available to historical reporting.
            "live": last_txn >= CFG["liveSince"],
        }
    return registry


def aggregate(txns: list[Txn], vendor_keys=None, start=None, end=None) -> dict:
    """Roll up a filtered slice of transactions. Mirrors aggregate() in the
    dashboard so both sides answer the same question the same way."""
    rows = [t for t in txns
            if (vendor_keys is None or t.vendor_key in vendor_keys)
            and (start is None or t.date >= start)
            and (end is None or t.date <= end)]

    vendor_days: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    cats: dict[str, dict] = {}
    unmapped: dict[str, int] = defaultdict(int)
    failures = 0

    for t in rows:
        if t.is_failure:
            failures += 1
        slot = vendor_days[(t.vendor_key, t.day)]
        slot[0] += 1
        slot[1] += 1 if t.is_failure else 0
        if not t.is_failure:
            continue
        c = cats.setdefault(t.category, {"failures": 0, "vendors": set(),
                                         "first": t.date, "last": t.date})
        c["failures"] += 1
        c["vendors"].add(t.vendor_key)
        c["first"] = min(c["first"], t.date)
        c["last"] = max(c["last"], t.date)
        if t.category == DEFAULT_CATEGORY:
            txt = str(t.reason).strip()
            if txt and txt.upper() != "N/A":
                unmapped[txt] += 1

    alerts = [{"vendorKey": k, "day": d, "transactions": n, "failures": f,
               "failureRate": f / n if n else 0.0}
              for (k, d), (n, f) in vendor_days.items()
              if n >= CFG["rule2MinTxns"] and (f / n if n else 0) > CFG["rule2RateThreshold"]]

    return {
        "rows": rows,
        "totals": {
            "transactions": len(rows),
            "failures": failures,
            "successes": len(rows) - failures,
            "failureRate": failures / len(rows) if rows else 0.0,
            "days": len({t.day for t in rows}),
            "vendors": len({t.vendor_key for t in rows}),
        },
        "rule2Alerts": alerts,
        "categories": sorted(
            ({"category": k, "failures": v["failures"],
              "share": v["failures"] / failures if failures else 0.0,
              "vendors": len(v["vendors"]),
              "firstSeen": v["first"].isoformat(), "lastSeen": v["last"].isoformat()}
             for k, v in cats.items()),
            key=lambda r: -r["failures"]),
        "unmapped": dict(sorted(unmapped.items(), key=lambda kv: -kv[1])),
    }


# ---------------------------------------------------------------------------
# Rule 1 / Rule 2
# ---------------------------------------------------------------------------
def rule1(rows: list[Txn]) -> dict:
    run = best = 0
    for t in rows:
        run = run + 1 if t.is_failure else 0
        best = max(best, run)
    current = run
    status = ("Active" if current >= CFG["rule1MinStreak"]
              else "Resolved" if best >= CFG["rule1MinStreak"] else "-")
    return {"currentStreak": current, "maxStreak": best, "status": status}


# Rule 2 (per vendor per calendar day) is computed inside aggregate() so it
# honours whatever vendor and date scope the caller is asking about.


# ---------------------------------------------------------------------------
# Signal engine — 2h current window vs 7d baseline, anchored to MAX(Date)
# ---------------------------------------------------------------------------
def max_consecutive(rows: list[Txn]) -> int:
    run = best = 0
    for t in rows:
        run = run + 1 if t.is_failure else 0
        best = max(best, run)
    return best


def max_in_rolling_window(rows: list[Txn]) -> int:
    """Most failures inside any rolling 30-minute window (true rolling, not
    fixed clock blocks)."""
    times = [t.date for t in rows if t.is_failure]
    if not times:
        return 0
    span = dt.timedelta(minutes=CFG["clusterWindowMinutes"])
    best = 0
    j = 0
    for i, start in enumerate(times):
        while j < len(times) and times[j] <= start + span:
            j += 1
        best = max(best, j - i)
    return best


def current_streak(rows: list[Txn]) -> int:
    run = 0
    for t in reversed(rows):
        if not t.is_failure:
            break
        run += 1
    return run


def hourly_buckets(rows: list[Txn], current_start: dt.datetime, hours: int) -> list[int]:
    """Transactions per hourly bucket going back `hours` from CurrentStart.
    Bucket r covers (CurrentStart - r hours, CurrentStart - (r-1) hours]."""
    hours = int(min(max(hours, 0), CFG["baselineHoursMax"]))
    if hours <= 0:
        return []
    buckets = [0] * hours
    for t in rows:
        offset = (current_start - t.date).total_seconds() / 3600.0
        r = math.ceil(offset)
        if 1 <= r <= hours:
            buckets[r - 1] += 1
    return buckets


def compute_signals(registry: dict, current_end: dt.datetime) -> dict:
    current_start = current_end - dt.timedelta(hours=CFG["currentHours"])
    baseline_start = current_start - dt.timedelta(days=CFG["baselineDays"])
    results = {}

    for key, entry in registry.items():
        if not entry["signalEligible"]:
            continue
        rows = entry["rows"]
        cur = [t for t in rows if current_start < t.date <= current_end]
        base = [t for t in rows if baseline_start < t.date <= current_start]
        hist = [t for t in rows if t.date <= current_start]

        cur_vol = len(cur)
        cur_fail = sum(1 for t in cur if t.is_failure)
        cur_rate = cur_fail / cur_vol if cur_vol else 0.0

        use_fallback = len(base) < CFG["fallbackMinVolume"]
        ref = hist if use_fallback else base
        base_vol = len(ref)
        base_fail = sum(1 for t in ref if t.is_failure)
        base_rate = base_fail / base_vol if base_vol else 0.0

        max_consec = max_consecutive(cur)
        max_in_30 = max_in_rolling_window(cur)

        spike = bool(
            cur_vol >= CFG["spikeMinCurrentVolume"]
            and ((cur_rate - base_rate >= CFG["spikeAbsoluteDelta"])
                 or (base_rate > 0
                     and cur_rate / base_rate >= CFG["spikeRelativeRatio"]
                     and cur_rate >= CFG["spikeRelativeMinRate"])))
        critical = bool(cur_rate >= CFG["criticalMinRate"]
                        and cur_fail >= CFG["criticalMinFailures"])
        cluster = bool(max_consec >= CFG["clusterMinConsecutive"]
                       or max_in_30 >= CFG["clusterMinInWindow"])

        first_txn = min(t.date for t in rows)
        if use_fallback:
            elapsed = (current_start - first_txn).total_seconds() / 3600.0
            baseline_hours = int(min(CFG["baselineHoursMax"], max(0, math.ceil(elapsed))))
        else:
            baseline_hours = CFG["baselineHoursDefault"]

        buckets = hourly_buckets(rows, current_start, baseline_hours)
        expected = sum(buckets) / len(buckets) if buckets else 0.0
        sigma = stdev_sample([float(b) for b in buckets])
        deviation = abs(cur_vol - expected) / sigma if sigma > 0 else 0.0
        vol_anom = bool(sigma > 0 and deviation >= CFG["volumeSigmaThreshold"])

        # D3: the workbook compares a 2-hour count against a 1-hour bucket mean.
        # Keep the original as the scored signal; report the scaled figures too.
        scale = CFG["currentHours"]
        expected_scaled = expected * scale
        sigma_scaled = sigma * math.sqrt(scale)
        deviation_scaled = (abs(cur_vol - expected_scaled) / sigma_scaled
                            if sigma_scaled > 0 else 0.0)

        if sigma <= 0:
            direction = "INSUFFICIENT_HISTORY"
        elif deviation_scaled < CFG["volumeSigmaThreshold"]:
            direction = "NORMAL"
        elif cur_vol < expected_scaled:
            direction = "LOW_ACTIVITY"
        else:
            direction = "HIGH_ACTIVITY"

        score = (CFG["scoreSpike"] * spike
                 + CFG["scoreCluster"] * cluster
                 + CFG["scoreVolume"] * vol_anom)
        if critical or (spike and cluster) or score >= CFG["scoreRedMin"]:
            light = "RED"
        elif score >= CFG["scoreYellowMin"]:
            light = "YELLOW"
        else:
            light = "GREEN"

        seen, distinct = set(), []
        for t in cur:
            if not t.is_failure:
                continue
            txt = str(t.reason).strip()
            if not txt or txt.upper() == "N/A" or txt in seen:
                continue
            seen.add(txt)
            distinct.append(txt)

        streak = current_streak(rows)
        total_fail = sum(1 for t in rows if t.is_failure)

        results[key] = {
            "light": light,
            "alertScore": int(score),
            "signals": {"spike": spike, "critical": critical,
                        "cluster": cluster, "volumeAnomaly": vol_anom},
            "currentVolume": cur_vol,
            "currentFailures": cur_fail,
            "currentRate": cur_rate,
            "baselineVolume": base_vol,
            "baselineFailures": base_fail,
            "baselineRate": base_rate,
            "usedFallbackBaseline": use_fallback,
            "baselineHours": baseline_hours,
            "maxConsecutive": max_consec,
            "maxIn30Min": max_in_30,
            "expectedVolume": expected,
            "sigma": sigma,
            "sigmaDeviation": deviation,
            "expectedVolumeScaled": expected_scaled,
            "sigmaScaled": sigma_scaled,
            "sigmaDeviationScaled": deviation_scaled,
            "volumeDirection": direction,
            "currentStreak": streak,
            "streakActive": streak >= CFG["rule1MinStreak"],
            "totalVolume": len(rows),
            "totalFailures": total_fail,
            "distinctReasons": distinct,
        }
    return results


# ---------------------------------------------------------------------------
# Activity engine — vendor cadence profile + weekday/hour grid
# ---------------------------------------------------------------------------
def compute_activity(registry: dict, now: dt.datetime, parity: bool = False) -> dict:
    cur_hour = now.hour
    cur_dow = (now.weekday() + 1) % 7 + 1
    results = {}

    for key, entry in registry.items():
        if entry["tier"] != "FULL":
            continue
        rows = entry["rows"]
        dates = [t.date for t in rows]
        gaps = sorted((dates[i] - dates[i - 1]).total_seconds() / 60.0
                      for i in range(1, len(dates)))
        median = percentile(gaps, 0.50)
        p75 = percentile(gaps, 0.75)
        p90 = percentile(gaps, 0.90)
        max_gap = gaps[-1] if gaps else 0.0

        if median <= CFG["freqHighMaxMedian"]:
            freq = "HIGH_FREQUENCY"
        elif median <= CFG["freqMediumMaxMedian"]:
            freq = "MEDIUM_FREQUENCY"
        else:
            freq = "LOW_FREQUENCY"
        lo, hi = CFG["freqBounds"][freq]
        base_threshold = int(min(hi, max(lo, round(p90))))

        # weekday x hour histogram
        grid: dict[tuple[int, int], int] = defaultdict(int)
        hour_hist = [0] * 24
        for t in rows:
            grid[(t.dow, t.hour)] += 1
            hour_hist[t.hour] += 1
        hist_count = grid.get((cur_dow, cur_hour), 0)
        # denominator is the busiest bucket ON THAT WEEKDAY, not overall
        dow_max = max((n for (d, _), n in grid.items() if d == cur_dow), default=0)
        hour_vs_max = hist_count / dow_max if dow_max > 0 else 0.0

        if hour_vs_max >= CFG["hourPeakRatio"]:
            hour_class = "PEAK"
        elif hour_vs_max >= CFG["hourActiveRatio"]:
            hour_class = "ACTIVE"
        elif hist_count >= CFG["hourWatchMinCount"]:
            hour_class = "WATCH"
        else:
            hour_class = "QUIET"
        mode = CFG["monitoringMode"][hour_class]
        mult = CFG["hourMultiplier"][hour_class]
        threshold = round(base_threshold * mult) if mult is not None else None

        last = max(dates)
        minutes_since = (now - last).total_seconds() / 60.0

        # D1: silence far beyond anything this vendor has ever shown is an
        # outage, not a quiet hour. Evaluated before QUIET suppression.
        dormancy_limit = max(CFG["dormancyHardCeilingMinutes"],
                             max_gap * CFG["dormancyHistoricalGapMultiple"])
        dormant = (DECISIONS["dormancyOverride"] and not parity
                   and minutes_since > dormancy_limit)

        if dormant:
            status = "RED"
        elif hour_class == "QUIET":
            status = "GREY"
        elif threshold is None:
            status = "GREEN"
        elif minutes_since > threshold and (
                hour_class in ("PEAK", "ACTIVE")
                or (DECISIONS["watchCanEscalate"] and not parity)):
            # D2: workbook gates RED on PEAK/ACTIVE, capping WATCH at YELLOW
            # however overdue it becomes. WATCH already carries a 3x threshold.
            status = "RED"
        elif minutes_since >= CFG["yellowRatio"] * threshold:
            status = "YELLOW"
        else:
            status = "GREEN"

        results[key] = {
            "light": status,
            "lastTxn": last.isoformat(),
            "firstTxn": min(dates).isoformat(),
            "minutesSinceLast": round(minutes_since),
            "frequencyClass": freq,
            "medianIntervalMin": median,
            "p75IntervalMin": p75,
            "p90IntervalMin": p90,
            "historicalMaxGapMin": max_gap,
            "baseThresholdMin": base_threshold,
            "dynamicThresholdMin": threshold,
            "hourClass": hour_class,
            "monitoringMode": mode,
            "histCount": hist_count,
            "dowMax": dow_max,
            "hourVsMax": hour_vs_max,
            "dormant": dormant,
            "dormancyLimitMin": dormancy_limit,
            "activeDays": len({t.day for t in rows}),
            "hourHistogram": hour_hist,
            "currentDow": cur_dow,
            "currentHour": cur_hour,
            "currentDayName": DAY_NAMES[cur_dow - 1],
        }
    return results


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
def build(path: str, parity: bool = False) -> dict:
    txns, quality = load(path)
    registry = build_registry(txns)
    current_end = max(t.date for t in txns)
    current_start = current_end - dt.timedelta(hours=CFG["currentHours"])
    baseline_start = current_start - dt.timedelta(days=CFG["baselineDays"])

    signals = compute_signals(registry, current_end)
    activity = compute_activity(registry, current_end, parity=parity)

    streaks = {k: rule1(e["rows"]) for k, e in registry.items()
               if e["tier"] != "EXCLUDED_JUNK"}

    # --- vendor scope ----------------------------------------------------
    # Liveness filters the VIEW, not the engines: signals, activity, streaks and
    # the registry above stay unscoped so the parity check keeps its full reach.
    monitored = [e for e in registry.values() if e["tier"] != "EXCLUDED_JUNK"]
    live_entries = [e for e in monitored if e["live"]]
    fell_back = not live_entries and bool(monitored)
    if fell_back:
        live_entries = monitored
    live_keys = {e["vendorKey"] for e in live_entries}

    monitored_agg = aggregate(txns, {e["vendorKey"] for e in monitored})
    live_agg = aggregate(txns, live_keys)

    # --- today -----------------------------------------------------------
    day_start = dt.datetime(current_end.year, current_end.month, current_end.day)
    elapsed = current_end - day_start
    today_agg = aggregate(txns, live_keys, day_start, current_end)
    prior_slices = []
    for i in range(1, CFG["todayComparisonDays"] + 1):
        s = day_start - dt.timedelta(days=i)
        prior_slices.append(aggregate(txns, live_keys, s, s + elapsed)["totals"]["transactions"])

    total = len(txns)
    failures = sum(1 for t in txns if t.is_failure)

    live_signals = {k: v for k, v in signals.items() if k in live_keys}
    live_activity = {k: v for k, v in activity.items() if k in live_keys}
    eligible = [v for v in live_signals.values()
                if v["totalVolume"] >= CFG["signalMinTotalVolume"]]

    return {
        "parityMode": parity,
        "decisions": {k: (False if parity else v) for k, v in DECISIONS.items()},
        "window": {
            "currentEnd": current_end.isoformat(),
            "currentStart": current_start.isoformat(),
            "baselineStart": baseline_start.isoformat(),
        },
        "scope": {
            "liveSince": CFG["liveSince"].isoformat(),
            "liveCount": len(live_entries),
            "monitoredCount": len(monitored),
            "retiredCount": len(monitored) - len(live_entries),
            "fellBack": fell_back,
            "liveKeys": sorted(live_keys),
        },
        "todayPage": {
            "dayKey": day_start.date().isoformat(),
            "transactions": today_agg["totals"]["transactions"],
            "failures": today_agg["totals"]["failures"],
            "failureRate": today_agg["totals"]["failureRate"],
            "rule2Alerts": len(today_agg["rule2Alerts"]),
            "activeVendors": today_agg["totals"]["vendors"],
            "priorSlices": prior_slices,
        },
        "kpis": {
            "analysedTransactions": total,
            "analysedSuccesses": total - failures,
            "analysedFailures": failures,
            "analysedFailureRate": failures / total if total else 0.0,
            "workbookTotal": quality.get("workbookTotal"),
            "workbookFailureRate": (quality["workbookFailures"] / quality["workbookTotal"]
                                    if quality.get("workbookTotal") else None),
            "todayTransactions": today_agg["totals"]["transactions"],
            "todayFailures": today_agg["totals"]["failures"],
            "todayFailureRate": today_agg["totals"]["failureRate"],
            "todayRule2Alerts": len(today_agg["rule2Alerts"]),
            "todayActiveVendors": today_agg["totals"]["vendors"],
            "redVendors": sum(1 for v in eligible if v["light"] == "RED"),
            "yellowVendors": sum(1 for v in eligible if v["light"] == "YELLOW"),
            "streakActiveVendors": sum(1 for v in eligible if v["streakActive"]),
            "rule2Alerts": len(live_agg["rule2Alerts"]),
            "rule2VendorsAffected": len({a["vendorKey"] for a in live_agg["rule2Alerts"]}),
            "monitoredRule2Alerts": len(monitored_agg["rule2Alerts"]),
            "daysMonitored": len({t.day for t in txns}),
            "monitoredVendors": len(monitored),
            "liveVendors": len(live_entries),
            "dormantVendors": sum(1 for v in live_activity.values() if v["dormant"]),
            "activityRed": sum(1 for v in live_activity.values() if v["light"] == "RED"),
            "activityYellow": sum(1 for v in live_activity.values() if v["light"] == "YELLOW"),
            "activityGreen": sum(1 for v in live_activity.values() if v["light"] == "GREEN"),
            "activityGrey": sum(1 for v in live_activity.values() if v["light"] == "GREY"),
        },
        "signals": signals,
        "activity": activity,
        "streaks": streaks,
        "rule2Alerts": live_agg["rule2Alerts"],
        "categories": live_agg["categories"],
        "unmapped": live_agg["unmapped"],
        "registry": {k: {"displayName": e["displayName"], "tier": e["tier"],
                         "signalEligible": e["signalEligible"],
                         "internal": e["internal"], "rows": len(e["rows"])}
                     for k, e in registry.items()},
        "quality": {k: v for k, v in quality.items() if k != "quarantine"},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("payload", nargs="?", default="data/sheet1_payload.json")
    ap.add_argument("-o", "--out")
    ap.add_argument("--parity", action="store_true",
                    help="disable all documented deviations and reproduce "
                         "the workbook's own values")
    args = ap.parse_args()

    result = build(args.payload, parity=args.parity)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1, sort_keys=True, default=str)
        print(f"wrote {args.out}")

    w, k = result["window"], result["kpis"]
    print(f"\nCurrentEnd    {w['currentEnd']}")
    print(f"CurrentStart  {w['currentStart']}")
    print(f"BaselineStart {w['baselineStart']}")
    print(f"\nanalysed transactions {k['analysedTransactions']:,}  "
          f"failures {k['analysedFailures']:,}  rate {k['analysedFailureRate']:.4f}")
    print(f"workbook parity total {k['workbookTotal']:,}  "
          f"rate {k['workbookFailureRate']:.16f}")
    print(f"\nFAILURE  red {k['redVendors']}  yellow {k['yellowVendors']}  "
          f"streak-active {k['streakActiveVendors']}")
    print(f"ACTIVITY red {k['activityRed']}  yellow {k['activityYellow']}  "
          f"green {k['activityGreen']}  grey {k['activityGrey']}")
    print(f"RULE 2   alerts {k['rule2Alerts']}  vendors {k['rule2VendorsAffected']}  "
          f"days {k['daysMonitored']}")
    active = sum(1 for s in result["streaks"].values() if s["status"] == "Active")
    resolved = sum(1 for s in result["streaks"].values() if s["status"] == "Resolved")
    print(f"RULE 1   active {active}  resolved {resolved}")
    fails = k["analysedFailures"]
    uns = next((c for c in result["categories"] if c["category"] == "Unspecified"), None)
    print(f"REASONS  {len(result['categories'])} categories, "
          f"Unspecified {uns['failures'] if uns else 0}/{fails}, "
          f"truly unmapped {sum(result['unmapped'].values())} "
          f"across {len(result['unmapped'])} texts")


if __name__ == "__main__":
    main()
