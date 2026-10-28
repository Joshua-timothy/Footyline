"""Choose the recent-form decay settings by walk-forward validation.

The kernel is a mixture of two exponentials:

    w(age) = a * 0.5^(age / long) + (1 - a) * 0.5^(age / short)

`a = 1` is the single-half-life model, so the baseline is inside the grid.

    python tune_form.py                     # sweep on six leagues
    python tune_form.py --leagues all       # sweep on all eleven
"""

from __future__ import annotations

import argparse
from datetime import date

import numpy as np

import seasons
from config import LEAGUES, MODEL
from model import load_matches, walk_forward

# Phase 1: is recency worth it at all, and at what shape?
GRID: list[tuple[str, dict]] = [
    ("baseline   a=1.00  long=420", {"form_mix": 1.0}),
    ("single     a=1.00  long=300", {"form_mix": 1.0, "half_life_days": 300}),
    ("single     a=1.00  long=210", {"form_mix": 1.0, "half_life_days": 210}),
    ("mix        a=0.85  short=35", {"form_mix": 0.85, "form_half_life_days": 35}),
    ("mix        a=0.75  short=35", {"form_mix": 0.75, "form_half_life_days": 35}),
    ("mix        a=0.65  short=35", {"form_mix": 0.65, "form_half_life_days": 35}),
    ("mix        a=0.75  short=60", {"form_mix": 0.75, "form_half_life_days": 60}),
    ("mix        a=0.75  short=21", {"form_mix": 0.75, "form_half_life_days": 21}),
    ("mix        a=0.55  short=21", {"form_mix": 0.55, "form_half_life_days": 21}),
]

# Phase 2: with weights more concentrated, the ridge may want re-checking.
RIDGE_GRID = [0.035, 0.05, 0.08]

SUBSET = ["E0", "E1", "SP1", "I1", "D1", "F1"]


def metrics(records: list[dict]) -> dict:
    probs = np.array([r["p"] for r in records])
    outcomes = np.array([r["outcome"] for r in records])
    targets = np.zeros_like(probs)
    targets[np.arange(len(outcomes)), outcomes] = 1
    return {
        "n": len(records),
        "brier": float(np.mean(np.sum((probs - targets) ** 2, axis=1)) / 3),
        "logloss": float(-np.mean(np.log(np.clip(probs[np.arange(len(outcomes)), outcomes], 1e-12, 1)))),
        "acc": float(np.mean(probs.argmax(axis=1) == outcomes) * 100),
    }


def run(matches, leagues, overrides: dict) -> dict:
    backtest = seasons.backtest_seasons()
    result = walk_forward(
        matches,
        leagues,
        seasons=backtest,
        start=seasons.start_date(backtest[0]),
        end=date.today(),
        overrides=overrides,
    )
    return metrics(result["records"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--leagues", default="subset", help="'subset', 'all', or codes")
    args = parser.parse_args()

    if args.leagues == "all":
        leagues = LEAGUES
    elif args.leagues == "subset":
        leagues = [l for l in LEAGUES if l["code"] in SUBSET]
    else:
        wanted = {c.strip().upper() for c in args.leagues.split(",")}
        leagues = [l for l in LEAGUES if l["code"] in wanted]

    matches = load_matches(leagues)
    print(f"{len(leagues)} leagues, {len(matches)} matches, xG weight {MODEL['xg_weight']}\n")
    print(f"{'config':<28}{'n':>6}{'Brier':>9}{'Δ':>9}{'log loss':>10}{'acc':>7}")

    baseline = None
    results: list[tuple[str, dict, dict]] = []
    for label, overrides in GRID:
        m = run(matches, leagues, overrides)
        if baseline is None:
            baseline = m["brier"]
        results.append((label, overrides, m))
        print(
            f"{label:<28}{m['n']:>6}{m['brier']:>9.4f}{m['brier'] - baseline:>+9.4f}"
            f"{m['logloss']:>10.4f}{m['acc']:>7.1f}"
        )

    best_label, best_overrides, best = min(results, key=lambda r: r[2]["brier"])
    print(f"\nBest by Brier: {best_label}  ({best['brier']:.4f})")

    print("\nRidge re-check with the winning kernel")
    print(f"{'l2':<8}{'Brier':>9}{'Δ best':>9}{'log loss':>10}{'acc':>7}")
    for l2 in RIDGE_GRID:
        overrides = {**best_overrides, "l2": l2}
        m = run(matches, leagues, overrides)
        print(f"{l2:<8.3f}{m['brier']:>9.4f}{m['brier'] - best['brier']:>+9.4f}{m['logloss']:>10.4f}{m['acc']:>7.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
