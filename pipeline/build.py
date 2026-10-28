"""Build the static data feed consumed by the Footyline web app.

Two modes:

``--mode weekly``  full rebuild, including the walk-forward backtest that powers
                   the model page. This is the audit run.
``--mode daily``   refit and re-predict only, reusing the last audit. Around a
                   minute instead of five, which is what makes two runs a day
                   affordable.

Every run records its forecasts to the append-only ledger and publishes through
``publish.py``, which refuses to overwrite a good feed with a bad one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

import ledger
import seasons
from config import LEAGUE_BY_CODE, LEAGUES, MODEL
from fetch import read_manifest
from model import (
    Match, build_name_map, elo_table, fit_ratings, load_fixture_calendar,
    load_matches, market_probabilities, normalise, score_matrix, walk_forward,
)
from publish import PublishError, publish

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
CACHE = Path(__file__).resolve().parent / "cache"

NOW = datetime.now(timezone.utc)
AS_OF = NOW.date() + timedelta(days=1)  # include every completed fixture
MONTE_CARLO_RUNS = 4000
DRY_RUN = False


def slug(text: str) -> str:
    value = unicodedata.normalize("NFKD", text)
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "unknown"


def pct(value: float, digits: int = 1) -> float:
    return round(float(value) * 100, digits)


def _club_meta_path() -> Path:
    """Curated club metadata is authored data, so it is committed next to the
    pipeline rather than living in the throwaway download cache."""
    tracked = Path(__file__).resolve().parent / "club_meta.json"
    if tracked.exists():
        return tracked
    legacy = CACHE / "club_meta.json"
    if legacy.exists():
        return legacy
    raise FileNotFoundError("club_meta.json not found — expected pipeline/club_meta.json")


class Builder:
    def __init__(self, mode: str = "weekly") -> None:
        self.mode = mode
        self.manifest = read_manifest()
        self.live_season = self.manifest.get("liveSeason") or seasons.current()
        self.season_label = seasons.label(self.live_season)
        self.calendar_year = seasons.fixture_year(self.live_season)
        self.seasons = seasons.history(
            count=max(seasons.HISTORY_SEASONS, len(self.manifest.get("seasons") or []))
        )
        if self.live_season not in self.seasons:
            self.seasons = self.seasons + [self.live_season]
        self.matches = load_matches(LEAGUES, seasons=self.seasons)
        self.club_meta: dict[str, dict] = json.loads(
            _club_meta_path().read_text(encoding="utf-8")
        )
        self.teams: dict[str, dict] = {}
        self.leagues_out: list[dict] = []
        self.fixtures: list[dict] = []
        self.h2h: dict[str, dict] = {}
        self.team_id_by_fd: dict[tuple[str, str], str] = {}
        self.used_ids: set[str] = set()
        self.xg_matches = 0
        self.model_version = self._version()

        print(
            f"Season {self.live_season} ({self.season_label}) · "
            f"{len(self.seasons)} seasons · {len(self.matches):,} matches · mode {mode}"
        )

    def _version(self) -> str:
        """Fingerprint of model config plus the newest result in the data."""
        latest = max((m.played_on for m in self.matches), default=date(2000, 1, 1))
        newest_season = max(self.seasons)
        payload = json.dumps(
            {
                "model": MODEL,
                "seasons": self.seasons,
                "newestSeason": newest_season,
                "latestResult": latest.isoformat(),
                "matches": len(self.matches),
            },
            sort_keys=True,
        )
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:10]

    # -- helpers ------------------------------------------------------------
    def team_identity(self, code: str, fd_name: str) -> dict:
        key = (code, fd_name)
        if key in self.team_id_by_fd:
            return self.teams[self.team_id_by_fd[key]]
        meta = self.club_meta.get(code, {}).get(fd_name, {})
        display = meta.get("name") or fd_name
        base = slug(display)
        team_id = base
        suffix = 2
        while team_id in self.used_ids:
            team_id = f"{base}-{suffix}"
            suffix += 1
        self.used_ids.add(team_id)
        team = {
            "id": team_id,
            "name": display,
            "short": meta.get("short") or display[:3].upper(),
            "color": meta.get("color") or "#4b6b57",
            "league": code,
            "fd": fd_name,
        }
        self.teams[team_id] = team
        self.team_id_by_fd[key] = team_id
        return team

    def fixture_id(self, league: dict, kickoff: datetime, home: dict, away: dict) -> str:
        base = f"{league['short'].lower()}-{kickoff:%Y%m%d}-{home['id']}-{away['id']}"
        candidate = base
        counter = 2
        while candidate in self.used_ids:
            candidate = f"{base}-{counter}"
            counter += 1
        self.used_ids.add(candidate)
        return candidate

    # -- build --------------------------------------------------------------
    def run(self) -> dict:
        for league in LEAGUES:
            self.build_league(league)

        feed = self.build_feed()
        metrics = self.build_metrics()

        # Settle finished forecasts first, then record the new horizon. A dry run
        # must not mutate the ledger.
        if DRY_RUN:
            settle_stats = {"settled": 0, "open": 0}
            record_stats = {"recorded": 0, "considered": len(feed["fixtures"])}
        else:
            settle_stats = ledger.settle(self.matches, as_of=AS_OF)
            team_names = {team_id: team["fd"] for team_id, team in self.teams.items()}
            record_stats = ledger.record(
                feed["fixtures"],
                version=self.model_version,
                team_names=team_names,
                now=NOW,
            )
        live = ledger.summarise(leagues=LEAGUE_BY_CODE)
        metrics["live"] = live
        metrics["ledger"] = {
            "recorded": record_stats["recorded"],
            "considered": record_stats["considered"],
            "settled": settle_stats["settled"],
            "open": settle_stats["open"],
            "modelVersion": self.model_version,
        }

        meta = {
            "generatedAt": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "modelVersion": self.model_version,
            "mode": self.mode,
            "liveSeason": self.live_season,
            "seasonLabel": self.season_label,
            "dataAsOf": self.manifest.get("dataAsOf") or AS_OF.isoformat(),
            "fetchedAt": self.manifest.get("finishedAt"),
            "fetchWarnings": (self.manifest.get("errors") or [])[:20],
            "notes": (self.manifest.get("notes") or [])[:20],
        }

        try:
            result = publish(feed, metrics, meta, data_dir=DATA, dry_run=DRY_RUN)
        except PublishError as error:
            print("PUBLISH BLOCKED")
            for message in error.errors:
                print(f"  x {message}")
            for message in error.warnings:
                print(f"  ! {message}")
            raise

        for message in result.get("warnings", []):
            print(f"  ! {message}")
        print(f"  recorded {record_stats['recorded']} forecasts, settled {settle_stats['settled']}")
        if live.get("settled"):
            print(
                f"  live record: {live['settled']} settled, "
                f"Brier {live['brier']:.3f}, accuracy {live['accuracy']:.1f}%"
            )
        return result

    def build_league(self, league: dict) -> None:
        code = league["code"]
        league_matches = [m for m in self.matches if m.league == code]
        live = [m for m in league_matches if m.season == self.live_season]
        ratings = fit_ratings(
            league_matches,
            AS_OF,
            half_life=MODEL["half_life_days"],
            l2=MODEL["l2"],
            xg_weight=MODEL["xg_weight"],
        )
        if ratings is None:
            print(f"  !! {code}: not enough data")
            return
        self.xg_matches += ratings.xg_matches
        elo = elo_table(league_matches, AS_OF)

        played = [m for m in live if m.played_on < AS_OF]
        fd_names = {m.home for m in played} | {m.away for m in played}
        calendar = load_fixture_calendar(league["slug"], self.calendar_year)
        fx_names = {row["HomeTeam"] for row in calendar} | {row["AwayTeam"] for row in calendar}
        name_map = build_name_map(fd_names, fx_names)

        # ---- current table -------------------------------------------------
        table: dict[str, dict] = {}
        for match in played:
            for side in ("home", "away"):
                name = match.home if side == "home" else match.away
                team = self.team_identity(code, name)
                row = table.setdefault(
                    team["id"],
                    {"team": team["id"], "played": 0, "won": 0, "drawn": 0, "lost": 0,
                     "gf": 0, "ga": 0, "xg": 0.0, "xga": 0.0, "xgGames": 0, "form": []},
                )
                scored = match.home_goals if side == "home" else match.away_goals
                conceded = match.away_goals if side == "home" else match.home_goals
                row["played"] += 1
                row["gf"] += scored
                row["ga"] += conceded
                if scored > conceded:
                    row["won"] += 1
                    result = "W"
                elif scored == conceded:
                    row["drawn"] += 1
                    result = "D"
                else:
                    row["lost"] += 1
                    result = "L"
                row["form"].append(
                    {
                        "result": result,
                        "date": match.played_on.isoformat(),
                        "opponent": (match.away if side == "home" else match.home),
                        "score": f"{scored}-{conceded}",
                        "venue": "H" if side == "home" else "A",
                    }
                )
                if match.xg:
                    row["xg"] += match.xg[0] if side == "home" else match.xg[1]
                    row["xga"] += match.xg[1] if side == "home" else match.xg[0]
                    row["xgGames"] += 1

        for row in table.values():
            row["points"] = row["won"] * 3 + row["drawn"]
            row["gd"] = row["gf"] - row["ga"]
            row["form"] = row["form"][-6:]
            row["ppg"] = round(row["points"] / max(1, row["played"]), 2)
            if row["xgGames"]:
                row["xg"] = round(row["xg"] / row["xgGames"], 2)
                row["xga"] = round(row["xga"] / row["xgGames"], 2)
            else:
                row["xg"] = row["xga"] = None

        ordered = sorted(
            table.values(),
            key=lambda r: (-r["points"], -r["gd"], -r["gf"], r["team"]),
        )
        for position, row in enumerate(ordered, 1):
            row["position"] = position

        # ---- remaining fixtures -------------------------------------------
        upcoming: list[dict] = []
        for row in calendar:
            if row.get("HomeTeamScore") is not None:
                continue
            kickoff = datetime.strptime(row["DateUtc"], "%Y-%m-%d %H:%M:%S%z").astimezone(timezone.utc)
            if kickoff < NOW:
                continue
            home_fd = name_map[row["HomeTeam"]]
            away_fd = name_map[row["AwayTeam"]]
            if home_fd not in ratings.index or away_fd not in ratings.index:
                continue
            home = self.team_identity(code, home_fd)
            away = self.team_identity(code, away_fd)
            lam, mu = ratings.expected_goals(home_fd, away_fd)
            matrix = score_matrix(lam, mu, ratings.rho)
            probs = [float(np.tril(matrix, -1).sum()), float(np.trace(matrix)), float(np.triu(matrix, 1).sum())]
            played_home = int(ratings.played[ratings.index[home_fd]])
            played_away = int(ratings.played[ratings.index[away_fd]])
            evidence = min(1.0, min(played_home, played_away) / 10)
            entropy = -sum(p * math.log(p) for p in probs if p > 0) / math.log(3)
            sharpness = 1 - entropy
            reliability = 0.55 * evidence + 0.45 * sharpness
            top_index = int(matrix.argmax())
            goals_home, goals_away = divmod(top_index, matrix.shape[1])
            upcoming.append(
                {
                    "id": self.fixture_id(league, kickoff, home, away),
                    "league": code,
                    "date": kickoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "home": home["id"],
                    "away": away["id"],
                    "venue": (row.get("Location") or "").strip() or None,
                    "round": int(row["RoundNumber"]) if row.get("RoundNumber") else None,
                    "lh": round(lam, 3),
                    "la": round(mu, 3),
                    "p": [round(p, 4) for p in probs],
                    "cs": f"{goals_home}-{goals_away}",
                    "rel": round(reliability * 100),
                    "ev": round(evidence * 100),
                }
            )

        # ---- head to head (current clubs only) ----------------------------
        pair_history: dict[tuple[str, str], list[Match]] = {}
        for match in sorted(league_matches, key=lambda m: m.played_on):
            home_team = self.team_id_by_fd.get((code, match.home))
            away_team = self.team_id_by_fd.get((code, match.away))
            if not home_team or not away_team:
                continue
            key = tuple(sorted((home_team, away_team)))
            pair_history.setdefault(key, []).append(match)
        for key, rows in pair_history.items():
            recent = rows[-6:]
            hw = sum(1 for m in recent if m.outcome == 0)
            aw = sum(1 for m in recent if m.outcome == 2)
            dr = len(recent) - hw - aw
            self.h2h["-".join(key)] = {
                "n": len(recent),
                "hw": hw,
                "d": dr,
                "aw": aw,
                "gf": sum(m.home_goals for m in recent),
                "ga": sum(m.away_goals for m in recent),
                "last": recent[-1].played_on.isoformat(),
            }

        # ---- ratings + elo into team objects ------------------------------
        for fd_name, index in ratings.index.items():
            team_id = self.team_id_by_fd.get((code, fd_name))
            if not team_id:
                continue  # clubs that left the division
            team = self.teams[team_id]
            team.update(
                {
                    "attack": round(float(ratings.attack[index]), 3),
                    "defence": round(float(ratings.defence[index]), 3),
                    "elo": round(float(elo.get(fd_name, 1500.0))),
                    "played": int(ratings.played[index]),
                    "strength": round(float(ratings.attack[index] - ratings.defence[index]), 3),
                }
            )
            row = table.get(team["id"])
            if row:
                team["form"] = row["form"]
                team["position"] = row["position"]
                team["points"] = row["points"]
                team["stats"] = {
                    key_: row[key_]
                    for key_ in ("played", "won", "drawn", "lost", "gf", "ga", "gd", "points", "xg", "xga", "ppg")
                }
            else:
                team["form"] = []
                team["stats"] = None

        # ---- Monte Carlo season projection --------------------------------
        projection = self.project(table, upcoming, ratings.rho)

        self.leagues_out.append(
            {
                "id": league["id"],
                "code": code,
                "name": league["name"],
                "short": league["short"],
                "country": league["country"],
                "tier": league["tier"],
                "slug": league["slug"],
                "teams": len(table),
                "matchesPlayed": len(played),
                "matchesRemaining": len(upcoming),
                "goalsPerGame": round(
                    sum(m.home_goals + m.away_goals for m in played) / max(1, len(played)), 2
                ),
                "homeWinRate": round(sum(1 for m in played if m.outcome == 0) / max(1, len(played)), 3),
                "drawRate": round(sum(1 for m in played if m.outcome == 1) / max(1, len(played)), 3),
                "rho": round(ratings.rho, 3),
                "homeAdvantage": round(ratings.home_adv, 3),
                "table": ordered,
                "projection": projection,
            }
        )
        self.fixtures.extend(upcoming)
        print(
            f"  {code}: {len(played)} played, {len(upcoming)} upcoming, "
            f"{len(table)} teams, homeAdv {ratings.home_adv:.2f}, rho {ratings.rho:+.2f}"
        )

    def project(self, table: dict[str, dict], upcoming: list[dict], rho: float) -> list[dict]:
        if not upcoming or not table:
            return []
        team_ids = sorted(table)
        index = {team_id: i for i, team_id in enumerate(team_ids)}
        n = len(team_ids)
        fixtures = [f for f in upcoming if f["home"] in index and f["away"] in index]
        if not fixtures:
            return []

        matrices = np.stack(
            [score_matrix(f["lh"], f["la"], rho).ravel() for f in fixtures]
        )
        cdf = np.cumsum(matrices, axis=1)
        cdf /= cdf[:, -1][:, None]

        runs = MONTE_CARLO_RUNS
        rng = np.random.default_rng(20261027)
        points = np.zeros((runs, n))
        goals_for = np.zeros((runs, n))
        goals_against = np.zeros((runs, n))

        base_points = np.array([table[t]["points"] for t in team_ids], dtype=float)
        base_gf = np.array([table[t]["gf"] for t in team_ids], dtype=float)
        base_ga = np.array([table[t]["ga"] for t in team_ids], dtype=float)

        draws = rng.random((runs, len(fixtures)))
        size = 11
        for position, fixture in enumerate(fixtures):
            flat = np.searchsorted(cdf[position], draws[:, position])
            flat = np.minimum(flat, size * size - 1)
            home_goals = flat // size
            away_goals = flat % size
            hi = index[fixture["home"]]
            ai = index[fixture["away"]]
            home_points = np.where(home_goals > away_goals, 3.0, np.where(home_goals == away_goals, 1.0, 0.0))
            away_points = np.where(away_goals > home_goals, 3.0, np.where(home_goals == away_goals, 1.0, 0.0))
            points[:, hi] += home_points
            points[:, ai] += away_points
            goals_for[:, hi] += home_goals
            goals_for[:, ai] += away_goals
            goals_against[:, hi] += away_goals
            goals_against[:, ai] += home_goals

        total_points = points + base_points
        total_gf = goals_for + base_gf
        total_ga = goals_against + base_ga
        goal_diff = total_gf - total_ga

        # rank per simulation (points, then goal difference, then goals for)
        order = np.lexsort((total_gf, goal_diff, total_points), axis=1)[:, ::-1]
        positions = np.empty_like(order)
        np.put_along_axis(
            positions,
            order,
            np.broadcast_to(np.arange(1, n + 1), (runs, n)),
            axis=1,
        )

        output = []
        for team_id in team_ids:
            i = index[team_id]
            pos = positions[:, i]
            output.append(
                {
                    "team": team_id,
                    "title": round(float((pos == 1).mean()) * 100, 1),
                    "top4": round(float((pos <= 4).mean()) * 100, 1),
                    "bottom3": round(float((pos >= n - 2).mean()) * 100, 1),
                    "topHalf": round(float((pos <= n / 2).mean()) * 100, 1),
                    "expPos": round(float(pos.mean()), 1),
                    "expPts": round(float(total_points[:, i].mean()), 1),
                    "posSpread": [round(float(np.percentile(pos, q)), 1) for q in (10, 90)],
                }
            )
        output.sort(key=lambda row: row["expPts"], reverse=True)
        return output

    # -- output -------------------------------------------------------------
    def build_feed(self) -> dict:
        fixtures = sorted(self.fixtures, key=lambda f: f["date"])
        first_year = seasons.parse(self.seasons[0])[0]
        last_year = seasons.parse(self.live_season)[1]
        feed = {
            "generatedAt": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "season": self.season_label,
            "liveSeason": self.live_season,
            "modelVersion": self.model_version,
            "asOf": AS_OF.isoformat(),
            "sources": [
                {"name": "football-data.co.uk", "url": "https://www.football-data.co.uk/",
                 "role": f"Results, half-time scores, closing odds ({first_year}–{last_year})"},
                {"name": "fixturedownload.com", "url": "https://fixturedownload.com/",
                 "role": f"Full-season fixture calendar for {self.season_label}"},
            ],
            "model": {
                "name": (
                    "Time-decayed Dixon-Coles with xG blending"
                    if MODEL["xg_weight"] > 0
                    else "Time-decayed Dixon-Coles"
                ),
                "halfLifeDays": MODEL["half_life_days"],
                "ridge": MODEL["l2"],
                "xgWeight": MODEL["xg_weight"],
                "xgMatches": self.xg_matches,
                "scoreRange": 10,
                "trainedMatches": len(self.matches),
            },
            "leagues": self.leagues_out,
            "teams": self.teams,
            "fixtures": fixtures,
            "h2h": self.h2h,
        }
        print(f"  built {len(fixtures)} fixtures, {len(self.teams)} teams, {len(self.leagues_out)} leagues")
        return feed

    def build_metrics(self) -> dict:
        """Weekly: full walk-forward audit. Daily: reuse it, refresh the live record."""
        existing = self._read_metrics()
        stamp = NOW.strftime("%Y-%m-%dT%H:%M:%SZ")

        if self.mode == "daily" and existing.get("summary"):
            metrics = dict(existing)
            metrics["auditGeneratedAt"] = existing.get("auditGeneratedAt") or existing.get("generatedAt")
            metrics["generatedAt"] = stamp
            metrics["mode"] = "daily"
            metrics["season"] = self.season_label
            metrics["modelVersion"] = self.model_version
            print(f"  audit reused (built {metrics['auditGeneratedAt']})")
            return metrics

        backtest = seasons.backtest_seasons()
        start = seasons.start_date(backtest[0])
        end = NOW.date()
        print(f"  running walk-forward backtest: {', '.join(backtest)} ...")
        result = walk_forward(self.matches, LEAGUES, seasons=backtest, start=start, end=end)

        log = []
        for record in sorted(result["records"], key=lambda r: r["date"])[-600:]:
            log.append(
                {
                    "date": record["date"],
                    "league": record["league"],
                    "home": record["home"],
                    "away": record["away"],
                    "score": record["score"],
                    "p": [round(float(v), 4) for v in record["p"]],
                    "pick": int(np.argmax(record["p"])),
                    "hit": bool(int(np.argmax(record["p"])) == record["outcome"]),
                    "market": [round(float(v), 4) for v in record["market"]] if record["market"] is not None else None,
                }
            )

        metrics = {
            "generatedAt": stamp,
            "auditGeneratedAt": stamp,
            "mode": "weekly",
            "season": self.season_label,
            "modelVersion": self.model_version,
            "range": result["range"],
            "summary": result["summary"],
            "calibration": result["calibration"],
            "marketCalibration": result["marketCalibration"],
            "perLeague": result["perLeague"],
            "trend": result["trend"],
            "log": log,
            "config": {
                "halfLifeDays": MODEL["half_life_days"],
                "ridge": MODEL["l2"],
                "refitDays": 7,
                "scoreRange": 10,
                "xgWeight": MODEL["xg_weight"],
                "backtestSeasons": backtest,
            },
        }
        print(f"  audit: {result['summary']['matches']} matches, Brier {result['summary']['brier']:.3f}")
        return metrics

    def _read_metrics(self) -> dict:
        try:
            return json.loads((DATA / "metrics.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}


def main() -> int:
    global DRY_RUN

    parser = argparse.ArgumentParser(description="Build the Footyline feed.")
    parser.add_argument(
        "--mode",
        choices=("daily", "weekly"),
        default="weekly",
        help="daily refits and re-predicts; weekly also reruns the backtest",
    )
    parser.add_argument("--dry-run", action="store_true", help="validate everything, write nothing")
    args = parser.parse_args()
    DRY_RUN = args.dry_run

    builder = Builder(mode=args.mode)
    try:
        result = builder.run()
    except PublishError as error:
        print(f"FAILED: {len(error.errors)} validation error(s)")
        return 2

    if result.get("dryRun"):
        print("Dry run complete — nothing written")
    else:
        print(
            f"Published feed {result['feedBytes']/1024:.0f} KB "
            f"(sha1 {result['meta']['feedSha1']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
