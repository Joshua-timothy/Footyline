"""Season arithmetic for the Footyline pipeline.

No part of the pipeline should ever hardcode a season id again. A season is
identified the way football-data.co.uk identifies it: the last two digits of the
starting year followed by the last two of the ending year, e.g. ``"2627"`` is
2026-27. Everything else — file names, history windows, backtest ranges, the
fixturedownload.com calendar year — is derived from that.

The boundary is July: a new season's results file appears in July and the old
season's final matchday is in May or June, so from 1 July onwards we are in the
new season.
"""

from __future__ import annotations

from datetime import date, timedelta

SEASON_START_MONTH = 7

# How much history the model trains on. Five full seasons plus the live one.
HISTORY_SEASONS = 6
# How many seasons the walk-forward backtest covers: the previous one plus the
# live one. Older seasons are already represented in the ratings.
BACKTEST_SEASONS = 2


def start_year(today: date | None = None) -> int:
    """The calendar year in which the current season started."""
    today = today or date.today()
    return today.year if today.month >= SEASON_START_MONTH else today.year - 1


def from_start_year(year: int) -> str:
    """``2026 -> "2627"``."""
    return f"{year % 100:02d}{(year + 1) % 100:02d}"


def current(today: date | None = None) -> str:
    """The season id that contains ``today``."""
    return from_start_year(start_year(today))


def parse(code: str) -> tuple[int, int]:
    """``"2627" -> (2026, 2027)``.

    Accepts both the compact football-data form and explicit years so that a
    hand-written override can never crash the pipeline.
    """
    cleaned = str(code).strip()
    if len(cleaned) == 4 and cleaned.isdigit():
        start = int(cleaned[:2])
        end = int(cleaned[2:])
        start += 1900 if start >= 90 else 2000
        end += 1900 if end >= 90 else 2000
    elif len(cleaned) == 9 and cleaned[4] == "-":
        start, end = int(cleaned[:4]), int(cleaned[5:])
    else:
        raise ValueError(f"unrecognised season id: {code!r}")
    if end != start + 1:
        raise ValueError(f"season id {code!r} does not span two consecutive years")
    return start, end


def start_date(code: str) -> date:
    start, _ = parse(code)
    return date(start, SEASON_START_MONTH, 1)


def end_date(code: str) -> date:
    _, end = parse(code)
    return date(end, 6, 30)


def label(code: str) -> str:
    """``"2627" -> "2026-27"``."""
    start, end = parse(code)
    return f"{start}-{str(end)[-2:]}"


def previous(code: str, steps: int = 1) -> str:
    start, _ = parse(code)
    return from_start_year(start - steps)


def sequence(count: int, ending: str | None = None) -> list[str]:
    """The last ``count`` seasons, oldest first, ending at ``ending``."""
    if count < 1:
        return []
    last = ending or current()
    return [previous(last, offset) for offset in range(count - 1, -1, -1)]


def history(count: int = HISTORY_SEASONS, today: date | None = None) -> list[str]:
    """Training window, oldest first, always ending on the live season."""
    return sequence(count, current(today))


def backtest_seasons(today: date | None = None) -> list[str]:
    """Seasons covered by the walk-forward audit."""
    live = current(today)
    return [previous(live, offset) for offset in range(BACKTEST_SEASONS - 1, -1, -1)]


def fixture_year(code: str) -> int:
    """The year fixturedownload.com labels its calendar with.

    Verified against the live site: a calendar labelled ``2026`` contains
    2026-08-21 through 2027-05-30, so the year is the season's *start* year.
    """
    start, _ = parse(code)
    return start


def season_of(day: date) -> str:
    """Which season a given match date belongs to."""
    return current(day)


def window(code: str) -> tuple[date, date]:
    """Inclusive date range that a season spans."""
    return start_date(code), end_date(code)


def contains(code: str, day: date) -> bool:
    start, end = window(code)
    return start <= day <= end


def describe(today: date | None = None) -> dict:
    """Small dict used for logging and the published meta file."""
    live = current(today)
    return {
        "live": live,
        "label": label(live),
        "start": start_date(live).isoformat(),
        "end": end_date(live).isoformat(),
        "history": history(today=today),
        "backtest": backtest_seasons(today),
        "fixtureYear": fixture_year(live),
    }


def days_into_season(today: date | None = None) -> int:
    today = today or date.today()
    return max(0, (today - start_date(current(today))).days)


if __name__ == "__main__":  # small self-check, useful in CI
    today = date.today()
    live = current(today)
    print(f"today        {today.isoformat()}")
    print(f"live season  {live} ({label(live)})")
    print(f"history      {', '.join(history(today=today))}")
    print(f"backtest     {', '.join(backtest_seasons(today))}")
    print(f"calendar      epl-{fixture_year(live)}")

    # The 1 July boundary must flip the season, and 30 June must not.
    assert current(date(today.year, 6, 30)) == previous(current(date(today.year, 7, 1)))
    assert parse("2627") == (2026, 2027)
    assert label("2627") == "2026-27"
    assert previous("2627") == "2526"
    assert fixture_year("2627") == 2026
    assert sequence(3, "2627") == ["2425", "2526", "2627"]
    print("season self-check ok")
