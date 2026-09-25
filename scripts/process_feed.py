#!/usr/bin/env python3
"""Normalize the AWS public health feed (health.aws.amazon.com/public/currentevents)
into a clean UTF-8 JSON snapshot for the dashboard.

Usage:
    python3 scripts/process_feed.py <input_feed> <output_snapshot>
    …  or run with no args (reads intput from positional or stdin, writes to
       data/health-snapshot.json next to the script).

The source endpoint returns a UTF-16 LE JSON array of currently-active health
events. We decode it, add derived fields, and re-emit as compact UTF-8 JSON so
browsers can parse it without issues and the site renders deterministically.
"""

import json
import sys
from datetime import datetime, timezone

STATUS_LABEL = {0: "Normal", 1: "Informational", 2: "Degraded", 3: "Disruption"}


def iso(epoch_ms_or_s):
    """Convert an epoch (seconds or ms) to an ISO-8601 UTC string (nanosecond-precision inputs handled)."""
    if epoch_ms_or_s is None:
        return None
    v = int(epoch_ms_or_s)
    # Heuristic: values > 1e12 are milliseconds.
    return datetime.fromtimestamp(v / 1000.0 if v > 1_000_000_000_000 else v, tz=timezone.utc).isoformat()


def normalize_event(ev):
    region_code = None
    arn = ev.get("arn", "")
    for part in arn.split("/")[0].split(":"):
        if part and "::" not in part and "aws" not in part.lower() and part != "arn":
            # arn:aws:health:REGION::event/...
            region_code = part
            break
    # region_code derivation: arn = arn:aws:health:me-central-1::event/...
    parts = arn.split(":")
    if len(parts) >= 4:
        region_code = parts[3]

    status_changes = [
        {
            "service": c.get("service"),
            "service_name": c.get("service_name"),
            "previous_status": c.get("previous_status"),
            "current_status": c.get("current_status"),
            "status_label": STATUS_LABEL.get(int(c.get("current_status", 0)), c.get("current_status")),
            "timestamp_unix": c.get("timestamp"),
            "timestamp_iso": iso(c.get("timestamp")),
        }
        for c in ev.get("impacted_service_status_changes", [])
    ]

    impacted = [
        {
            "service": k,
            "service_name": v.get("service_name"),
            "current": int(v.get("current", 0)),
            "max": int(v.get("max", 0)),
            "status_label": STATUS_LABEL.get(int(v.get("current", 0)), v.get("current")),
        }
        for k, v in sorted((ev.get("impacted_services") or {}).items())
    ]

    return {
        "event_id": arn.rsplit("/", 1)[-1] if "/" in arn else arn,
        "arn": arn,
        "service": ev.get("service"),
        "service_name": ev.get("service_name"),
        "region": region_code,
        "region_name": ev.get("region_name"),
        "status": int(ev.get("status") or 0),
        "status_label": STATUS_LABEL.get(int(ev.get("status") or 0), ev.get("status")),
        "summary": ev.get("summary"),
        "date_unix": int(ev.get("date") or 0),
        "date_iso": iso(ev.get("date")),
        "event_log": [
            {
                "summary": m.get("summary"),
                "message": m.get("message"),
                "status": m.get("status"),
                "status_label": STATUS_LABEL.get(int(m.get("status") or 0), m.get("status")),
                "timestamp_unix": m.get("timestamp"),
                "timestamp_iso": iso(m.get("timestamp")),
            }
            for m in ev.get("event_log", [])
        ],
        "impacted_services": impacted,
        "status_changes": status_changes,
    }


def main():
    if len(sys.argv) >= 3:
        in_path, out_path = sys.argv[1], sys.argv[2]
    else:
        in_path, out_path = "-", "data/health-snapshot.json"

    with sys.stdin.buffer if in_path == "-" else open(in_path, "rb") as fh:
        raw = fh.read()

    text = raw.decode("utf-16")
    events = json.loads(text)

    snapshot = {
        "generated_at_unix": int(datetime.now(tz=timezone.utc).timestamp()),
        "generated_at_iso": datetime.now(tz=timezone.utc).isoformat(),
        "source": "https://health.aws.amazon.com/public/currentevents",
        "event_count": len(events),
        "events": [normalize_event(ev) for ev in events],
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"wrote {out_path}: {len(events)} active event(s)")


if __name__ == "__main__":
    main()
