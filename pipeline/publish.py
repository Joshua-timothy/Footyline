"""Validation gates and atomic publishing.

A scheduled pipeline fails silently if it publishes garbage, so every artifact is
checked before it can replace the live one:

* structural checks on the feed (required keys, resolvable team and league ids,
  probability rows that sum to 1, kick-off dates in a sane range, unique ids);
* a stability check against the previous published feed, so a truncated or empty
  upstream file cannot wipe the site;
* atomic writes — every file is written to a temporary sibling and moved into
  place, so a reader never sees a half-written feed, and a failed validation
  leaves yesterday's files untouched.

``publish`` raises ``PublishError`` with the full list of problems, which the
GitHub Actions job surfaces as a failed run rather than a bad deploy.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

REQUIRED_FEED_KEYS = {"generatedAt", "season", "asOf", "leagues", "teams", "fixtures"}
MAX_FIXTURE_DROP = 0.40      # fail if the board shrinks by more than 40%
MAX_FIXTURE_SPIKE = 0.60     # ...or grows by more than 60%
PROBABILITY_TOLERANCE = 0.012
SANITY_GOALS = (0.05, 7.5)


class PublishError(RuntimeError):
    def __init__(self, errors: list[str], warnings: list[str] | None = None) -> None:
        self.errors = errors
        self.warnings = warnings or []
        super().__init__("; ".join(errors))


# ---------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------

def _parse(moment: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(moment).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def validate_feed(feed: dict, previous: dict | None = None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(feed, dict):
        return ["feed is not a JSON object"], warnings

    missing = REQUIRED_FEED_KEYS - set(feed)
    if missing:
        errors.append(f"missing top-level keys: {sorted(missing)}")
        return errors, warnings  # nothing else is meaningful

    generated = _parse(feed["generatedAt"])
    if generated is None:
        errors.append("generatedAt is not an ISO timestamp")
    elif generated > datetime.now(timezone.utc) + timedelta(minutes=10):
        warnings.append("generatedAt is in the future")

    leagues = feed.get("leagues") or []
    teams = feed.get("teams") or {}
    fixtures = feed.get("fixtures") or []
    if not isinstance(leagues, list) or not leagues:
        errors.append("no leagues published")
    if not isinstance(teams, dict) or not teams:
        errors.append("no teams published")
    if not isinstance(fixtures, list) or not fixtures:
        errors.append("no fixtures published")
    if errors:
        return errors, warnings

    league_codes = [league.get("code") for league in leagues]
    if len(league_codes) != len(set(league_codes)):
        errors.append("duplicate league codes")

    for league in leagues:
        if not league.get("id") or not league.get("name"):
            errors.append(f"league {league.get('code')!r} missing id or name")
            continue
        if not league.get("table"):
            warnings.append(f"{league['name']}: empty table")
        upcoming = sum(1 for fixture in fixtures if fixture.get("league") == league["code"])
        if upcoming == 0:
            warnings.append(f"{league['name']}: no upcoming fixtures")

    for team_id, team in teams.items():
        if team.get("id") != team_id:
            errors.append(f"team key/id mismatch for {team_id!r}")
            break
        if not team.get("name") or not team.get("short"):
            errors.append(f"team {team_id!r} missing name or short code")
            break
        colour = str(team.get("color", ""))
        if not (len(colour) == 7 and colour.startswith("#")):
            warnings.append(f"team {team_id!r} has an odd colour: {colour!r}")
            break

    seen_ids: set[str] = set()
    now = datetime.now(timezone.utc)
    earliest = now - timedelta(days=1)
    latest = now + timedelta(days=420)
    bad_probability = 0
    bad_goals = 0
    for fixture in fixtures:
        fixture_id = fixture.get("id")
        if not fixture_id:
            errors.append("fixture without an id")
            break
        if fixture_id in seen_ids:
            errors.append(f"duplicate fixture id {fixture_id!r}")
            break
        seen_ids.add(fixture_id)

        if fixture.get("league") not in league_codes:
            errors.append(f"{fixture_id}: unknown league {fixture.get('league')!r}")
            break
        if fixture.get("home") not in teams or fixture.get("away") not in teams:
            errors.append(f"{fixture_id}: unresolved team id")
            break

        kickoff = _parse(fixture.get("date"))
        if kickoff is None:
            errors.append(f"{fixture_id}: unparseable kick-off {fixture.get('date')!r}")
            break
        if not earliest <= kickoff <= latest:
            errors.append(f"{fixture_id}: kick-off outside the publishing window ({fixture['date']})")
            break

        probabilities = fixture.get("p")
        if not (isinstance(probabilities, list) and len(probabilities) == 3):
            errors.append(f"{fixture_id}: probability row is not a triplet")
            break
        if abs(sum(probabilities) - 1.0) > PROBABILITY_TOLERANCE:
            bad_probability += 1
        if any((not isinstance(value, (int, float))) or value < 0 or value > 1 for value in probabilities):
            errors.append(f"{fixture_id}: probability outside [0, 1]")
            break

        for key in ("lh", "la"):
            value = fixture.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                errors.append(f"{fixture_id}: {key} is not a finite number")
                break
            if not SANITY_GOALS[0] <= value <= SANITY_GOALS[1]:
                bad_goals += 1
        else:
            continue
        break

    if bad_probability:
        warnings.append(f"{bad_probability} fixtures have probabilities that do not sum to 1")
    if bad_goals:
        warnings.append(f"{bad_goals} fixtures have expected goals outside the sane range")

    # stability against the previously published feed
    if previous and previous.get("fixtures"):
        before = len(previous["fixtures"])
        after = len(fixtures)
        if before and after < before * (1 - MAX_FIXTURE_DROP):
            errors.append(f"fixture count collapsed from {before} to {after}")
        if before and after > before * (1 + MAX_FIXTURE_SPIKE):
            warnings.append(f"fixture count jumped from {before} to {after}")
        previous_teams = set((previous.get("teams") or {}).keys())
        if previous_teams and len(previous_teams - set(teams)) > max(5, len(previous_teams) * 0.2):
            errors.append("more than 20% of clubs disappeared from the feed")

    return errors, warnings


def validate_metrics(metrics: dict) -> list[str]:
    errors: list[str] = []
    if not isinstance(metrics, dict):
        return ["metrics is not a JSON object"]
    if not metrics.get("generatedAt"):
        errors.append("metrics.generatedAt missing")
    summary = metrics.get("summary")
    if not isinstance(summary, dict) or "matches" not in summary:
        errors.append("metrics.summary missing or incomplete")
    return errors


# ---------------------------------------------------------------------------
# publishing
# ---------------------------------------------------------------------------

def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def _read_previous(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def publish(
    feed: dict,
    metrics: dict,
    meta: dict,
    *,
    data_dir: Path | None = None,
    dry_run: bool = False,
) -> dict:
    """Validate, then atomically replace feed.json, metrics.json and meta.json."""
    data_dir = data_dir or DATA
    feed_path = data_dir / "feed.json"
    metrics_path = data_dir / "metrics.json"
    meta_path = data_dir / "meta.json"

    previous = _read_previous(feed_path)
    errors, warnings = validate_feed(feed, previous)
    errors += validate_metrics(metrics)
    if errors:
        raise PublishError(errors, warnings)

    feed_text = json.dumps(feed, separators=(",", ":"), ensure_ascii=False)
    metrics_text = json.dumps(metrics, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha1(feed_text.encode("utf-8")).hexdigest()[:12]
    payload_meta = {
        **meta,
        "feedBytes": len(feed_text.encode("utf-8")),
        "feedSha1": digest,
        "fixtures": len(feed["fixtures"]),
        "leagues": len(feed["leagues"]),
        "teams": len(feed["teams"]),
    }
    meta_text = json.dumps(payload_meta, separators=(",", ":"), ensure_ascii=False)

    if dry_run:
        return {"dryRun": True, "warnings": warnings, "meta": payload_meta}

    # metrics first: if the process dies between the two writes the site keeps
    # serving the previous feed with slightly newer metrics, which is harmless.
    atomic_write(metrics_path, metrics_text)
    atomic_write(feed_path, feed_text)
    atomic_write(meta_path, meta_text)
    return {
        "warnings": warnings,
        "feedBytes": len(feed_text.encode("utf-8")),
        "metricsBytes": len(metrics_text.encode("utf-8")),
        "meta": payload_meta,
    }
