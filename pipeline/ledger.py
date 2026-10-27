"""Append-only forecast ledger.

Every published forecast is written down before kick-off and scored afterwards.
That gives the site a *live* track record built incrementally, instead of relying
on a full historical re-run each day — and because the file is committed to git,
the history of the file is the provenance of every probability ever published.

Two record kinds share one JSONL file:

    {"k":"f", ...}  a forecast, recorded before the match
    {"k":"s", ...}  a settlement, appended once the result is known

The file is line-oriented and never rewritten in normal operation, so a crash
mid-write can at worst lose the final line; ``load`` skips anything unparseable.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER_PATH = ROOT / "data" / "ledger.jsonl"

FORECAST_HORIZON_DAYS = 21   # how far ahead a forecast is worth recording
MIN_SHIFT = 0.02             # re-record only when a probability moves 2 points
SETTLE_TOLERANCE_DAYS = 2    # kickoff (UTC) vs match date (local) can differ a day


# ---------------------------------------------------------------------------
# io
# ---------------------------------------------------------------------------

def load(path: Path | None = None) -> list[dict]:
    """Read the ledger, tolerating a truncated final line."""
    path = path or LEDGER_PATH
    if not path.exists():
        return []
    entries: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if isinstance(entry, dict) and entry.get("k") in ("f", "s"):
                entries.append(entry)
    return entries


def _append(records: list[dict], path: Path) -> int:
    if not records:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return len(records)


def _index(entries: list[dict]) -> tuple[dict[str, dict], set[str]]:
    """Latest forecast per fixture, and the set of already-settled fixtures."""
    forecasts: dict[str, dict] = {}
    settled: set[str] = set()
    for entry in entries:
        fixture_id = entry.get("f")
        if not fixture_id:
            continue
        if entry["k"] == "f":
            current = forecasts.get(fixture_id)
            if current is None or entry.get("t", "") >= current.get("t", ""):
                forecasts[fixture_id] = entry
        else:
            settled.add(fixture_id)
    return forecasts, settled


# ---------------------------------------------------------------------------
# record
# ---------------------------------------------------------------------------

def record(
    fixtures: list[dict],
    *,
    version: str,
    team_names: dict[str, str] | None = None,
    horizon_days: int = FORECAST_HORIZON_DAYS,
    min_shift: float = MIN_SHIFT,
    now: datetime | None = None,
    path: Path | None = None,
) -> dict:
    """Append a forecast for every fixture inside the horizon worth recording.

    ``fixtures`` are the published feed rows. ``team_names`` maps a team id back
    to its football-data name so settlements can match results later.
    """
    path = path or LEDGER_PATH
    now = now or datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    horizon = now + timedelta(days=horizon_days)
    name_of = team_names or {}

    entries = load(path)
    latest, _ = _index(entries)

    fresh: list[dict] = []
    for fixture in fixtures:
        kickoff = _parse_iso(fixture.get("date"))
        if kickoff is None or kickoff > horizon or kickoff < now:
            continue
        previous = latest.get(fixture["id"])
        probs = [round(float(value), 4) for value in fixture["p"]]
        if previous is not None:
            if previous.get("v") != version:
                shift = 1.0
            else:
                shift = max(abs(a - b) for a, b in zip(probs, previous.get("p", [0, 0, 0])))
            if shift < min_shift and previous.get("l") == fixture["league"]:
                continue
        fresh.append(
            {
                "k": "f",
                "f": fixture["id"],
                "l": fixture["league"],
                "h": name_of.get(fixture["home"], fixture["home"]),
                "a": name_of.get(fixture["away"], fixture["away"]),
                "d": fixture["date"],
                "p": probs,
                "lh": round(float(fixture.get("lh", 0)), 3),
                "la": round(float(fixture.get("la", 0)), 3),
                "v": version,
                "t": stamp,
            }
        )

    written = _append(fresh, path)
    return {
        "recorded": written,
        "considered": len(fixtures),
        "totalForecasts": len(latest) + written,
        "path": str(path),
    }


# ---------------------------------------------------------------------------
# settle
# ---------------------------------------------------------------------------

def settle(
    matches: list,
    *,
    as_of: date | None = None,
    now: datetime | None = None,
    path: Path | None = None,
) -> dict:
    """Score every open forecast whose match has since been played."""
    path = path or LEDGER_PATH
    as_of = as_of or date.today()
    now = now or datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    entries = load(path)
    forecasts, settled = _index(entries)
    if not forecasts:
        return {"settled": 0, "open": 0}

    # index results by league + pairing, keeping the date to disambiguate the
    # two legs of a fixture
    results: dict[tuple[str, str, str], list] = defaultdict(list)
    for match in matches:
        if match.played_on > as_of:
            continue
        results[(match.league, match.home, match.away)].append(match)

    fresh: list[dict] = []
    still_open = 0
    for fixture_id, forecast in forecasts.items():
        if fixture_id in settled:
            continue
        candidates = results.get((forecast["l"], forecast["h"], forecast["a"]))
        if not candidates:
            still_open += 1
            continue
        kickoff = _parse_iso(forecast.get("d"))
        if kickoff is None:
            still_open += 1
            continue
        match = min(
            candidates,
            key=lambda item: abs((item.played_on - kickoff.date()).days),
        )
        if abs((match.played_on - kickoff.date()).days) > SETTLE_TOLERANCE_DAYS:
            still_open += 1
            continue

        probs = forecast.get("p") or []
        if len(probs) != 3:
            continue
        outcome = match.outcome
        winner = max(range(3), key=lambda index: probs[index])
        fresh.append(
            {
                "k": "s",
                "f": fixture_id,
                "l": forecast["l"],
                "r": outcome,
                "sc": f"{match.home_goals}-{match.away_goals}",
                "p": probs,
                "b": round(_brier(probs, outcome), 5),
                "ll": round(_log_loss(probs, outcome), 5),
                "hit": winner == outcome,
                "lead": round((kickoff - datetime.fromisoformat(forecast["t"].replace("Z", "+00:00"))).total_seconds() / 3600, 1),
                "t": stamp,
            }
        )

    written = _append(fresh, path)
    return {"settled": written, "open": still_open, "path": str(path)}


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------

def summarise(
    *,
    window_days: int = 180,
    now: datetime | None = None,
    path: Path | None = None,
    leagues: dict[str, dict] | None = None,
) -> dict:
    """Live track record: settled forecasts inside a rolling window."""
    path = path or LEDGER_PATH
    now = now or datetime.now(timezone.utc)
    entries = load(path)
    forecasts, settled_ids = _index(entries)
    settlements = [
        entry for entry in entries
        if entry["k"] == "s" and entry.get("t", "") >= (now - timedelta(days=window_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    ]

    if not settlements:
        return {
            "forecasts": len(forecasts),
            "open": sum(1 for fixture_id in forecasts if fixture_id not in settled_ids),
            "settled": 0,
            "windowDays": window_days,
            "brier": None,
            "logLoss": None,
            "accuracy": None,
            "byLeague": {},
            "firstForecast": _first_stamp(entries),
        }

    brier = sum(entry["b"] for entry in settlements) / len(settlements)
    log_loss = sum(entry["ll"] for entry in settlements) / len(settlements)
    accuracy = sum(1 for entry in settlements if entry["hit"]) / len(settlements)

    by_league: dict[str, dict] = {}
    for entry in settlements:
        bucket = by_league.setdefault(entry["l"], {"n": 0, "brier": 0.0, "hits": 0})
        bucket["n"] += 1
        bucket["brier"] += entry["b"]
        bucket["hits"] += 1 if entry["hit"] else 0
    for code, bucket in by_league.items():
        bucket["brier"] = round(bucket["brier"] / bucket["n"], 4)
        bucket["accuracy"] = round(bucket["hits"] / bucket["n"] * 100, 1)
        bucket["name"] = (leagues or {}).get(code, {}).get("name", code)
        del bucket["hits"]

    return {
        "forecasts": len(forecasts),
        "open": sum(1 for fixture_id in forecasts if fixture_id not in settled_ids),
        "settled": len(settlements),
        "windowDays": window_days,
        "brier": round(brier, 4),
        "logLoss": round(log_loss, 4),
        "accuracy": round(accuracy * 100, 1),
        "byLeague": by_league,
        "firstForecast": _first_stamp(entries),
        "lastSettled": max(entry["t"] for entry in settlements),
    }


def compact(*, keep_days: int = 400, now: datetime | None = None, path: Path | None = None) -> dict:
    """Rewrite the ledger, dropping superseded forecasts and old settlements.

    Not run automatically: the file is small (a few MB a year) and keeping it
    intact is the point. Provided for the day it stops being small.
    """
    path = path or LEDGER_PATH
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=keep_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    entries = load(path)
    latest, _ = _index(entries)
    keep: list[dict] = []
    for entry in entries:
        if entry["k"] == "s":
            if entry.get("t", "") >= cutoff:
                keep.append(entry)
        elif entry.get("f") in latest and latest[entry["f"]] is entry:
            keep.append(entry)
    before = len(entries)
    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for entry in keep:
            handle.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    return {"before": before, "after": len(keep), "path": str(path)}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _brier(probs: list[float], outcome: int) -> float:
    return sum((probs[index] - (1.0 if index == outcome else 0.0)) ** 2 for index in range(3)) / 3


def _log_loss(probs: list[float], outcome: int) -> float:
    import math

    return -math.log(max(probs[outcome], 1e-12))


def _first_stamp(entries: list[dict]) -> str | None:
    stamps = [entry.get("t") for entry in entries if entry.get("t")]
    return min(stamps) if stamps else None


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Inspect the Footyline ledger.")
    parser.add_argument("--path", type=Path, default=LEDGER_PATH)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    if args.compact:
        print(compact(path=args.path))
    else:
        print(json.dumps(summarise(path=args.path), indent=1))
