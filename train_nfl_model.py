
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


# ============================================================
# DOC'S NFL WAR ROOM — V2 STRENGTH OF SCHEDULE EXPERIMENT
#
# Tests:
# 1. Original V2 six-feature model
# 2. Original V2 + pregame offensive/defensive SOS
#
# Uses the same training/calibration/test years.
# Does not overwrite the working V2 model.
# ============================================================

print("\n" + "=" * 60)
print("V2 STRENGTH OF SCHEDULE EXPERIMENT")
print("=" * 60)

SOS_FEATURE_NAMES = [
    "opponent_offensive_strength_diff",
    "opponent_defensive_strength_diff",
]

# Each team-game record stores:
# offense EPA, defense EPA allowed,
# points scored, points allowed,
# opponent's PRE-GAME offensive EPA,
# opponent's PRE-GAME defensive EPA allowed.

sos_history = defaultdict(list)
sos_rows = []


def sos_team_stats(records):
    recent = records[-8:]

    if not recent:
        return [
            0.0, 0.0, 22.0, 22.0,
            0.0, 0.0, 0.0,
        ]

    return [
        float(np.mean([r[0] for r in recent])),
        float(np.mean([r[1] for r in recent])),
        float(np.mean([r[2] for r in recent])),
        float(np.mean([r[3] for r in recent])),
        float(len(recent)),
        float(np.mean([r[4] for r in recent])),
        float(np.mean([r[5] for r in recent])),
    ]


# Rebuild historical features chronologically.
# No results from the current game date can enter
# the calculations for another game on that date.

for game_date, day_games in s.groupby("date", sort=True):

    pending = []

    for g in day_games.itertuples():

        year = int(g.season)
        home = str(g.home_team)
        away = str(g.away_team)
        game_id = str(g.game_id)

        hk = (year, home)
        ak = (year, away)

        hs = sos_team_stats(sos_history[hk])
        aws = sos_team_stats(sos_history[ak])

        original_features = [
            hs[i] - aws[i] for i in range(4)
        ] + [hs[4], aws[4]]

        # SOS:
        # Stronger opposing offenses have higher EPA.
        # Stronger opposing defenses allow lower EPA.
        #
        # Both numbers describe opponents at the
        # time those opponents were originally faced.

        home_off_sos = hs[5]
        away_off_sos = aws[5]

        home_def_sos = -hs[6]
        away_def_sos = -aws[6]

        sos_features = [
            home_off_sos - away_off_sos,
            home_def_sos - away_def_sos,
        ]

        home_score = float(g.home_score)
        away_score = float(g.away_score)

        he = epa.get((game_id, home))
        ae = epa.get((game_id, away))

        if he is None or ae is None:
            raise ValueError(
                f"SOS experiment missing EPA: {game_id}"
            )

        if home_score != away_score:
            sos_rows.append({
                "game_id": game_id,
                "season": year,
                "week": int(g.week),
                "y": int(home_score > away_score),
                "original": original_features,
                "with_sos": (
                    original_features + sos_features
                ),
            })

        # Save opponent strength as it was known
        # BEFORE the current game was played.
        pending.append((
            hk, ak, he, ae,
            home_score, away_score,
            hs[0], hs[1],
            aws[0], aws[1],
        ))

    for (
        hk, ak, he, ae,
        home_score, away_score,
        home_off_before, home_def_before,
        away_off_before, away_def_before,
    ) in pending:

        sos_history[hk].append((
            he, ae,
            home_score, away_score,
            away_off_before,
            away_def_before,
        ))

        sos_history[ak].append((
            ae, he,
            away_score, home_score,
            home_off_before,
            home_def_before,
        ))


sos_frame = pd.DataFrame(sos_rows)

if sos_frame.empty:
    raise ValueError("No SOS training records generated")

# Verify that the experiment uses the same games
# and outcomes as the original V2 evaluation.

original_ids = frame["game_id"].tolist()
experiment_ids = sos_frame["game_id"].tolist()

if original_ids != experiment_ids:
    raise ValueError(
        "SOS experiment games do not match V2"
    )

if not np.array_equal(
    frame["y"].to_numpy(),
    sos_frame["y"].to_numpy(),
):
    raise ValueError(
        "SOS experiment outcomes do not match V2"
    )

original_matrix = np.asarray(
    frame["features"].tolist(), dtype=float
)

sos_original_matrix = np.asarray(
    sos_frame["original"].tolist(), dtype=float
)

if not np.allclose(
    original_matrix,
    sos_original_matrix,
    rtol=0,
    atol=1e-12,
):
    raise ValueError(
        "Original V2 features were not reproduced"
    )

print("Verified: identical games and original features")


def test_candidate(feature_column):

    training = sos_frame[
        sos_frame.season <= 2023
    ]

    calibration = sos_frame[
        sos_frame.season == 2024
    ]

    testing = sos_frame[
        sos_frame.season == 2025
    ]

    def matrix(subset):
        result = np.asarray(
            subset[feature_column].tolist(),
            dtype=float,
        )

        if not np.isfinite(result).all():
            raise ValueError(
                f"Invalid {feature_column} features"
            )

        return result

    candidate = make_pipeline(
        StandardScaler(),
        LogisticRegression(
            max_iter=2000,
            C=1.0,
        ),
    )

    candidate.fit(
        matrix(training),
        training.y,
    )

    raw_cal = candidate.predict_proba(
        matrix(calibration)
    )[:, 1]

    candidate_calibrator = LogisticRegression(
        max_iter=2000,
        C=1000,
    )

    candidate_calibrator.fit(
        logit(raw_cal),
        calibration.y,
    )

    raw_test = candidate.predict_proba(
        matrix(testing)
    )[:, 1]

    probabilities = np.clip(
        candidate_calibrator.predict_proba(
            logit(raw_test)
        )[:, 1],
        1e-6,
        1 - 1e-6,
    )

    actual = testing.y.to_numpy()

    metrics = {
        "brier": float(
            brier_score_loss(actual, probabilities)
        ),
        "accuracy": float(
            accuracy_score(
                actual,
                probabilities >= 0.5,
            )
        ),
        "log_loss": float(
            log_loss(actual, probabilities)
        ),
        "games": int(len(testing)),
    }

    return (
        candidate,
        candidate_calibrator,
        probabilities,
        metrics,
    )


print("Testing original V2 baseline...")

(
    baseline_model,
    baseline_calibrator,
    baseline_probs,
    baseline_metrics,
) = test_candidate("original")

print("Testing V2 with SOS...")

(
    sos_model,
    sos_calibrator,
    sos_probs,
    sos_metrics,
) = test_candidate("with_sos")

# The experiment must reproduce the original V2
# result before comparing any new feature.

if abs(
    baseline_metrics["brier"]
    - report["test"]["brier"]
) > 0.0001:
    raise ValueError(
        "Baseline reproduction failed. "
        "Do not trust the SOS comparison."
    )

sportsbook_brier = 0.21213896835079202

improvement = (
    baseline_metrics["brier"]
    - sos_metrics["brier"]
)

print("\n" + "=" * 60)
print("2025 HELD-OUT TEST RESULTS")
print("=" * 60)

print(
    "Original V2 Brier:",
    round(baseline_metrics["brier"], 6)
)

print(
    "V2 + SOS Brier:",
    round(sos_metrics["brier"], 6)
)

print(
    "Sportsbook benchmark:",
    round(sportsbook_brier, 6)
)

print(
    "SOS improvement:",
    round(improvement, 6)
)

print(
    "Original V2 accuracy:",
    round(baseline_metrics["accuracy"] * 100, 2),
    "%",
)

print(
    "V2 + SOS accuracy:",
    round(sos_metrics["accuracy"] * 100, 2),
    "%",
)

if improvement > 0:
    print("RESULT: SOS improved the 2025 Brier score.")
elif improvement < 0:
    print("RESULT: SOS worsened the 2025 Brier score.")
else:
    print("RESULT: SOS produced no Brier improvement.")

if sos_metrics["brier"] < sportsbook_brier:
    print(
        "SOS beat the historical sportsbook "
        "benchmark on this test sample."
    )
else:
    print(
        "SOS did not beat the historical "
        "sportsbook benchmark."
    )

# Save the experiment separately.
# Do not overwrite nfl_win_model.joblib.

sos_report = {
    "experiment": "V2 pregame strength of schedule",
    "feature_names": (
        FEATURE_NAMES + SOS_FEATURE_NAMES
    ),
    "original_v2": baseline_metrics,
    "v2_with_sos": sos_metrics,
    "sportsbook_brier": sportsbook_brier,
    "brier_improvement": improvement,
    "same_games_as_v2": True,
    "season_reset_preserved": True,
    "uses_only_previous_game_information": True,
    "warning": (
        "This is a retrospective 2025 experiment. "
        "Further independent validation is required."
    ),
}

(OUT / "sos_experiment_report.json").write_text(
    json.dumps(sos_report, indent=2),
    encoding="utf-8",
)

joblib.dump(
    {
        "base": sos_model,
        "calibrator": sos_calibrator,
        "features": (
            FEATURE_NAMES + SOS_FEATURE_NAMES
        ),
        "report": sos_report,
    },
    OUT / "nfl_sos_experiment.joblib",
)

print("\nSOS EXPERIMENT COMPLETE")
print("Original working V2 model preserved.")

