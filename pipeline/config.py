"""League configuration for the Footyline data pipeline."""

from __future__ import annotations

# football-data.co.uk division codes -> Footyline league metadata.
# slug is the fixturedownload.com competition slug used for the fixture calendar.
LEAGUES = [
    dict(code="E0",  id="premier-league",      name="Premier League",      short="PL",  country="England",     tier=1, flag="gb-eng", slug="epl"),
    dict(code="E1",  id="championship",        name="Championship",        short="CHA", country="England",     tier=2, flag="gb-eng", slug="championship"),
    dict(code="SP1", id="la-liga",             name="La Liga",             short="LAL", country="Spain",       tier=1, flag="es",     slug="la-liga"),
    dict(code="I1",  id="serie-a",             name="Serie A",             short="SA",  country="Italy",       tier=1, flag="it",     slug="serie-a"),
    dict(code="D1",  id="bundesliga",          name="Bundesliga",          short="BUN", country="Germany",     tier=1, flag="de",     slug="bundesliga"),
    dict(code="F1",  id="ligue-1",             name="Ligue 1",             short="L1",  country="France",      tier=1, flag="fr",     slug="ligue-1"),
    dict(code="F2",  id="ligue-2",             name="Ligue 2",             short="L2",  country="France",      tier=2, flag="fr",     slug="ligue-2"),
    dict(code="N1",  id="eredivisie",          name="Eredivisie",          short="ERE", country="Netherlands", tier=1, flag="nl",     slug="eredivisie"),
    dict(code="P1",  id="primeira-liga",       name="Primeira Liga",       short="PRI", country="Portugal",    tier=1, flag="pt",     slug="primeira-liga"),
    dict(code="T1",  id="super-lig",           name="Süper Lig",           short="SÜL", country="Turkey",      tier=1, flag="tr",     slug="super-lig"),
    dict(code="SC0", id="scottish-premiership",name="Scottish Premiership", short="SPL", country="Scotland",    tier=1, flag="gb-sct", slug="scottish-premiership"),
]

LEAGUE_BY_CODE = {league["code"]: league for league in LEAGUES}
LEAGUE_BY_ID = {league["id"]: league for league in LEAGUES}

# Seasons are never hardcoded. See seasons.py: the live season, the training
# window and the backtest range are all derived from today's date, so the
# pipeline rolls over on 1 July without an edit.

# Model configuration. Half-life and ridge were chosen by a walk-forward grid
# search over the 2025-26 season across the top five leagues (see tune.py).
# xg_weight blends expected goals into the goal observations:
#   z = (1 - w) * goals + w * scale * xG
# chosen by a walk-forward sweep on the live season (see tune_xg.py).
MODEL = dict(
    half_life_days=420,      # time-decay half life for historical match weights
    l2=0.05,                 # ridge penalty on attack/defence ratings
    xg_weight=0.40,          # blend of xG into the goal observation (0 = goals only)
    iterations=420,
    learning_rate=0.9,
    momentum=0.9,
    min_matches_for_rating=3,
    promoted_attack_prior=-0.22,
    promoted_defence_prior=0.18,
    market_blend=0.0,        # no odds used in the forecast itself
)
