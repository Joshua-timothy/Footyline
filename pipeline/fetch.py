"""Download and cache the raw open datasets used by Footyline.

Behaviour that matters for an unattended service:

* Conditional GET — sends ``If-None-Match`` / ``If-Modified-Since`` so an
  unchanged upstream costs a 304 and no bandwidth.
* TTL floor — a file checked within the last ``--ttl`` hours is not re-requested
  at all, which keeps two cron runs a day cheap.
* ``--force`` — ignore validators and TTL, always fetch and overwrite.
* Never lose a good cache — if upstream fails, the last good copy is used and the
  failure is recorded in the manifest instead of crashing the build.
* Seasons are derived from the clock (see seasons.py), so a new season needs no
  edit here.

Writes ``cache/fetch-manifest.json`` describing exactly what was fetched, which
``build.py`` uses to pick the live season and report data freshness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import LEAGUES
from seasons import (
    current as current_season,
    fixture_year,
    history as history_seasons,
    label as season_label,
)

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
CACHE.mkdir(exist_ok=True)
STATE_PATH = CACHE / ".fetch-state.json"
MANIFEST_PATH = CACHE / "fetch-manifest.json"

FD_BASE = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv"
FX_BASE = "https://fixturedownload.com/feed/json/{slug}-{year}"
USER_AGENT = "Mozilla/5.0 (compatible; FootylineData/2.0; +https://example.invalid/footyline)"

DEFAULT_TTL_HOURS = 6.0
MIN_BYTES = 200
TIMEOUT = 45


# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_json_atomic(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# one request
# ---------------------------------------------------------------------------

@dataclass
class Outcome:
    url: str
    status: str            # updated | not-modified | fresh-cache | fallback-cache | missing | failed
    payload: bytes | None
    size: int
    from_cache: bool
    detail: str = ""

    def manifest(self) -> dict:
        entry = {"status": self.status, "bytes": self.size, "fromCache": self.from_cache}
        if self.detail:
            entry["detail"] = self.detail
        return entry


def _http(url: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        if error.code in (304, 404):
            return error.code, dict(error.headers or {}), b""
        raise


def fetch(
    url: str,
    dest: Path,
    *,
    force: bool = False,
    ttl_hours: float = DEFAULT_TTL_HOURS,
    allow_missing: bool = True,
    state: dict | None = None,
    retries: int = 3,
) -> Outcome:
    """Fetch one resource into ``dest`` with validation, caching and fallback."""
    state = state if state is not None else {}
    record = state.get(url, {})
    cached = dest.exists() and dest.stat().st_size >= MIN_BYTES

    # 1. TTL floor: recently checked and present on disk is good enough.
    if cached and not force:
        checked = record.get("checkedAt")
        if checked:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(checked)
            if age < timedelta(hours=ttl_hours):
                return Outcome(url, "fresh-cache", dest.read_bytes(), dest.stat().st_size, True)

    # 2. Conditional request.
    headers: dict[str, str] = {}
    if cached and not force:
        if record.get("etag"):
            headers["If-None-Match"] = record["etag"]
        if record.get("lastModified"):
            headers["If-Modified-Since"] = record["lastModified"]

    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            status, response_headers, payload = _http(url, headers)
            now = datetime.now(timezone.utc).isoformat()

            if status == 304 and cached:
                state[url] = {**record, "checkedAt": now}
                return Outcome(url, "not-modified", dest.read_bytes(), dest.stat().st_size, True)

            if status == 404:
                if cached:
                    state[url] = {**record, "checkedAt": now, "missing": True}
                    return Outcome(url, "fallback-cache", dest.read_bytes(), dest.stat().st_size, True,
                                   detail="upstream 404, using cache")
                if allow_missing:
                    state[url] = {**record, "checkedAt": now, "missing": True}
                    return Outcome(url, "missing", None, 0, False, detail="upstream 404")
                raise RuntimeError(f"404 not found: {url}")

            if len(payload) < MIN_BYTES:
                raise ValueError(f"suspiciously small payload ({len(payload)} bytes)")

            # 3. Write atomically so a half-downloaded CSV can never be read.
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            tmp.write_bytes(payload)
            os.replace(tmp, dest)

            state[url] = {
                "checkedAt": now,
                "etag": response_headers.get("ETag"),
                "lastModified": response_headers.get("Last-Modified"),
                "sha1": hashlib.sha1(payload).hexdigest(),
                "bytes": len(payload),
            }
            return Outcome(url, "updated", payload, len(payload), False)

        except Exception as error:  # noqa: BLE001 - retried below
            last_error = error
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))

    # 4. Upstream is down: degrading to the last good copy is better than
    #    publishing nothing.
    if cached:
        return Outcome(url, "fallback-cache", dest.read_bytes(), dest.stat().st_size, True,
                       detail=str(last_error))
    return Outcome(url, "failed", None, 0, False, detail=str(last_error))


# ---------------------------------------------------------------------------
# datasets
# ---------------------------------------------------------------------------

def fetch_results(
    leagues: list[dict],
    seasons: list[str],
    *,
    force: bool,
    ttl_hours: float,
    state: dict,
    manifest: dict,
) -> None:
    for league in leagues:
        code = league["code"]
        manifest["results"].setdefault(code, {})
        for season in seasons:
            url = FD_BASE.format(season=season, code=code)
            dest = CACHE / f"results_{season}_{code}.csv"
            outcome = fetch(url, dest, force=force, ttl_hours=ttl_hours, state=state)
            manifest["results"][code][season] = outcome.manifest()
            if outcome.payload is not None:
                manifest["dataAsOf"] = max(manifest.get("dataAsOf") or "", _last_date(dest))
            if outcome.status == "failed":
                manifest["errors"].append(f"{code} {season}: {outcome.detail}")
        updated = sum(1 for row in manifest["results"][code].values() if row["status"] == "updated")
        print(f"  results {code}: {len(seasons)} seasons, {updated} updated")


def _last_date(path: Path) -> str:
    """Newest match date in a football-data CSV (dd/mm/yyyy -> iso)."""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    for line in reversed(lines[1:]):
        parts = line.split(",")
        if len(parts) < 3:
            continue
        try:
            day, month, year = parts[1].strip().split("/")
            return f"{year}-{month}-{day}"
        except ValueError:
            continue
    return ""


def fetch_fixtures(
    leagues: list[dict],
    season: str,
    *,
    force: bool,
    ttl_hours: float,
    state: dict,
    manifest: dict,
) -> None:
    """Fetch each competition's full-season calendar.

    fixturedownload labels calendars by the season's start year; if that file is
    not published yet we try the end year before giving up.
    """
    start_year = fixture_year(season)
    candidates = [start_year, start_year + 1]
    for league in leagues:
        slug = league["slug"]
        outcome = None
        used_year = None
        for year in candidates:
            url = FX_BASE.format(slug=slug, year=year)
            dest = CACHE / f"fixtures_{slug}_{year}.json"
            outcome = fetch(url, dest, force=force, ttl_hours=ttl_hours, state=state)
            if outcome.payload is not None:
                used_year = year
                break
        if outcome is None or outcome.payload is None:
            manifest["fixtures"][slug] = {"status": "missing", "matches": 0}
            manifest["errors"].append(f"{slug}: no calendar found")
            print(f"  fixtures {slug}: MISSING")
            continue
        try:
            rows = json.loads(outcome.payload)
        except ValueError as error:
            manifest["fixtures"][slug] = {"status": "failed", "matches": 0, "detail": str(error)}
            manifest["errors"].append(f"{slug}: unreadable calendar")
            continue
        manifest["fixtures"][slug] = {**outcome.manifest(), "matches": len(rows), "year": used_year}
        print(f"  fixtures {slug}-{used_year}: {len(rows)} matches ({outcome.status})")


# ---------------------------------------------------------------------------
# orchestrator
# ---------------------------------------------------------------------------

def infer_live_season(manifest: dict, seasons: list[str], requested: str) -> str:
    """Newest season with an actual results file; falls back to the previous one.

    In early July the new season's CSV does not exist yet, so the pipeline would
    otherwise have no live season at all.
    """
    for season in reversed(seasons):
        rows = [
            league.get(season, {})
            for league in manifest["results"].values()
        ]
        usable = [
            row for row in rows
            if row.get("status") in ("updated", "not-modified", "fresh-cache", "fallback-cache")
        ]
        if len(usable) >= max(1, len(rows) // 2):
            if season != requested:
                manifest["notes"].append(
                    f"{requested} not published upstream yet; using {season} as the live season"
                )
            return season
    return requested


def fetch_all(
    *,
    force: bool = False,
    ttl_hours: float = DEFAULT_TTL_HOURS,
    leagues: list[dict] | None = None,
    season: str | None = None,
    history_count: int | None = None,
) -> dict:
    leagues = leagues or LEAGUES
    requested = season or current_season()
    seasons = history_seasons(count=history_count) if history_count else history_seasons()
    if requested not in seasons:
        seasons = seasons + [requested]

    state = _read_json(STATE_PATH)
    manifest: dict = {
        "requestedSeason": requested,
        "seasons": seasons,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "force": force,
        "ttlHours": ttl_hours,
        "results": {},
        "fixtures": {},
        "errors": [],
        "notes": [],
        "dataAsOf": "",
    }
    started = time.time()

    print(f"Results: {len(leagues)} competitions x {len(seasons)} seasons")
    fetch_results(leagues, seasons, force=force, ttl_hours=ttl_hours, state=state, manifest=manifest)

    live = infer_live_season(manifest, seasons, requested)
    manifest["liveSeason"] = live
    manifest["seasonLabel"] = season_label(live)
    print(f"Live season: {live} ({season_label(live)})")

    print("Fixture calendars")
    fetch_fixtures(leagues, live, force=force, ttl_hours=ttl_hours, state=state, manifest=manifest)

    manifest["durationSeconds"] = round(time.time() - started, 1)
    manifest["finishedAt"] = datetime.now(timezone.utc).isoformat()
    _write_json_atomic(STATE_PATH, state)
    _write_json_atomic(MANIFEST_PATH, manifest)

    if manifest["errors"]:
        print(f"Warnings: {len(manifest['errors'])}")
        for message in manifest["errors"][:10]:
            print(f"  ! {message}")
    return manifest


def read_manifest() -> dict:
    """Manifest from the last fetch, or an empty dict when there is none."""
    return _read_json(MANIFEST_PATH)


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh Footyline's raw data.")
    parser.add_argument("--force", action="store_true", help="ignore TTL and validators")
    parser.add_argument("--ttl", type=float, default=DEFAULT_TTL_HOURS, help="hours before rechecking")
    parser.add_argument("--season", help="override the derived live season (debugging)")
    parser.add_argument("--history", type=int, help="how many seasons to fetch")
    parser.add_argument("--leagues", help="comma separated division codes (debugging)")
    args = parser.parse_args()

    leagues = LEAGUES
    if args.leagues:
        wanted = {code.strip().upper() for code in args.leagues.split(",")}
        leagues = [league for league in LEAGUES if league["code"] in wanted]
        if not leagues:
            raise SystemExit(f"no known leagues in {args.leagues!r}")

    manifest = fetch_all(
        force=args.force,
        ttl_hours=args.ttl,
        leagues=leagues,
        season=args.season,
        history_count=args.history,
    )
    print(
        f"Done in {manifest['durationSeconds']}s — live {manifest['liveSeason']}, "
        f"data to {manifest.get('dataAsOf') or 'n/a'}, {len(manifest['errors'])} warnings"
    )


if __name__ == "__main__":
    main()
