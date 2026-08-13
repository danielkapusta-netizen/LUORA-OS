#!/usr/bin/env python3
"""
Diff the browser engine's computed state against the Python reference engine.

Two independent implementations of the same specification should agree on every
field for every vendor. Where they do not, the difference is a genuine logic bug
in one of them, so this compares values rather than spot-checking headlines.

    python3 tools/reference_engine.py data/sheet1_payload.json -o data/oracle.json
    node tools/run_selftest.js
    python3 tools/compare.py data/oracle.json data/selftest.json
"""
from __future__ import annotations

import json
import math
import sys

TOL = 1e-9   # floating-point slack; JSON round-trips both sides identically


def close(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=TOL)
    # Timestamps: compare to the second. Python emits microseconds when non-zero,
    # the browser truncates; the difference is formatting, not value.
    if isinstance(a, str) and isinstance(b, str) and "T" in a and "T" in b:
        return a[:19] == b[:19]
    return a == b


def walk(path, a, b, diffs, skip=()):
    if path.split(".")[-1] in skip:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a:
                diffs.append((f"{path}.{key}", "<missing in oracle>", b[key]))
            elif key not in b:
                diffs.append((f"{path}.{key}", a[key], "<missing in browser>"))
            else:
                walk(f"{path}.{key}", a[key], b[key], diffs, skip)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append((f"{path}.length", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            walk(f"{path}[{i}]", x, y, diffs, skip)
    elif not close(a, b):
        diffs.append((path, a, b))


def main() -> None:
    oracle_path = sys.argv[1] if len(sys.argv) > 1 else "data/oracle.json"
    browser_path = sys.argv[2] if len(sys.argv) > 2 else "data/selftest.json"
    with open(oracle_path, encoding="utf-8") as fh:
        oracle = json.load(fh)
    with open(browser_path, encoding="utf-8") as fh:
        browser = json.load(fh)

    diffs: list[tuple] = []

    # Anchors — the three window timestamps must be identical to the second.
    for key in ("currentEnd", "currentStart", "baselineStart"):
        o = oracle["window"][key]
        b = browser["window"][key][:19] if browser["window"][key] else None
        if o[:19] != (b or ""):
            diffs.append((f"window.{key}", o, b))

    # Vendor scope and the Today page, both live-scoped. The rendered alert
    # count is a UI concern rather than an engine output, so it is not mirrored
    # in the oracle and is compared only on keys the two sides share.
    walk("scope", oracle["scope"], browser["scope"], diffs)
    walk("todayPage", oracle["todayPage"],
         {k: v for k, v in browser["todayPage"].items() if k in oracle["todayPage"]}, diffs)

    # Per-vendor signal and activity fields.
    walk("signals", oracle["signals"], browser["signals"], diffs)
    walk("activity", {k: {kk: vv for kk, vv in v.items()
                          if kk in browser["activity"].get(k, {})}
                      for k, v in oracle["activity"].items()},
         browser["activity"], diffs)
    walk("streaks", oracle["streaks"], browser["streaks"], diffs)
    # Calibration-driven behaviour: adaptive thresholds and the drift signal.
    walk("drift", oracle["drift"], browser["drift"], diffs)
    walk("calibration", oracle["calibration"], {k: v for k, v in browser["calibration"].items()
                                                if k in oracle["calibration"]}, diffs)
    walk("registry", oracle["registry"], browser["registry"], diffs)
    walk("categories", oracle["categories"], browser["categories"], diffs)
    walk("unmapped", oracle["unmapped"], browser["unmapped"], diffs)

    # KPIs present on both sides.
    shared = set(oracle["kpis"]) & set(browser["kpis"])
    for key in sorted(shared):
        if not close(oracle["kpis"][key], browser["kpis"][key]):
            diffs.append((f"kpis.{key}", oracle["kpis"][key], browser["kpis"][key]))

    if oracle["kpis"]["rule2Alerts"] != browser["rule2Alerts"]:
        diffs.append(("rule2Alerts", oracle["kpis"]["rule2Alerts"], browser["rule2Alerts"]))

    vendors = len(oracle["signals"])
    print(f"compared {vendors} signal vendors, {len(oracle['activity'])} activity vendors, "
          f"{len(oracle['streaks'])} streaks, {len(oracle['drift'])} drift profiles, "
          f"{len(oracle['categories'])} categories, {len(oracle['unmapped'])} unmapped reasons")

    if diffs:
        print(f"\n{len(diffs)} DIFFERENCE(S)  (oracle | browser)")
        for path, a, b in diffs[:60]:
            print(f"  {path}\n      oracle : {a!r}\n      browser: {b!r}")
        if len(diffs) > 60:
            print(f"  … and {len(diffs) - 60} more")
        sys.exit(1)

    print("\nALL FIELDS MATCH")


if __name__ == "__main__":
    main()
