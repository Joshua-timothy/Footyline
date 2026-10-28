"""Show what xG blending does to ratings around unusual scorelines.

Prints, per league: xG coverage and calibration scale, the matches where goals
and xG disagreed most, and how the affected teams' attack ratings move between
the goals-only fit and the blended fit.
"""

from __future__ import annotations

from datetime import date

import numpy as np

import seasons
from config import LEAGUES, MODEL
from model import fit_ratings, load_matches


def main() -> int:
    matches = load_matches(LEAGUES)
    as_of = date.today()
    weight = MODEL["xg_weight"]
    print(f"as of {as_of}  blend weight {weight}\n")

    for league in LEAGUES:
        code = league["code"]
        league_matches = [m for m in matches if m.league == code]
        base = fit_ratings(league_matches, as_of, xg_weight=0.0)
        blend = fit_ratings(league_matches, as_of, xg_weight=weight)
        if base is None or blend is None:
            continue

        printed = 0
        print(f"== {code} ({league['name']})")
        print(f"   xG matches {blend.xg_matches:3d}   scale {blend.xg_scale:.3f}")
        rows = [
            m for m in league_matches
            if m.xg and m.played_on >= seasons.start_date(seasons.current())
        ]
        rows.sort(key=lambda m: abs(m.home_goals - m.xg[0]) + abs(m.away_goals - m.xg[1]), reverse=True)
        for match in rows[:3]:
            for team, goals, xg, opponent, opp_goals, opp_xg, side in (
                (match.home, match.home_goals, match.xg[0], match.away, match.away_goals, match.xg[1], "H"),
                (match.away, match.away_goals, match.xg[1], match.home, match.home_goals, match.xg[0], "A"),
            ):
                if abs(goals - xg) < 1.0:
                    continue
                i = base.index.get(team)
                if i is None:
                    continue
                d_att = float(blend.attack[i] - base.attack[i])
                d_def = float(blend.defence[i] - base.defence[i])
                print(
                    f"   {match.played_on} {team} {goals}-{opp_goals} {opponent}"
                    f" ({side}) scored {goals} from {xg:.2f} xG"
                    f" -> attack {base.attack[i]:+.2f} to {blend.attack[i]:+.2f} ({d_att:+.3f}),"
                    f" defence {d_def:+.3f}"
                )
                printed += 1
        if not printed:
            print("   (no large divergences yet)")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
