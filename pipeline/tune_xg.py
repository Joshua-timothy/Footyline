"""Choose the xG blend weight by walk-forward validation.

xG exists only in the live season (football-data.co.uk starts publishing HxG/AxG
in 2026-27), so the sweep runs on that season alone. Earlier seasons are
provably unaffected: a fit made before any xG exists sees `z = goals`.

    python tune_xg.py            # sweep the weight on the live season
    python tune_xg.py --full     # also compare the full backtest, w=0 vs best
"""

from __future__ import annotations

import argparse
import math
from datetime import date

import numpy as np

import seasons
from config import LEAGUES
from model import load_matches, walk_forward

WEIGHTS = [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0]


def metrics(records: list[dict]) -> dict:
    if not records:
        return {"n": 0, "brier": float("nan"), "logloss": float("nan"), "acc": float("nan")}
    probs = np.array([r["p"] for r in records])
    outcomes = np.array([r["outcome"] for r in records])
    targets = np.zeros_like(probs)
    targets[np.arange(len(outcomes)), outcomes] = 1
    brier = float(np.mean(np.sum((probs - targets) ** 2, axis=1)) / 3)
    logloss = float(-np.mean(np.log(np.clip(probs[np.arange(len(outcomes)), outcomes], 1e-12, 1))))
    acc = float(np.mean(probs.argmax(axis=1) == outcomes) * 100)
    return {"n": len(records), "brier": brier, "logloss": logloss, "acc": acc}


def per_match_brier(records: list[dict]) -> dict[tuple, float]:
    return {
        (r["date"], r["league"], r["home"], r["away"]): float(
            sum((r["p"][i] - (1.0 if i == r["outcome"] else 0.0)) ** 2 for i in range(3)) / 3
        )
        for r in records
    }


def market_metrics(records: list[dict]) -> dict:
    rows = [r for r in records if r.get("market") is not None]
    if not rows:
        return {"n": 0, "brier": float("nan"), "logloss": float("nan"), "acc": float("nan")}
    probs = np.array([r["market"] for r in rows])
    outcomes = np.array([r["outcome"] for r in rows])
    targets = np.zeros_like(probs)
    targets[np.arange(len(outcomes)), outcomes] = 1
    return {
        "n": len(rows),
        "brier": float(np.mean(np.sum((probs - targets) ** 2, axis=1)) / 3),
        "logloss": float(-np.mean(np.log(np.clip(probs[np.arange(len(outcomes)), outcomes], 1e-12, 1)))),
        "acc": float(np.mean(probs.argmax(axis=1) == outcomes) * 100),
    }


def paired_delta(base: dict[tuple, float], other: dict[tuple, float]) -> tuple[float, float]:
    keys = sorted(set(base) & set(other))
    if not keys:
        return float("nan"), float("nan")
    diffs = np.array([other[k] - base[k] for k in keys])
    se = float(diffs.std(ddof=1) / math.sqrt(len(diffs))) if len(diffs) > 1 else float("nan")
    return float(diffs.mean()), se


def sweep(matches, live: str) -> tuple[float, dict[float, list[dict]]]:
    start = seasons.start_date(live)
    end = date.today()
    results: dict[float, list[dict]] = {}
    baseline: dict[tuple, float] | None = None

    print(f"Walk-forward on {seasons.label(live)}: {start} to {end}")
    print(f"{'w':>4} {'n':>5} {'Brier':>8} {'Δ vs 0':>9} {'±SE':>7} {'log loss':>9} {'acc':>6}")
    best_w, best_brier = 0.0, float("inf")
    for weight in WEIGHTS:
        result = walk_forward(matches, LEAGUES, seasons=[live], start=start, end=end, xg_weight=weight)
        records = result["records"]
        results[weight] = records
        m = metrics(records)
        pair = per_match_brier(records)
        if baseline is None:
            baseline = pair
            delta, se = 0.0, 0.0
        else:
            delta, se = paired_delta(baseline, pair)
        if m["brier"] < best_brier:
            best_brier, best_w = m["brier"], weight
        print(
            f"{weight:4.2f} {m['n']:5d} {m['brier']:8.4f} {delta:+9.4f} {se:7.4f} "
            f"{m['logloss']:9.4f} {m['acc']:6.1f}"
        )
    return best_w, results


def full_backtest(matches, weight: float) -> dict:
    backtest = seasons.backtest_seasons()
    return walk_forward(
        matches,
        LEAGUES,
        seasons=backtest,
        start=seasons.start_date(backtest[0]),
        end=date.today(),
        xg_weight=weight,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="also compare the full backtest")
    parser.add_argument("--weight", type=float, help="skip the sweep and test one weight")
    args = parser.parse_args()

    live = seasons.current()
    matches = load_matches(LEAGUES)

    if args.weight is not None:
        best_w = args.weight
    else:
        best_w, results = sweep(matches, live)
        print(f"\nBest weight by Brier: {best_w:.2f}")
        live_records = results[best_w]
        print(f"  market on the same slice: {market_metrics(live_records)}")
        print(f"  baseline w=0:            {metrics(results[0.0])}")

    if args.full:
        print("\nFull backtest (both seasons)")
        base = full_backtest(matches, 0.0)
        tuned = full_backtest(matches, best_w)
        for name, result in (("w=0.00", base), (f"w={best_w:.2f}", tuned)):
            s = result["summary"]
            print(
                f"  {name}: n={s['matches']:5d} Brier {s['brier']:.4f} "
                f"logloss {s['logLoss']:.4f} acc {s['accuracy']:.1f}% "
                f"| market Brier {s['marketBrier']:.4f}"
            )
        # the previous season has no xG, so its predictions must be identical
        base_pairs = per_match_brier(base["records"])
        tuned_pairs = per_match_brier(tuned["records"])
        earlier = [k for k in base_pairs if k[1] and k[0] < f"{seasons.parse(live)[0]}-07-01"]
        same = all(abs(base_pairs[k] - tuned_pairs[k]) < 1e-12 for k in earlier if k in tuned_pairs)
        changed = [k for k in earlier if k in tuned_pairs and abs(base_pairs[k] - tuned_pairs[k]) > 1e-12]
        print(f"  pre-xG seasons unchanged: {same} ({len(changed)} differences)")

        live_start = f"{seasons.parse(live)[0]}-07-01"
        live_keys = [k for k in base_pairs if k[0] >= live_start]
        delta, se = paired_delta(
            {k: base_pairs[k] for k in live_keys},
            {k: tuned_pairs[k] for k in live_keys if k in tuned_pairs},
        )
        print(f"  live-season paired Δ vs baseline: {delta:+.4f} Brier (±{se:.4f} SE, n={len(live_keys)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
