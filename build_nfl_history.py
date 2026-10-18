
"""
DOC'S NFL WAR ROOM
Historical Dataset Collector v1

Downloads 2020-2025 NFL schedules and
play-by-play EPA data from nflverse.

No probabilities are generated here.
"""

from pathlib import Path
import json
from datetime import datetime, timezone

import nflreadpy as nfl
import polars as pl

YEARS = list(range(2020, 2026))
OUT = Path("historical")
OUT.mkdir(exist_ok=True)

def require_columns(df, columns, name):
    missing = set(columns) - set(df.columns)
    if missing:
        raise ValueError(
            f"{name} missing columns: {sorted(missing)}"
        )

print("Downloading historical NFL schedules...")

schedules = nfl.load_schedules(YEARS)

require_columns(
    schedules,
    [
        "game_id", "season", "week",
        "game_type", "gameday",
        "home_team", "away_team",
        "home_score", "away_score",
        "spread_line", "total_line"
    ],
    "Schedules"
)

games = schedules.filter(
    (pl.col("game_type") == "REG") &
    pl.col("home_score").is_not_null() &
    pl.col("away_score").is_not_null()
)

if games.is_empty():
    raise RuntimeError("No completed games found.")

if games["game_id"].n_unique() != games.height:
    raise RuntimeError("Duplicate schedule game IDs.")

games.write_parquet(
    OUT / "games_2020_2025.parquet"
)

print(f"Saved {games.height} completed games.")

print("Downloading historical play-by-play data...")

all_epa = []

for year in YEARS:
    print(f"Processing {year}...")

    pbp = nfl.load_pbp(year)

    require_columns(
        pbp,
        [
            "game_id", "posteam",
            "defteam", "epa",
            "play_type", "season_type"
        ],
        f"PBP {year}"
    )

    pbp = pbp.filter(
        (pl.col("season_type") == "REG") &
        pl.col("posteam").is_not_null() &
        pl.col("defteam").is_not_null() &
        pl.col("epa").is_not_null() &
        pl.col("play_type").is_in(["pass", "run"])
    )

    summary = (
        pbp.group_by(
            ["game_id", "posteam", "defteam"]
        )
        .agg(
            pl.len().alias("plays"),
            pl.col("epa").mean().alias("epa_per_play"),
            pl.col("epa").sum().alias("total_epa")
        )
        .with_columns(
            pl.lit(year).alias("season")
        )
    )

    all_epa.append(summary)

epa_games = pl.concat(all_epa)

epa_games.write_parquet(
    OUT / "game_epa_2020_2025.parquet"
)

# Validate EPA coverage against game results.
expected = games.height * 2

matched = epa_games.join(
    games.select("game_id"),
    on="game_id",
    how="inner"
)

if matched.height != expected:
    raise RuntimeError(
        "EPA coverage mismatch: "
        f"expected {expected} team-games, "
        f"found {matched.height}. "
        "Inspect missing or duplicate team-game records."
    )

metadata = {
    "source": "nflverse / nflreadpy",
    "seasons": YEARS,
    "generated_utc": datetime.now(
        timezone.utc
    ).isoformat(),
    "completed_games": games.height,
    "epa_team_games": matched.height,
    "validation": "passed",
    "probabilities_calibrated": False
}

(OUT / "metadata.json").write_text(
    json.dumps(metadata, indent=2),
    encoding="utf-8"
)

print("HISTORICAL DATASET VALIDATED")
print(json.dumps(metadata, indent=2))
