
"""
DOC'S NFL WAR ROOM
V2 GAME PROBABILITY GENERATOR

Uses the EXISTING trained model.
Recreates the six original training features.
Never includes games played on or after the
prediction cutoff date in team history.

Outputs probabilities for every scheduled
regular-season matchup in the selected window.
"""

import argparse
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import joblib
import nflreadpy as nfl
import numpy as np
import pandas as pd

MODEL_PATH = Path("model-output/nfl_win_model.joblib")
OUTPUT_PATH = Path("nfl-game-probabilities-2026.json")

EXPECTED_FEATURES = [
    "off_epa_diff",
    "def_epa_allowed_diff",
    "points_for_diff",
    "points_allowed_diff",
    "home_games",
    "away_games",
]


def team_stats(records):
    """Exact same feature calculation as training v2."""
    records = records[-8:]

    if not records:
        return [0.0, 0.0, 22.0, 22.0, 0.0]

    return [
        float(np.mean([r[0] for r in records])),
        float(np.mean([r[1] for r in records])),
        float(np.mean([r[2] for r in records])),
        float(np.mean([r[3] for r in records])),
        float(len(records)),
    ]


def calibrated_probability(model, features):
    x = np.asarray([features], dtype=float)

    raw = model["base"].predict_proba(x)[0, 1]
    raw = np.clip(raw, 1e-6, 1 - 1e-6)

    logit = np.log(raw / (1 - raw))

    probability = model["calibrator"].predict_proba(
        np.asarray([[logit]])
    )[0, 1]

    return float(np.clip(probability, 1e-6, 1 - 1e-6))


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--from-date",
        default=datetime.now(
            ZoneInfo("America/Chicago")
        ).strftime("%Y-%m-%d"),
        help="First date to display, YYYY-MM-DD",
    )

    parser.add_argument(
        "--days",
        type=int,
        default=8,
        help="Number of calendar days to include",
    )

    args = parser.parse_args()

    cutoff = pd.Timestamp(args.from_date).normalize()
    end = cutoff + pd.Timedelta(days=args.days)

    if args.days < 1 or args.days > 30:
        raise ValueError("--days must be between 1 and 30")

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            "Trained model not found: " + str(MODEL_PATH)
        )

    model = joblib.load(MODEL_PATH)

    if model.get("features") != EXPECTED_FEATURES:
        raise ValueError(
            "Saved model feature names do not match v2."
        )

    print("Loading 2026 NFL schedules...")
    schedules = nfl.load_schedules(2026).to_pandas()

    print("Loading 2026 NFL play-by-play...")
    pbp = nfl.load_pbp(2026).to_pandas()

    schedule_columns = {
        "game_id", "season", "week", "gameday",
        "home_team", "away_team",
        "home_score", "away_score", "game_type",
    }

    pbp_columns = {
        "game_id", "posteam", "defteam", "epa",
    }

    missing_s = schedule_columns - set(schedules.columns)
    missing_p = pbp_columns - set(pbp.columns)

    if missing_s or missing_p:
        raise ValueError(
            f"Missing data fields: schedules={missing_s}, "
            f"play-by-play={missing_p}"
        )

    schedules = schedules[
        (schedules["season"] == 2026) &
        (schedules["game_type"] == "REG")
    ].copy()

    schedules["date"] = pd.to_datetime(
        schedules["gameday"]
    ).dt.normalize()

    schedules = schedules.sort_values(
        ["date", "game_id"]
    )

    # Build game-level offensive EPA using the same
    # per-play mean structure as the historical dataset.
    pbp = pbp[
        pbp["posteam"].notna() &
        pbp["defteam"].notna() &
        pbp["epa"].notna()
    ].copy()

    pbp["epa"] = pd.to_numeric(
        pbp["epa"], errors="coerce"
    )

    pbp = pbp[np.isfinite(pbp["epa"])]

    epa_table = (
        pbp.groupby(["game_id", "posteam"])
        .agg(
            epa_per_play=("epa", "mean"),
            plays=("epa", "size"),
        )
        .reset_index()
    )

    epa_lookup = {
        (str(r.game_id), str(r.posteam)):
            float(r.epa_per_play)
        for r in epa_table.itertuples()
    }

    history = defaultdict(list)

    # The training model resets team history every season.
    # Only completed games BEFORE the cutoff enter history.
    prior_games = schedules[
        schedules["date"] < cutoff
    ].copy()

    print(
        "Building team histories from",
        len(prior_games),
        "previously completed scheduled games..."
    )

    for game_date, day_games in prior_games.groupby(
        "date", sort=True
    ):
        updates = []

        for g in day_games.itertuples():
            if pd.isna(g.home_score) or pd.isna(g.away_score):
                continue

            home = str(g.home_team)
            away = str(g.away_team)
            game_id = str(g.game_id)

            he = epa_lookup.get((game_id, home))
            ae = epa_lookup.get((game_id, away))

            if he is None or ae is None:
                raise ValueError(
                    "Missing game-level EPA for completed "
                    f"game {game_id}. Cannot safely build "
                    "the exact rolling features."
                )

            updates.append((
                home, away, he, ae,
                float(g.home_score),
                float(g.away_score),
            ))

        # Keep same-date results together.
        for home, away, he, ae, hs, aws in updates:
            history[home].append((he, ae, hs, aws))
            history[away].append((ae, he, aws, hs))

    upcoming = schedules[
        (schedules["date"] >= cutoff) &
        (schedules["date"] < end)
    ].copy()

    if upcoming.empty:
        raise ValueError(
            "No NFL regular-season games in selected window."
        )

    generated = datetime.now(
        timezone.utc
    ).isoformat()

    results = []

    for g in upcoming.itertuples():
        home = str(g.home_team)
        away = str(g.away_team)

        hs = team_stats(history[home])
        aws = team_stats(history[away])

        features = [
            hs[i] - aws[i]
            for i in range(4)
        ] + [hs[4], aws[4]]

        p_home = calibrated_probability(
            model, features
        )

        p_away = 1 - p_home

        results.append({
            "game_id": str(g.game_id),
            "date": str(g.date.date()),
            "week": int(g.week),
            "away": away,
            "home": home,
            "model": "pregame_logistic_v2",
            "home_win_probability": round(
                p_home * 100, 2
            ),
            "away_win_probability": round(
                p_away * 100, 2
            ),
            "model_favorite": (
                home if p_home >= 0.5 else away
            ),
            "home_games_in_features": int(hs[4]),
            "away_games_in_features": int(aws[4]),
            "features": dict(
                zip(EXPECTED_FEATURES, features)
            ),
            "feature_cutoff_date": str(
                cutoff.date()
            ),
            "snapshot_generated_utc": generated,
            "status": (
                "historical_or_in_progress_check_kickoff"
                if pd.notna(g.home_score)
                or pd.notna(g.away_score)
                else "scheduled_check_kickoff"
            ),
        })

        print(
            f"{away} @ {home}: "
            f"{home} {p_home:.1%}, "
            f"{away} {p_away:.1%}"
        )

    output = {
        "model": "pregame_logistic_v2",
        "season": 2026,
        "generated_utc": generated,
        "feature_cutoff_date": str(cutoff.date()),
        "games_count": len(results),
        "probability_definition": (
            "Binary win probability conditional on no tie"
        ),
        "source": "nflreadpy 2026 schedules and play-by-play",
        "notes": [
            "Trained model is unchanged.",
            "No results on or after cutoff date are used.",
            "Predictions generated after kickoff are not "
            "valid timestamped pregame predictions.",
            "No sportsbook prices are included.",
            "No player-prop probabilities are included.",
            "Model v2 has not demonstrated a sportsbook edge.",
        ],
        "games": results,
    }

    OUTPUT_PATH.write_text(
        json.dumps(output, indent=2),
        encoding="utf-8",
    )

    print(
        f"SUCCESS: Wrote {len(results)} games to "
        f"{OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()
