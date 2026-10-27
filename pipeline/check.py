"""Post-build verification for CI.

``publish.py`` stops a bad feed from being written; this checks that what was
written is coherent and fresh enough to deploy. Run it after ``build.py`` in the
workflow, and locally before a manual deploy.

Exit codes: 0 ok, 1 failed, and warnings are printed but do not fail the run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _parse(stamp: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def check(
    *,
    data_dir: Path = DATA,
    max_build_age_hours: float = 12.0,
    warn_data_age_days: float = 5.0,
    fail_data_age_days: float = 14.0,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    now = datetime.now(timezone.utc)

    for name in ("feed.json", "metrics.json", "meta.json", "ledger.jsonl"):
        path = data_dir / name
        if not path.exists():
            errors.append(f"{name} is missing")
        elif path.stat().st_size < 100:
            errors.append(f"{name} is suspiciously small")
    if errors:
        return errors, warnings

    meta = _read_json(data_dir / "meta.json")
    feed_text = (data_dir / "feed.json").read_text(encoding="utf-8")
    feed = json.loads(feed_text)
    metrics = _read_json(data_dir / "metrics.json")

    # 1. the build itself is recent
    built = _parse(meta.get("generatedAt", ""))
    if built is None:
        errors.append("meta.generatedAt is not a timestamp")
    else:
        age = (now - built).total_seconds() / 3600
        if age > max_build_age_hours:
            warnings.append(f"meta is {age:.1f}h old (limit {max_build_age_hours}h)")

    # 2. the artifacts agree with each other
    digest = hashlib.sha1(feed_text.encode("utf-8")).hexdigest()[:12]
    if meta.get("feedSha1") != digest:
        errors.append("feed.json does not match meta.feedSha1 (partial publish?)")
    if meta.get("fixtures") != len(feed.get("fixtures", [])):
        errors.append("fixture count differs between feed and meta")
    if not feed.get("fixtures"):
        errors.append("feed has no fixtures")

    # 3. the data behind it is not stale
    data_as_of = _parse(f"{meta.get('dataAsOf', '')}T00:00:00+00:00")
    if data_as_of is None:
        warnings.append("meta.dataAsOf missing")
    else:
        data_age = (now - data_as_of).days
        if data_age > fail_data_age_days:
            errors.append(f"results data is {data_age} days old (limit {fail_data_age_days})")
        elif data_age > warn_data_age_days:
            warnings.append(f"results data is {data_age} days old")

    # 4. the audit is present and the live record is coherent
    if not (metrics.get("summary") or {}).get("matches"):
        errors.append("metrics.summary has no backtested matches")
    live = metrics.get("live") or {}
    if live.get("settled") and live.get("brier") is None:
        errors.append("live record has settlements but no Brier score")

    # 5. the ledger parses and has forecasts
    ledger_lines = 0
    malformed = 0
    for line in (data_dir / "ledger.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            json.loads(line)
            ledger_lines += 1
        except ValueError:
            malformed += 1
    if malformed:
        errors.append(f"{malformed} malformed ledger lines")
    if ledger_lines == 0:
        errors.append("ledger is empty")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the published Footyline artifacts.")
    parser.add_argument("--max-age-hours", type=float, default=12.0)
    parser.add_argument("--data-dir", type=Path, default=DATA)
    args = parser.parse_args()

    errors, warnings = check(data_dir=args.data_dir, max_build_age_hours=args.max_age_hours)
    for message in warnings:
        print(f"warning: {message}")
    for message in errors:
        print(f"error: {message}")
    if errors:
        print(f"FAILED: {len(errors)} problem(s)")
        return 1
    print("artifacts look good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
