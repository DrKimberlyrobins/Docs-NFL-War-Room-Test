
"""Doc's NFL War Room: chronological NFL win-probability training and test."""
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
OUT.mkdir(exist_ok=True)

s = pd.read_parquet(ROOT / "games_2020_2025.parquet")
e = pd.read_parquet(ROOT / "game_epa_2020_2025.parquet")

required_s = {
    "game_id", "season", "week", "gameday",
    "home_team", "away_team", "home_score", "away_score"
}
required_e = {
    "game_id", "posteam", "defteam", "epa_per_play", "plays"
}

assert required_s.issubset(s.columns), sorted(required_s - set(s.columns))
assert required_e.issubset(e.columns), sorted(required_e - set(e.columns))
assert s.game_id.is_unique, "Duplicate games"
assert not e.duplicated(["game_id", "posteam"]).any(), "Duplicate EPA team-games"
assert s.season.between(2020, 2025).all(), "Unexpected seasons"

s["date"] = pd.to_datetime(s.gameday, errors="raise")
s = s.sort_values(["date", "game_id"])

epa = {
    (str(r.game_id), str(r.posteam)): float(r.epa_per_play)
    for r in e.itertuples()
    if pd.notna(r.epa_per_play)
}

# Construct pregame features before adding each game's results.
history = defaultdict(list)
rows = []

def stats(h):
    if not h:
        return [0.0, 0.0, 22.0, 22.0, 0.0]
    return [
        float(np.mean([x[0] for x in h])),
        float(np.mean([x[1] for x in h])),
        float(np.mean([x[2] for x in h])),
        float(np.mean([x[3] for x in h])),
        float(len(h)),
    ]

for g in s.itertuples():
    year = int(g.season)
    home = str(g.home_team)
    away = str(g.away_team)

    hkey = (year, home)
    akey = (year, away)

    hh = history[hkey][-8:]
    ah = history[akey][-8:]

    hs = stats(hh)
    a_s = stats(ah)

    features = (
        [hs[i] - a_s[i] for i in range(4)]
        + [hs[4], a_s[4]]
    )

    if g.home_score == g.away_score:
        raise ValueError(
            f"Tied final game: {g.game_id}; tie handling required"
        )

    rows.append({
        "game_id": str(g.game_id),
        "season": year,
        "week": int(g.week),
        "date": str(g.date.date()),
        "home": home,
        "away": away,
        "y": int(g.home_score > g.away_score),
        "features": features,
    })

    he = epa.get((str(g.game_id), home))
    ae = epa.get((str(g.game_id), away))

    if he is None or ae is None:
        raise ValueError(f"Missing game EPA for {g.game_id}")

    history[hkey].append(
        (he, ae, float(g.home_score), float(g.away_score))
    )
    history[akey].append(
        (ae, he, float(g.away_score), float(g.home_score))
    )

frame = pd.DataFrame(rows)

assert set(frame.season.unique()) == set(
    range(2020, 2026)
), "Missing season"

train = frame[frame.season <= 2023]
cal = frame[frame.season == 2024]
test = frame[frame.season == 2025]

assert min(len(train), len(cal), len(test)) > 100, (
    "Insufficient samples"
)

def X(f):
    return np.asarray(f.features.tolist(), dtype=float)

assert np.isfinite(X(frame)).all(), "Nonfinite features"

# Fit the base model on 2020-2023 only.
base = make_pipeline(
    StandardScaler(),
    LogisticRegression(max_iter=2000, C=1.0),
)
base.fit(X(train), train.y)

raw_cal = np.clip(
    base.predict_proba(X(cal))[:, 1],
    1e-6, 1 - 1e-6,
)

def logit(p):
    return np.log(p / (1 - p)).reshape(-1, 1)

# Calibrate using 2024 only.
calibrator = LogisticRegression(max_iter=2000, C=1000)
calibrator.fit(logit(raw_cal), cal.y)

# Test once on the untouched 2025 season.
raw_test = np.clip(
    base.predict_proba(X(test))[:, 1],
    1e-6, 1 - 1e-6,
)

prob = np.clip(
    calibrator.predict_proba(logit(raw_test))[:, 1],
    1e-6, 1 - 1e-6,
)
y = test.y.to_numpy()

bins = []

for lo, hi in zip(
    np.arange(0, 1, 0.1),
    np.arange(0.1, 1.01, 0.1),
):
    mask = (prob >= lo) & (
        prob < (hi if hi < 1 else 1.000001)
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
    "model": "pregame_logistic_v1",
    "generated_utc": datetime.now(timezone.utc).isoformat(),
    "source": "nflverse historical schedules and play-by-play EPA",
    "train_seasons": "2020-2023",
    "calibration_season": 2024,
    "untouched_test_season": 2025,
    "sample_counts": {
        "train": len(train),
        "calibration": len(cal),
        "test": len(test),
    },
    "test": {
        "brier": round(float(brier_score_loss(y, prob)), 5),
        "log_loss": round(float(log_loss(y, prob)), 5),
        "accuracy": round(
            float(accuracy_score(y, prob >= 0.5)), 5
        ),
        "roc_auc": round(float(roc_auc_score(y, prob)), 5),
        "baseline_home_win_brier": round(
            float(
                brier_score_loss(
                    y, np.full(len(y), train.y.mean())
                )
            ),
            5,
        ),
    },
    "calibration_bins": bins,
    "limitations": [
        "Home-win probabilities only; no spreads or totals yet",
        "Season-reset eight-game rolling EPA and points",
        "No injury, quarterback, or lineup information",
        "Calibration uses one season",
        "One held-out season does not prove profitability",
    ],
}

joblib.dump(
    {
        "base": base,
        "calibrator": calibrator,
        "features": [
            "off_epa_diff",
            "def_epa_allowed_diff",
            "points_for_diff",
            "points_allowed_diff",
            "home_games",
            "away_games",
        ],
        "report": report,
    },
    OUT / "nfl_win_model.joblib",
)

(OUT / "test_report.json").write_text(
    json.dumps(report, indent=2),
    encoding="utf-8",
)

pred = test[["game_id", "date", "home", "away", "y"]].copy()
pred["predicted_home_win_probability"] = prob

pred.to_csv(
    OUT / "2025_heldout_predictions.csv",
    index=False,
)

print(json.dumps(report, indent=2))
