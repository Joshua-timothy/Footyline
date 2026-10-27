"""Grid-search the model's time-decay and ridge settings on a held-out season."""

from __future__ import annotations

from datetime import date

import numpy as np

from config import LEAGUES
from model import (
    accuracy, brier, calibration_bins, devig, expected_calibration_error,
    fit_ratings, load_matches, log_loss, score_matrix, _result_probs,
)

SEASON_START = date(2025, 8, 1)
SEASON_END = date(2026, 5, 31)
SAMPLE = ["E0", "SP1", "I1", "D1", "F1"]


def evaluate(matches, leagues, half_life, l2, refit_days=7):
    probs, outcomes, markets, market_outcomes = [], [], [], []
    from datetime import timedelta

    for league in leagues:
        code = league["code"]
        rows = [m for m in matches if m.league == code]
        window = [m for m in rows if SEASON_START <= m.played_on <= SEASON_END]
        cache = {}
        cursor = SEASON_START
        while cursor <= SEASON_END:
            cache[cursor] = fit_ratings(rows, cursor, half_life=half_life, l2=l2)
            cursor += timedelta(days=refit_days)
        keys = sorted(cache)
        for match in window:
            eligible = [k for k in keys if k <= match.played_on]
            if not eligible:
                continue
            ratings = cache[eligible[-1]]
            if ratings is None or match.home not in ratings.index or match.away not in ratings.index:
                continue
            if min(ratings.played[ratings.index[match.home]], ratings.played[ratings.index[match.away]]) < 3:
                continue
            lam, mu = ratings.expected_goals(match.home, match.away)
            probs.append(_result_probs(score_matrix(lam, mu, ratings.rho)))
            outcomes.append(match.outcome)
            if match.odds:
                markets.append(devig(match.odds))
                market_outcomes.append(match.outcome)
    p = np.array(probs); o = np.array(outcomes)
    m = np.array(markets); mo = np.array(market_outcomes)
    bins = calibration_bins(p, o)
    return dict(
        n=len(o),
        brier=brier(p, o),
        logloss=log_loss(p, o),
        acc=accuracy(p, o),
        ece=expected_calibration_error(bins),
        marketBrier=brier(m, mo),
        marketLogloss=log_loss(m, mo),
    )


if __name__ == "__main__":
    leagues = [league for league in LEAGUES if league["code"] in SAMPLE]
    matches = load_matches(leagues)
    print(f"{len(matches)} matches, {len(SAMPLE)} leagues")
    results = []
    for half_life in (150, 210, 300, 420, 600, 900):
        for l2 in (0.01, 0.035, 0.08):
            metrics = evaluate(matches, leagues, half_life, l2)
            results.append((metrics["brier"], half_life, l2, metrics))
            print(
                f"hl={half_life:4d} l2={l2:5.3f}  brier={metrics['brier']:.4f} "
                f"logloss={metrics['logloss']:.4f} acc={metrics['acc']*100:.1f} "
                f"ece={metrics['ece']:.3f}  market={metrics['marketBrier']:.4f} "
                f"({metrics['n']} matches)"
            )
    results.sort()
    print("\nBest:", results[0][1], results[0][2], results[0][3])
