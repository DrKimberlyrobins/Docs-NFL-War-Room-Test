
"""
DOC'S NFL WAR ROOM
Historical Win Probability Engine v2

Train: 2020-2023
Calibrate: 2024
Held-out test: 2025

Ties are excluded from binary outcome training
but included in subsequent team statistics.

All features are constructed from earlier dates.
"""

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path("historical")
OUT = Path("model-output")
OUT.mkdir(parents=True, exist_ok=True)

FEATURE_NAMES = [
    "off_epa_diff",
    "def_epa_allowed_diff",
    "points_for_diff",
    "points_allowed_diff",
    "home_games",
    "away_games",
]

print("Loading historical NFL datasets...")

s = pd.read_parquet(
    ROOT / "games_2020_2025.parquet"
)
e = pd.read_parquet(
    ROOT / "game_epa_2020_2025.parquet"
)

required_s = {
    "game_id", "season", "week", "gameday",
    "home_team", "away_team",
    "home_score", "away_score",
}
required_e = {
    "game_id", "posteam", "defteam",
    "epa_per_play", "plays",
}

missing_s = required_s - set(s.columns)
missing_e = required_e - set(e.columns)

if missing_s or missing_e:
    raise ValueError(
        f"Missing columns: schedules={missing_s}, EPA={missing_e}"
    )

if not s.game_id.is_unique:
    raise ValueError("Duplicate schedule game IDs")

if e.duplicated(["game_id", "posteam"]).any():
    raise ValueError("Duplicate EPA team-game records")

if not s.season.between(2020, 2025).all():
    raise ValueError("Unexpected seasons")

if s[["home_score", "away_score"]].isna().any().any():
    raise ValueError("Incomplete game scores")

s["date"] = pd.to_datetime(
    s.gameday, errors="raise"
).dt.normalize()

s = s.sort_values(
    ["date", "game_id"]
).reset_index(drop=True)

epa = {}

for r in e.itertuples():
    if pd.notna(r.epa_per_play):
        epa[
            (str(r.game_id), str(r.posteam))
        ] = float(r.epa_per_play)

history = defaultdict(list)
rows = []
ties = []

def team_stats(records):
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

print("Building chronological pregame features...")

# All games on the same calendar date are evaluated
# before ANY results from that date enter history.
for game_date, day_games in s.groupby(
    "date", sort=True
):
    pending_updates = []

    for g in day_games.itertuples():
        year = int(g.season)
        home = str(g.home_team)
        away = str(g.away_team)
        game_id = str(g.game_id)

        home_key = (year, home)
        away_key = (year, away)

        hs = team_stats(history[home_key])
        aws = team_stats(history[away_key])

        features = [
            hs[i] - aws[i] for i in range(4)
        ] + [hs[4], aws[4]]

        he = epa.get((game_id, home))
        ae = epa.get((game_id, away))

        if he is None or ae is None:
            raise ValueError(
                f"Missing EPA for {game_id}"
            )

        home_score = float(g.home_score)
        away_score = float(g.away_score)

        if home_score == away_score:
            ties.append(game_id)
        else:
            rows.append({
                "game_id": game_id,
                "season": year,
                "week": int(g.week),
                "date": str(game_date.date()),
                "home": home,
                "away": away,
                "y": int(home_score > away_score),
                "features": features,
            })

        pending_updates.append((
            home_key,
            away_key,
            he,
            ae,
            home_score,
            away_score,
        ))

    for (
        home_key,
        away_key,
        he,
        ae,
        home_score,
        away_score,
    ) in pending_updates:
        history[home_key].append(
            (he, ae, home_score, away_score)
        )
        history[away_key].append(
            (ae, he, away_score, home_score)
        )

frame = pd.DataFrame(rows)

if frame.empty:
    raise ValueError("No training records generated")

if set(frame.season.unique()) != set(
    range(2020, 2026)
):
    raise ValueError("Missing historical season")

train = frame[frame.season <= 2023].copy()
cal = frame[frame.season == 2024].copy()
test = frame[frame.season == 2025].copy()

if min(len(train), len(cal), len(test)) <= 100:
    raise ValueError("Insufficient training/test samples")

def X(data):
    return np.asarray(
        data.features.tolist(), dtype=float
    )

if not np.isfinite(X(frame)).all():
    raise ValueError("Invalid numerical features")

if any(
    subset.y.nunique() != 2
    for subset in (train, cal, test)
):
    raise ValueError(
        "A dataset split lacks both outcomes"
    )

print("Training on 2020-2023...")

base = make_pipeline(
    StandardScaler(),
    LogisticRegression(
        max_iter=2000,
        C=1.0,
    ),
)

base.fit(X(train), train.y)

print("Calibrating on 2024...")

def logit(p):
    p = np.clip(
        np.asarray(p, dtype=float),
        1e-6,
        1 - 1e-6,
    )
    return np.log(p / (1 - p)).reshape(-1, 1)

raw_cal = base.predict_proba(X(cal))[:, 1]

calibrator = LogisticRegression(
    max_iter=2000,
    C=1000,
)

calibrator.fit(
    logit(raw_cal),
    cal.y,
)

print("Testing on untouched 2025 games...")

raw_test = base.predict_proba(X(test))[:, 1]

prob = np.clip(
    calibrator.predict_proba(
        logit(raw_test)
    )[:, 1],
    1e-6,
    1 - 1e-6,
)

y = test.y.to_numpy()

bins = []

for lo in np.arange(0, 1, 0.1):
    hi = round(float(lo + 0.1), 10)

    mask = (prob >= lo) & (
        prob < hi if hi < 1 else prob <= 1
    )

    bins.append({
        "range": f"{lo:.1f}-{hi:.1f}",
        "games": int(mask.sum()),
        "predicted": (
            round(float(prob[mask].mean()), 4)
            if mask.any() else None
        ),
        "observed": (
            round(float(y[mask].mean()), 4)
            if mask.any() else None
        ),
    })

report = {
    "model": "pregame_logistic_v2",
    "generated_utc": datetime.now(
        timezone.utc
    ).isoformat(),
    "train_seasons": "2020-2023",
    "calibration_season": 2024,
    "test_season": 2025,
    "ties_excluded_from_binary_training": len(ties),
    "tied_game_ids": ties,
    "sample_counts": {
        "train": int(len(train)),
        "calibration": int(len(cal)),
        "test": int(len(test)),
    },
    "test": {
        "brier": round(
            float(brier_score_loss(y, prob)), 5
        ),
        "log_loss": round(
            float(log_loss(y, prob)), 5
        ),
        "accuracy": round(
            float(accuracy_score(y, prob >= 0.5)), 5
        ),
        "roc_auc": round(
            float(roc_auc_score(y, prob)), 5
        ),
        "baseline_home_win_brier": round(
            float(
                brier_score_loss(
                    y,
                    np.full(
                        len(y),
                        train.y.mean(),
                    ),
                )
            ),
            5,
        ),
    },
    "calibration_bins": bins,
    "limitations": [
        "Binary win probability conditional on no tie",
        "No spread or total probabilities",
        "No injuries or confirmed starting quarterbacks",
        "Eight-game rolling statistics reset each season",
        "One held-out season does not prove profitability",
    ],
}

joblib.dump(
    {
        "base": base,
        "calibrator": calibrator,
        "features": FEATURE_NAMES,
        "report": report,
    },
    OUT / "nfl_win_model.joblib",
)

(OUT / "test_report.json").write_text(
    json.dumps(report, indent=2),
    encoding="utf-8",
)

pred = test[
    ["game_id", "date", "home", "away", "y"]
].copy()

pred["predicted_home_win_probability"] = prob

pred.to_csv(
    OUT / "2025_heldout_predictions.csv",
    index=False,
)

print("TRAINING AND TESTING COMPLETE")
print(json.dumps(report, indent=2))
