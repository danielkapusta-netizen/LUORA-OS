#!/usr/bin/env python3
"""
Backtest flat vs per-brand thresholds against the full transaction history.

This exists so the claim that motivated adaptive thresholds stays checkable
rather than becoming folklore in a commit message. Re-run it whenever the
history or the thresholds change.

    python3 tools/backtest.py data/history_dca_2026.xlsx
"""
from __future__ import annotations

import argparse
import collections
import json

from calibrate import (CHRONIC_BASELINE_RATE, MAX_ADAPTIVE_RATE, MIN_DAY_VOLUME,
                       MIN_ELIGIBLE_DAYS, build_brand_profiles, percentile,
                       read_history)

# The documented business rules, used as floors.
FLAT_RULE2 = 0.20
FLAT_CRITICAL = 0.40
CRITICAL_MIN_FAILURES = 3


def resolve(profile, floor, key):
    """Same resolution the dashboard applies: floor, adapt, cap."""
    if not profile or not profile["reliable"]:
        return floor, "flat"
    return min(MAX_ADAPTIVE_RATE, max(floor, profile[key])), "adaptive"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("history", nargs="?", default="data/history_dca_2026.xlsx")
    args = ap.parse_args()

    rows = read_history(args.history)
    profiles = build_brand_profiles(rows)

    per_day: dict[tuple, list[int]] = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        slot = per_day[(r["brand"], r["sent"].date())]
        slot[0] += 1
        slot[1] += 1 if r["is_failure"] else 0

    eligible = [(b, d, n, f, f / n) for (b, d), (n, f) in per_day.items()
                if n >= MIN_DAY_VOLUME]

    flat = [x for x in eligible if x[4] > FLAT_RULE2]
    adaptive = [x for x in eligible
                if x[4] > resolve(profiles.get(x[0]), FLAT_RULE2, "p90DailyRate")[0]]

    print(f"history: {len(rows):,} transactions, {len(per_day):,} brand-days, "
          f"{len(eligible):,} with >={MIN_DAY_VOLUME} transactions")
    print()
    print("RULE 2 — daily failure rate")
    print(f"  flat {FLAT_RULE2:.0%}          {len(flat):5,} alerts  "
          f"({len(flat) / len(eligible):5.1%} of eligible brand-days)")
    print(f"  per-brand p90     {len(adaptive):5,} alerts  "
          f"({len(adaptive) / len(eligible):5.1%} of eligible brand-days)  "
          f"-> {1 - len(adaptive) / len(flat):.0%} fewer")
    print()
    print(f"  {'brand':13s} {'elig':>5s} {'flat':>6s} {'adapt':>6s} {'flat%':>7s} "
          f"{'adapt%':>7s} {'thresh':>7s} {'mode':>8s}")
    tot = collections.Counter(x[0] for x in eligible)
    for brand in sorted(tot, key=lambda b: -tot[b]):
        f_n = sum(1 for x in flat if x[0] == brand)
        a_n = sum(1 for x in adaptive if x[0] == brand)
        thr, mode = resolve(profiles.get(brand), FLAT_RULE2, "p90DailyRate")
        print(f"  {brand:13s} {tot[brand]:5d} {f_n:6d} {a_n:6d} "
              f"{f_n / tot[brand]:7.1%} {a_n / tot[brand]:7.1%} {thr:7.1%} {mode:>8s}")

    print()
    print("CRITICAL SPIKE — absolute severity")
    fc = [x for x in eligible if x[4] >= FLAT_CRITICAL and x[3] >= CRITICAL_MIN_FAILURES]
    ac = [x for x in eligible
          if x[4] >= resolve(profiles.get(x[0]), FLAT_CRITICAL, "p95DailyRate")[0]
          and x[3] >= CRITICAL_MIN_FAILURES]
    print(f"  flat {FLAT_CRITICAL:.0%}          {len(fc):5,} critical days  "
          f"({len(fc) / len(eligible):5.1%})")
    print(f"  per-brand p95     {len(ac):5,} critical days  "
          f"({len(ac) / len(eligible):5.1%})  -> {1 - len(ac) / len(fc):.0%} fewer")
    print()
    print("  brands whose normal rate sits above the flat critical threshold:")
    for brand, p in sorted(profiles.items()):
        if p["baselineRate"] < 0.35:
            continue
        days = [x for x in eligible if x[0] == brand]
        f_n = sum(1 for x in days if x[4] >= FLAT_CRITICAL and x[3] >= CRITICAL_MIN_FAILURES)
        thr, _ = resolve(p, FLAT_CRITICAL, "p95DailyRate")
        a_n = sum(1 for x in days if x[4] >= thr and x[3] >= CRITICAL_MIN_FAILURES)
        print(f"    {brand:13s} baseline {p['baselineRate']:5.1%}  "
              f"flat {f_n:3d}/{len(days):3d} days ({f_n / len(days):4.0%})  "
              f"-> adaptive {a_n:3d} at {thr:.0%}")

    chronic = sorted(b for b, p in profiles.items() if p["chronic"])
    print()
    print(f"CHRONIC (baseline >= {CHRONIC_BASELINE_RATE:.0%}) — context, not alerts")
    print(f"  {len(chronic)}: {', '.join(chronic)}")
    unreliable = sorted(b for b, p in profiles.items() if not p["reliable"])
    print(f"  unreliable (<{MIN_ELIGIBLE_DAYS} eligible days, using flat floors): "
          f"{', '.join(unreliable) or 'none'}")


if __name__ == "__main__":
    main()
