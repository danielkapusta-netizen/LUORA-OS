#!/usr/bin/env python3
"""
Assemble the standalone dashboard by injecting the Sheet1 payload into the
template.

The output, rpa-monitor.html, is the deliverable: one file, no build step at
runtime, no network access, opens by double-clicking. This script exists only so
the 1.25 MB data payload does not have to be hand-edited into the template when
Sheet1 changes.

    python3 tools/extract_sheet1.py data/source_workbook.xlsx data/sheet1_payload.json
    python3 tools/build.py
"""
from __future__ import annotations

import json
import sys

TEMPLATE = "src/rpa-monitor.template.html"
PAYLOAD = "data/sheet1_payload.json"
OUTPUT = "rpa-monitor.html"
TOKEN = "__DATA_PAYLOAD__"


def main() -> None:
    template = sys.argv[1] if len(sys.argv) > 1 else TEMPLATE
    payload_path = sys.argv[2] if len(sys.argv) > 2 else PAYLOAD
    output = sys.argv[3] if len(sys.argv) > 3 else OUTPUT

    with open(template, encoding="utf-8") as fh:
        html = fh.read()
    if TOKEN not in html:
        raise SystemExit(f"{template} does not contain {TOKEN}")

    with open(payload_path, encoding="utf-8") as fh:
        payload = json.load(fh)

    # Only the five transaction fields travel into the page — every source row,
    # malformed ones included. The extractor's own ledger stays out: the
    # dashboard re-derives it at runtime from the same rules, so a replacement
    # dataset gets an equally complete ledger rather than one inherited here.
    embedded = {
        "statuses": payload["statuses"],
        "vendors": payload["vendors"],
        "reasons": payload["reasons"],
        "rows": payload["rows"],
    }
    # </script> inside reason text would terminate the script block early; this
    # dataset really does contain HTML in its free-text fields.
    encoded = (json.dumps(embedded, separators=(",", ":"), ensure_ascii=False)
               .replace("</", "<\\/")
               .replace(" ", "\\u2028")
               .replace(" ", "\\u2029"))

    out = html.replace(TOKEN, encoded)
    with open(output, "w", encoding="utf-8") as fh:
        fh.write(out)

    print(f"wrote {output}  ({len(out.encode()) / 1e6:.2f} MB)")
    print(f"  {len(embedded['rows']):,} transactions, "
          f"{len(embedded['vendors'])} vendors, {len(embedded['reasons']):,} distinct reasons")


if __name__ == "__main__":
    main()
