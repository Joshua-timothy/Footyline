"""Footyline forecasting engine.

A time-decayed Dixon-Coles bivariate Poisson model with ridge-regularised,
opponent-adjusted attack/defence ratings, plus an Elo rating for comparison,
walk-forward backtesting and Monte-Carlo season projections.

Everything here is deterministic: the same cached data always produces the
same ratings, probabilities and tables.
"""

from __future__ import annotations

import csv
import math
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from config import LEAGUES, MODEL
from seasons import history as history_seasons

CACHE = Path(__file__).resolve().parent / "cache"
MAX_GOALS = 10          # score matrix dimension (0..10)
MATRIX_SIZE = (MAX_GOALS + 1) ** 2


# ---------------------------------------------------------------------------
# data loading
# ---------------------------------------------------------------------------

def _read_csv(path: Path) -> list[dict]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - defensive
        text = raw.decode("latin-1", errors="replace")
    return list(csv.DictReader(text.splitlines()))


def _num(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


@dataclass
class Match:
    league: str
    season: str
    played_on: date
    home: str
    away: str
    home_goals: int
    away_goals: int
    odds: tuple[float, float, float] | None
    over25: tuple[float, float] | None
    xg: tuple[float, float] | None
    kickoff: str = ""

    @property
    def total_goals(self) -> int:
        return self.home_goals + self.away_goals

    @property
    def outcome(self) -> int:
        """0 = home win, 1 = draw, 2 = away win."""
        if self.home_goals > self.away_goals:
            return 0
        if self.home_goals == self.away_goals:
            return 1
        return 2


def _odds_triplet(row: dict) -> tuple[float, float, float] | None:
    """Prefer closing average odds, then closing B365, then opening average."""
    for prefix in ("AvgC", "B365C", "MaxC", "Avg", "B365", "Max"):
        triple = tuple(_num(row.get(prefix + suffix)) for suffix in ("H", "D", "A"))
        if all(value and value > 1.01 for value in triple):
            return triple  # type: ignore[return-value]
    return None


def load_matches(
    leagues: list[dict] | None = None,
    seasons: list[str] | None = None,
) -> list[Match]:
    """Load every cached result for the given leagues and seasons.

    Season ids are derived from the clock by default, so a rollover on 1 July
    needs no code change.
    """
    window = seasons or history_seasons()
    matches: list[Match] = []
    for league in leagues or LEAGUES:
        code = league["code"]
        for season in window:
            path = CACHE / f"results_{season}_{code}.csv"
            if not path.exists():
                continue
            for row in _read_csv(path):
                home_goals = _num(row.get("FTHG"))
                away_goals = _num(row.get("FTAG"))
                if home_goals is None or away_goals is None:
                    continue
                try:
                    played_on = datetime.strptime(row["Date"].strip(), "%d/%m/%Y").date()
                except (KeyError, ValueError):
                    continue
                home = row["HomeTeam"].strip()
                away = row["AwayTeam"].strip()
                if not home or not away:
                    continue
                over = (
                    (_num(row.get("AvgC>2.5")), _num(row.get("AvgC<2.5")))
                    if _num(row.get("AvgC>2.5")) and _num(row.get("AvgC<2.5"))
                    else (_num(row.get("Avg>2.5")), _num(row.get("Avg<2.5")))
                )
                xg_home, xg_away = _num(row.get("HxG")), _num(row.get("AxG"))
                matches.append(
                    Match(
                        league=code,
                        season=season,
                        played_on=played_on,
                        home=home,
                        away=away,
                        home_goals=int(home_goals),
                        away_goals=int(away_goals),
                        odds=_odds_triplet(row),
                        over25=over if all(over) else None,  # type: ignore[arg-type]
                        xg=(xg_home, xg_away) if xg_home and xg_away else None,
                        kickoff=(row.get("Time") or "").strip(),
                    )
                )
    return matches


def load_fixture_calendar(slug: str, year: int | None = None) -> list[dict]:
    """Read the cached fixture calendar for a competition.

    The season-labelled file (``fixtures_epl_2026.json``) is preferred; the
    legacy unlabelled name is still accepted so an old cache keeps working.
    """
    import json

    candidates = []
    if year is not None:
        candidates.append(CACHE / f"fixtures_{slug}_{year}.json")
    candidates.append(CACHE / f"fixtures_{slug}.json")
    for path in candidates:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return []


# ---------------------------------------------------------------------------
# name normalisation (fixturedownload -> football-data)
# ---------------------------------------------------------------------------

STOP_TOKENS = {
    "fc", "cf", "afc", "sc", "ac", "as", "ss", "ssc", "us", "cd", "rc", "ca",
    "ud", "fsv", "vfl", "vfb", "sv", "tsg", "ogc", "losc", "aj", "estac",
    "en", "avant", "stade", "club", "calcio", "de", "del", "do", "da", "the",
    "football", "sport", "sports", "city", "town", "wanderers", "rovers",
    "county", "albion", "athletic", "north", "end", "park", "atletico",
    "olympique", "dynamo", "bk", "if", "ff", "fk",
}

ALIASES: dict[str, str] = {
    # England
    "man utd": "Man United", "spurs": "Tottenham", "qpr": "QPR",
    "west ham united": "West Ham", "wolverhampton wanderers": "Wolves",
    "nott m forest": "Nott'm Forest", "sheffield utd": "Sheffield United",
    # Spain
    "athletic club": "Ath Bilbao", "atletico de madrid": "Ath Madrid",
    "athletic bilbao": "Ath Bilbao", "deportivo alaves": "Alaves",
    "r racing club": "Santander", "racing santander": "Santander",
    "rc deportivo": "La Coruna", "deportivo la coruna": "La Coruna",
    "rcd espanyol de barcelona": "Espanol", "espanyol": "Espanol",
    "rayo vallecano": "Vallecano", "real betis": "Betis",
    "real sociedad": "Sociedad", "ca osasuna": "Osasuna",
    "celta de vigo": "Celta", "real madrid": "Real Madrid",
    "fc barcelona": "Barcelona", "real betis balompie": "Betis",
    # Italy
    "internazionale": "Inter", "ac milan": "Milan", "as roma": "Roma",
    "ss lazio": "Lazio", "juventus": "Juventus", "ssc napoli": "Napoli",
    "us sassuolo calcio": "Sassuolo", "hellas verona": "Verona",
    # Germany
    "1 fc koln": "FC Koln", "fc koln": "FC Koln",
    "1 fc union berlin": "Union Berlin", "union berlin": "Union Berlin",
    "1 fsv mainz 05": "Mainz", "mainz 05": "Mainz",
    "bayer 04 leverkusen": "Leverkusen", "bayer leverkusen": "Leverkusen",
    "borussia dortmund": "Dortmund", "borussia monchengladbach": "M'gladbach",
    "borussia m gladbach": "M'gladbach", "eintracht frankfurt": "Ein Frankfurt",
    "fc bayern munchen": "Bayern Munich", "bayern munchen": "Bayern Munich",
    "fc schalke 04": "Schalke 04", "schalke 04": "Schalke 04",
    "hamburger sv": "Hamburg", "sc paderborn 07": "Paderborn",
    "sv werder bremen": "Werder Bremen", "sport club freiburg": "Freiburg",
    "sc freiburg": "Freiburg", "vfb stuttgart": "Stuttgart",
    "tsg hoffenheim": "Hoffenheim", "rb leipzig": "RB Leipzig",
    "fc augsburg": "Augsburg", "sv elversberg": "Elversberg",
    # France
    "paris saint germain": "Paris SG", "paris sg": "Paris SG",
    "olympique lyonnais": "Lyon", "olympique de marseille": "Marseille",
    "losc lille": "Lille", "stade rennais": "Rennes", "stade brestois 29": "Brest",
    "rc strasbourg alsace": "Strasbourg", "as monaco": "Monaco",
    "le havre": "Le Havre", "havre athletic club": "Le Havre",
    "estac troyes": "Troyes", "paris fc": "Paris FC", "rc lens": "Lens",
    "as saint etienne": "St Etienne", "saint etienne": "St Etienne",
    "fc sochaux montbeliard": "Sochaux", "fc sochaux": "Sochaux",
    "montpellier herault sc": "Montpellier", "stade de reims": "Reims",
    "stade lavallois mfc": "Laval", "us boulogne co": "Boulogne",
    "usl dunkerque": "Dunkerque", "en avant guingamp": "Guingamp",
    "as nancy lorraine": "Nancy", "clermont foot 63": "Clermont",
    "grenoble foot 38": "Grenoble", "rodez aveyron football": "Rodez",
    "fc annecy": "Annecy", "fc metz": "Metz", "fc nantes": "Nantes",
    "red star fc": "Red Star", "pau fc": "Pau FC", "dijon fco": "Dijon",
    "aj auxerre": "Auxerre", "angers sco": "Angers", "fc lorient": "Lorient",
    "ogc nice": "Nice", "le mans fc": "Le Mans", "toulouse fc": "Toulouse",
    # Netherlands
    "ado den haag": "Den Haag", "az": "AZ Alkmaar", "az alkmaar": "AZ Alkmaar",
    "excelsior rotterdam": "Excelsior", "fortuna sittard": "For Sittard",
    "nec nijmegen": "Nijmegen", "n e c nijmegen": "Nijmegen",
    "pec zwolle": "Zwolle", "psv": "PSV Eindhoven", "psv eindhoven": "PSV Eindhoven",
    "sc cambuur": "Cambuur", "sc heerenveen": "Heerenveen",
    "sparta rotterdam": "Sparta Rotterdam", "fc groningen": "Groningen",
    "fc twente": "Twente", "fc utrecht": "Utrecht",
    # Portugal
    "academico": "Academico Viseu", "academico de viseu": "Academico Viseu",
    "cd nacional": "Nacional", "casa pia ac": "Casa Pia",
    "estoril praia": "Estoril", "estrela amadora": "Estrela",
    "fc alverca": "Alverca", "fc arouca": "Arouca", "fc famalicao": "Famalicao",
    "fc porto": "Porto", "gil vicente fc": "Gil Vicente", "maritimo m": "Maritimo",
    "moreirense fc": "Moreirense", "rio ave fc": "Rio Ave", "sc braga": "Sp Braga",
    "sl benfica": "Benfica", "sporting cp": "Sp Lisbon", "vitoria sc": "Guimaraes",
    # Turkey
    "eyupspor": "Eyupspor", "fenerbahce": "Fenerbahce",
    "genclerbirligi": "Genclerbirligi", "goztepe": "Goztep",
    "istanbul basaksehir": "Buyuksehyr", "caykur rizespor": "Rizespor",
    "corum": "Corum", "corum fk": "Corum",
    # Scotland
    "heart of midlothian": "Hearts", "st johnstone": "St Johnstone",
    "st mirren": "St Mirren", "dundee united": "Dundee United",
    # remaining spelling differences
    "queens rangers": "QPR", "west bromwich": "West Brom",
    "wolverhampton": "Wolves", "r racing": "Santander",
    "deportivo": "La Coruna", "rcd espanyol barcelona": "Espanol",
    "braga": "Sp Braga", "vitoria": "Guimaraes",
}

# Names that collapse to nothing (or to an ambiguous key) after normalisation.
RAW_ALIASES: dict[str, str] = {
    "Athletic Club": "Ath Bilbao",
    "Atlético de Madrid": "Ath Madrid",
    "1. FC Köln": "FC Koln",
    "1. FC Union Berlin": "Union Berlin",
    "1. FSV Mainz 05": "Mainz",
    "Hamburger SV": "Hamburg",
    "SC Paderborn 07": "Paderborn",
    "Havre Athletic Club": "Le Havre",
    "Olympique Lyonnais": "Lyon",
    "RC Strasbourg Alsace": "Strasbourg",
    "Stade Brestois 29": "Brest",
    "Stade Rennais FC": "Rennes",
    "AS Nancy Lorraine": "Nancy",
    "FC Sochaux-Montbéliard": "Sochaux",
    "Montpellier Hérault SC": "Montpellier",
    "Rodez Aveyron Football": "Rodez",
    "Stade Lavallois MFC": "Laval",
    "US Boulogne CO": "Boulogne",
    "SC Braga": "Sp Braga",
    "Vitória SC": "Guimaraes",
}


def normalise(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().replace("&", " and ").replace("'", " ")
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    tokens = [token for token in text.split() if token not in STOP_TOKENS]
    # strip leading shirt numbers such as "1 fc koln" -> handled by aliases too
    return " ".join(tokens)


def build_name_map(fd_names: set[str], fx_names: set[str]) -> dict[str, str]:
    """Map a fixture-feed team name onto the canonical football-data name."""
    normalised_fd = {normalise(name): name for name in fd_names}
    mapping: dict[str, str] = {}
    for name in sorted(fx_names):
        if name in fd_names:
            mapping[name] = name
            continue
        if name in RAW_ALIASES and RAW_ALIASES[name] in fd_names:
            mapping[name] = RAW_ALIASES[name]
            continue
        key = normalise(name)
        if key in ALIASES and ALIASES[key] in fd_names:
            mapping[name] = ALIASES[key]
            continue
        if key in normalised_fd:
            mapping[name] = normalised_fd[key]
            continue
        # fall back to token-overlap scoring inside the league
        best, best_score = None, 0.0
        target = set(key.split())
        for candidate_key, candidate in normalised_fd.items():
            other = set(candidate_key.split())
            if not target or not other:
                continue
            overlap = len(target & other) / len(target | other)
            if overlap > best_score:
                best, best_score = candidate, overlap
        if best is None or best_score < 0.34:
            raise ValueError(f"unmapped fixture team: {name!r} (best {best!r} {best_score:.2f})")
        mapping[name] = best
    unresolved = fx_names - set(mapping)
    if unresolved:  # pragma: no cover
        raise ValueError(f"unmapped teams: {sorted(unresolved)}")
    return mapping


# ---------------------------------------------------------------------------
# Dixon-Coles model
# ---------------------------------------------------------------------------

@dataclass
class Ratings:
    teams: list[str]
    attack: np.ndarray
    defence: np.ndarray
    home_adv: float
    rho: float
    played: np.ndarray
    last_played: list[date | None]
    xg_matches: int = 0
    xg_scale: float = 1.0
    index: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.index = {team: i for i, team in enumerate(self.teams)}

    def expected_goals(self, home: str, away: str) -> tuple[float, float]:
        i, j = self.index[home], self.index[away]
        return (
            math.exp(self.attack[i] + self.defence[j] + self.home_adv),
            math.exp(self.attack[j] + self.defence[i]),
        )


def _tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    if x == 0 and y == 0:
        return max(1e-10, 1 - lam * mu * rho)
    if x == 0 and y == 1:
        return max(1e-10, 1 + lam * rho)
    if x == 1 and y == 0:
        return max(1e-10, 1 + mu * rho)
    if x == 1 and y == 1:
        return max(1e-10, 1 - rho)
    return 1.0


def _xg_scale(
    x: np.ndarray,
    y: np.ndarray,
    xg_home: np.ndarray,
    xg_away: np.ndarray,
    weights: np.ndarray,
    has_xg: np.ndarray,
) -> float:
    """Factor that puts expected goals on the goals scale.

    xG is normally calibrated to goals, but a provider can drift by a few
    percent. The ratio is estimated on the available sample with the same time
    weights, shrunk toward 1 and clipped, so a thin or wild sample cannot bend
    the fit.
    """
    count = int(has_xg.sum())
    if count < 50:
        return 1.0
    w = weights[has_xg]
    goals = float(np.dot(w, x[has_xg] + y[has_xg]))
    xg = float(np.dot(w, xg_home[has_xg] + xg_away[has_xg]))
    if xg <= 0 or goals <= 0:
        return 1.0
    ratio = 1.0 + 0.6 * (goals / xg - 1.0)
    return float(np.clip(ratio, 0.92, 1.08))


def fit_ratings(
    matches: list[Match],
    as_of: date,
    *,
    half_life: float = MODEL["half_life_days"],
    l2: float = MODEL["l2"],
    iterations: int = MODEL["iterations"],
    xg_weight: float = 0.0,
    promoted_prior: tuple[float, float] = (
        MODEL["promoted_attack_prior"],
        MODEL["promoted_defence_prior"],
    ),
) -> Ratings | None:
    history = [m for m in matches if m.played_on < as_of]
    if len(history) < 40:
        return None

    teams = sorted({m.home for m in history} | {m.away for m in history})
    index = {team: i for i, team in enumerate(teams)}
    n = len(teams)

    phi = np.array([index[m.home] for m in history])
    psi = np.array([index[m.away] for m in history])
    x = np.array([m.home_goals for m in history], dtype=float)
    y = np.array([m.away_goals for m in history], dtype=float)
    age = np.array([(as_of - m.played_on).days for m in history], dtype=float)
    weights = np.power(0.5, age / half_life)
    weights /= weights.mean()

    # xG-blended observations. Each match contributes exactly one observation,
    # so a season with xG and a season without sit in the same likelihood:
    #   z = (1 - w) * goals + w * scale * xG   where xG exists
    #   z = goals                              where it does not
    # A missing xG feed therefore degrades to the goals-only model instead of
    # needing a separate code path.
    xg_home = np.array([m.xg[0] if m.xg else np.nan for m in history], dtype=float)
    xg_away = np.array([m.xg[1] if m.xg else np.nan for m in history], dtype=float)
    has_xg = np.isfinite(xg_home) & np.isfinite(xg_away)
    xg_matches = int(has_xg.sum())
    xg_scale = _xg_scale(x, y, xg_home, xg_away, weights, has_xg)

    blend = float(np.clip(xg_weight, 0.0, 1.0)) if xg_matches else 0.0
    z_home = x.copy()
    z_away = y.copy()
    if blend > 0.0:
        z_home[has_xg] = (1.0 - blend) * x[has_xg] + blend * xg_scale * xg_home[has_xg]
        z_away[has_xg] = (1.0 - blend) * y[has_xg] + blend * xg_scale * xg_away[has_xg]

    attack = np.zeros(n)
    defence = np.zeros(n)
    home_adv = 0.22

    # promoted / newly promoted teams start below league average
    played_before = np.zeros(n)
    for match in history:
        played_before[index[match.home]] += 1
        played_before[index[match.away]] += 1

    # Adam state
    m_att = np.zeros(n); v_att = np.zeros(n)
    m_def = np.zeros(n); v_def = np.zeros(n)
    m_home = v_home = 0.0
    lr, beta1, beta2, eps = 0.06, 0.9, 0.999, 1e-8

    for step in range(1, iterations + 1):
        lam = np.exp(attack[phi] + defence[psi] + home_adv)
        mu = np.exp(attack[psi] + defence[phi])
        res_home = weights * (z_home - lam)
        res_away = weights * (z_away - mu)

        grad_att = np.zeros(n)
        grad_def = np.zeros(n)
        np.add.at(grad_att, phi, res_home)
        np.add.at(grad_def, psi, res_home)
        np.add.at(grad_att, psi, res_away)
        np.add.at(grad_def, phi, res_away)
        grad_home = float(res_home.sum())

        # ridge penalty pulls ratings to zero (league average)
        grad_att -= 2 * l2 * attack * len(history) / max(1, n)
        grad_def -= 2 * l2 * defence * len(history) / max(1, n)

        m_att = beta1 * m_att + (1 - beta1) * grad_att
        v_att = beta2 * v_att + (1 - beta2) * grad_att**2
        m_def = beta1 * m_def + (1 - beta1) * grad_def
        v_def = beta2 * v_def + (1 - beta2) * grad_def**2
        m_home = beta1 * m_home + (1 - beta1) * grad_home
        v_home = beta2 * v_home + (1 - beta2) * grad_home**2

        att_hat = m_att / (1 - beta1**step)
        def_hat = m_def / (1 - beta1**step)
        home_hat = m_home / (1 - beta1**step)
        att_var = v_att / (1 - beta2**step)
        def_var = v_def / (1 - beta2**step)
        home_var = v_home / (1 - beta2**step)

        attack += lr * att_hat / (np.sqrt(att_var) + eps)
        defence += lr * def_hat / (np.sqrt(def_var) + eps)
        home_adv += lr * home_hat / (math.sqrt(home_var) + eps)

        shift = float(attack.mean())
        attack -= shift
        defence += shift
        home_adv = float(np.clip(home_adv, -0.2, 0.8))

    # shrink thin evidence toward a conservative prior
    strength = played_before
    shrink = 6.0 / (strength + 6.0)
    attack = attack * (1 - shrink) + shrink * promoted_prior[0]
    defence = defence * (1 - shrink) + shrink * promoted_prior[1]

    # Dixon-Coles low-score correlation, clipped to a sane range
    rho = _fit_rho(history, phi, psi, attack, defence, home_adv, weights)

    last_played: list[date | None] = [None] * n
    for match in history:
        for team in (match.home, match.away):
            current = last_played[index[team]]
            if current is None or match.played_on > current:
                last_played[index[team]] = match.played_on

    return Ratings(
        teams=teams,
        attack=attack,
        defence=defence,
        home_adv=float(home_adv),
        rho=float(rho),
        played=played_before.astype(int),
        last_played=last_played,
        xg_matches=xg_matches,
        xg_scale=float(xg_scale),
    )


def _fit_rho(
    history: list[Match],
    phi: np.ndarray,
    psi: np.ndarray,
    attack: np.ndarray,
    defence: np.ndarray,
    home_adv: float,
    weights: np.ndarray,
) -> float:
    lam = np.exp(attack[phi] + defence[psi] + home_adv)
    mu = np.exp(attack[psi] + defence[phi])
    x = np.array([m.home_goals for m in history])
    y = np.array([m.away_goals for m in history])
    low = (x <= 1) & (y <= 1)
    if low.sum() < 30:
        return 0.0
    best_rho, best_ll = 0.0, -np.inf
    for rho in np.arange(-0.22, 0.2201, 0.005):
        tau = np.ones(len(x))
        zero = low & (x == 0) & (y == 0)
        tau[zero] = 1 - lam[zero] * mu[zero] * rho
        zero_one = low & (x == 0) & (y == 1)
        tau[zero_one] = 1 + lam[zero_one] * rho
        one_zero = low & (x == 1) & (y == 0)
        tau[one_zero] = 1 + mu[one_zero] * rho
        one_one = low & (x == 1) & (y == 1)
        tau[one_one] = 1 - rho
        if (tau <= 0).any():
            continue
        ll = float((weights * np.log(tau)).sum())
        if ll > best_ll:
            best_ll, best_rho = ll, float(rho)
    return best_rho


# ---------------------------------------------------------------------------
# score matrix and markets
# ---------------------------------------------------------------------------

def poisson_pmf(lam: np.ndarray | float) -> np.ndarray:
    goals = np.arange(MAX_GOALS + 1, dtype=float)
    lam = np.asarray(lam, dtype=float)
    log_fact = np.array([math.lgamma(k + 1) for k in goals])
    if lam.ndim == 0:
        return np.exp(-lam + goals * math.log(lam) - log_fact)
    return np.exp(-lam[..., None] + goals * np.log(lam)[..., None] - log_fact)


def score_matrix(lam: float, mu: float, rho: float) -> np.ndarray:
    matrix = np.outer(poisson_pmf(lam), poisson_pmf(mu))
    matrix[0, 0] *= max(1e-10, 1 - lam * mu * rho)
    matrix[0, 1] *= max(1e-10, 1 + lam * rho)
    matrix[1, 0] *= max(1e-10, 1 + mu * rho)
    matrix[1, 1] *= max(1e-10, 1 - rho)
    total = matrix.sum()
    return matrix / total if total > 0 else matrix


def _result_probs(matrix: np.ndarray) -> tuple[float, float, float]:
    home = float(np.tril(matrix, -1).sum())
    draw = float(np.trace(matrix))
    away = float(np.triu(matrix, 1).sum())
    return home, draw, away


def market_probabilities(matrix: np.ndarray) -> dict[str, float]:
    """All modelled markets implied by a score matrix."""
    home, draw, away = _result_probs(matrix)
    home_goals = matrix.sum(axis=1)
    away_goals = matrix.sum(axis=0)
    total = home_goals + away_goals
    matrix_h = np.arange(MAX_GOALS + 1)  # goal counts

    def over(line: float) -> float:
        mask = np.add.outer(matrix_h, matrix_h) > line
        return float(matrix[mask].sum())

    btts = float(matrix[1:, 1:].sum())
    out = {
        "home": home, "draw": draw, "away": away,
        "dc_1x": home + draw, "dc_x2": draw + away, "dc_12": home + away,
        "dnb_home": home / (home + away) if home + away else 0.0,
        "dnb_away": away / (home + away) if home + away else 0.0,
        "btts": btts, "btts_no": 1 - btts,
        "o15": over(1.5), "o25": over(2.5), "o35": over(3.5), "o45": over(4.5),
        "u15": 1 - over(1.5), "u25": 1 - over(2.5), "u35": 1 - over(3.5), "u45": 1 - over(4.5),
        "home_cs": float(matrix[0, :].sum()),
        "away_cs": float(matrix[:, 0].sum()),
        "home_win_to_nil": float(np.sum([matrix[i, 0] for i in range(1, MAX_GOALS + 1)])),
        "away_win_to_nil": float(np.sum([matrix[0, j] for j in range(1, MAX_GOALS + 1)])),
        "home_o05": float(home_goals[1:].sum()), "home_u05": float(home_goals[0]),
        "home_o15": float(home_goals[2:].sum()), "home_u15": float(home_goals[:2].sum()),
        "away_o05": float(away_goals[1:].sum()), "away_u05": float(away_goals[0]),
        "away_o15": float(away_goals[2:].sum()), "away_u15": float(away_goals[:2].sum()),
        "edges": float((np.abs(home_goals - away_goals) <= 1).sum() * 0 + matrix[np.abs(np.subtract.outer(matrix_h, matrix_h)) <= 1].sum()),
        "exact_total": 0.0,
    }
    # asian handicap with push handling
    for line in (-1.5, -1.0, -0.5, 0.5, 1.0, 1.5, 2.0):
        diff = np.subtract.outer(matrix_h, matrix_h) + line
        win = float(matrix[diff > 0].sum())
        push = float(matrix[diff == 0].sum())
        effective = win / (1 - push) if push < 0.999 else 0.0
        out[f"ah{line:+.1f}"] = effective
    # most likely scorelines
    top: list[tuple[str, float]] = []
    flat = np.argsort(matrix, axis=None)[::-1][:12]
    for flat_index in flat:
        i, j = divmod(int(flat_index), MAX_GOALS + 1)
        top.append((f"{i}-{j}", float(matrix[i, j])))
    out["_scores"] = top  # type: ignore[assignment]
    out["total_mean"] = float((total * np.arange(2 * MAX_GOALS + 1)[: MAX_GOALS + 1]).sum() + 0)
    out["total_mean"] = float(np.sum([matrix[i, j] * (i + j) for i in range(MAX_GOALS + 1) for j in range(MAX_GOALS + 1)]))
    return out


def market_value(result: dict, key: str) -> float:
    return float(result.get(key, 0.0))


# ---------------------------------------------------------------------------
# Elo
# ---------------------------------------------------------------------------

def elo_table(matches: list[Match], as_of: date, k: float = 18.0, home_bonus: float = 62.0) -> dict[str, float]:
    ratings: dict[str, float] = {}
    expected_goals_scale = 1.0
    for match in sorted((m for m in matches if m.played_on < as_of), key=lambda m: m.played_on):
        home = ratings.setdefault(match.home, 1500.0)
        away = ratings.setdefault(match.away, 1500.0)
        expected = 1 / (1 + 10 ** ((away - (home + home_bonus)) / 400))
        actual = 1.0 if match.outcome == 0 else 0.5 if match.outcome == 1 else 0.0
        margin = abs(match.home_goals - match.away_goals)
        multiplier = 1 + math.log1p(margin) * 0.35
        delta = k * multiplier * (actual - expected) * expected_goals_scale
        ratings[match.home] = home + delta
        ratings[match.away] = away - delta
    return ratings


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------

def outcome_vector(outcome: int) -> np.ndarray:
    vector = np.zeros(3)
    vector[outcome] = 1.0
    return vector


def brier(probabilities: np.ndarray, outcomes: np.ndarray) -> float:
    """Mean squared error across all outcome cells.

    Multiclass Brier divided by three, the convention used in football
    forecasting literature: a naive 1/3-1/3-1/3 forecast scores 0.222 and the
    closing market lands near 0.190. Lower is better.
    """
    targets = np.zeros((len(outcomes), 3))
    targets[np.arange(len(outcomes)), outcomes] = 1
    return float(np.mean(np.sum((probabilities - targets) ** 2, axis=1)) / 3)


def log_loss(probabilities: np.ndarray, outcomes: np.ndarray) -> float:
    clipped = np.clip(probabilities[np.arange(len(outcomes)), outcomes], 1e-12, 1)
    return float(-np.mean(np.log(clipped)))


def accuracy(probabilities: np.ndarray, outcomes: np.ndarray) -> float:
    return float(np.mean(probabilities.argmax(axis=1) == outcomes))


def devig(odds: tuple[float, float, float]) -> np.ndarray:
    implied = 1.0 / np.array(odds, dtype=float)
    return implied / implied.sum()


def calibration_bins(probabilities: np.ndarray, outcomes: np.ndarray, bins: int = 10) -> list[dict]:
    targets = np.zeros((len(outcomes), 3))
    targets[np.arange(len(outcomes)), outcomes] = 1
    flat_p = probabilities.reshape(-1)
    flat_y = targets.reshape(-1)
    edges = np.linspace(0, 1, bins + 1)
    output = []
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (flat_p >= low) & (flat_p < high)
        count = int(mask.sum())
        output.append(
            {
                "low": round(float(low), 3),
                "high": round(float(high), 3),
                "count": count,
                "predicted": round(float(flat_p[mask].mean()), 4) if count else None,
                "observed": round(float(flat_y[mask].mean()), 4) if count else None,
            }
        )
    return output


def expected_calibration_error(bins: list[dict]) -> float:
    total = sum(bin_["count"] for bin_ in bins)
    if not total:
        return 0.0
    return float(
        sum(
            bin_["count"] * abs((bin_["predicted"] or 0) - (bin_["observed"] or 0))
            for bin_ in bins
        )
        / total
    )


# ---------------------------------------------------------------------------
# walk-forward backtest
# ---------------------------------------------------------------------------

def walk_forward(
    matches: list[Match],
    leagues: list[dict],
    *,
    seasons: list[str],
    start: date,
    end: date,
    refit_days: int = 7,
    xg_weight: float | None = None,
) -> dict:
    """Fit on everything before each refit date, predict the following week."""
    from config import MODEL as CFG

    blend = CFG["xg_weight"] if xg_weight is None else float(xg_weight)

    records: list[dict] = []
    per_league: dict[str, dict] = {}
    for league in leagues:
        code = league["code"]
        league_matches = [m for m in matches if m.league == code]
        window = [m for m in league_matches if m.season in seasons and start <= m.played_on <= end]
        if not window:
            continue
        ratings_cache: dict[date, Ratings | None] = {}
        cursor = start
        while cursor <= end:
            ratings_cache[cursor] = fit_ratings(
                league_matches,
                cursor,
                half_life=CFG["half_life_days"],
                l2=CFG["l2"],
                xg_weight=blend,
            )
            cursor += timedelta(days=refit_days)
        refit_dates = sorted(ratings_cache)
        for match in sorted(window, key=lambda m: m.played_on):
            eligible = [d for d in refit_dates if d <= match.played_on]
            if not eligible:
                continue
            ratings = ratings_cache[eligible[-1]]
            if ratings is None or match.home not in ratings.index or match.away not in ratings.index:
                continue
            if ratings.played[ratings.index[match.home]] < 3 or ratings.played[ratings.index[match.away]] < 3:
                continue
            lam, mu = ratings.expected_goals(match.home, match.away)
            probs = np.array(_result_probs(score_matrix(lam, mu, ratings.rho)))
            records.append(
                {
                    "league": code,
                    "date": match.played_on.isoformat(),
                    "home": match.home,
                    "away": match.away,
                    "score": f"{match.home_goals}-{match.away_goals}",
                    "outcome": match.outcome,
                    "p": probs,
                    "market": devig(match.odds) if match.odds else None,
                    "lam": lam,
                    "mu": mu,
                }
            )
        print(f"  walk-forward {code}: {sum(1 for r in records if r['league'] == code)} predictions")

    if not records:
        return {"records": [], "summary": {}}

    probs = np.array([r["p"] for r in records])
    outcomes = np.array([r["outcome"] for r in records])
    market_rows = [r for r in records if r["market"] is not None]
    market_probs = np.array([r["market"] for r in market_rows])
    market_outcomes = np.array([r["outcome"] for r in market_rows])

    bins = calibration_bins(probs, outcomes)
    market_bins = calibration_bins(market_probs, market_outcomes) if len(market_rows) else []

    per_league_metrics: dict[str, dict] = {}
    for league in leagues:
        code = league["code"]
        rows = [r for r in records if r["league"] == code]
        if not rows:
            continue
        lp = np.array([r["p"] for r in rows])
        lo = np.array([r["outcome"] for r in rows])
        mrows = [r for r in rows if r["market"] is not None]
        per_league_metrics[code] = {
            "matches": len(rows),
            "brier": round(brier(lp, lo), 4),
            "logLoss": round(log_loss(lp, lo), 4),
            "accuracy": round(accuracy(lp, lo) * 100, 1),
            "marketBrier": round(brier(np.array([r["market"] for r in mrows]), np.array([r["outcome"] for r in mrows])), 4) if mrows else None,
            "marketMatches": len(mrows),
        }

    # weekly Brier trend (for the model page chart)
    by_week: dict[str, list[dict]] = {}
    for record in records:
        iso = date.fromisoformat(record["date"]).isocalendar()
        key = f"{iso.year}-W{iso.week:02d}"
        by_week.setdefault(key, []).append(record)
    trend = []
    for key in sorted(by_week):
        rows = by_week[key]
        lp = np.array([r["p"] for r in rows])
        lo = np.array([r["outcome"] for r in rows])
        mrows = [r for r in rows if r["market"] is not None]
        trend.append(
            {
                "week": key,
                "matches": len(rows),
                "brier": round(brier(lp, lo), 4),
                "marketBrier": round(brier(np.array([r["market"] for r in mrows]), np.array([r["outcome"] for r in mrows])), 4) if mrows else None,
            }
        )

    summary = {
        "matches": len(records),
        "brier": round(brier(probs, outcomes), 4),
        "logLoss": round(log_loss(probs, outcomes), 4),
        "accuracy": round(accuracy(probs, outcomes) * 100, 1),
        "ece": round(expected_calibration_error(bins), 4),
        "marketMatches": len(market_rows),
        "marketBrier": round(brier(market_probs, market_outcomes), 4) if len(market_rows) else None,
        "marketLogLoss": round(log_loss(market_probs, market_outcomes), 4) if len(market_rows) else None,
        "marketAccuracy": round(accuracy(market_probs, market_outcomes) * 100, 1) if len(market_rows) else None,
        "marketEce": round(expected_calibration_error(market_bins), 4) if market_bins else None,
    }
    return {
        "records": records,
        "summary": summary,
        "calibration": bins,
        "marketCalibration": market_bins,
        "perLeague": per_league_metrics,
        "trend": trend,
        "range": {"start": start.isoformat(), "end": end.isoformat()},
    }
