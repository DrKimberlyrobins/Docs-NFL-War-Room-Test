
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import binomtest

HISTORY = Path("historical/games_2020_2025.parquet")
PREDICTIONS = Path("model-output/2025_heldout_predictions.csv")
OUT = Path("model-output")
OUT.mkdir(exist_ok=True)

games = pd.read_parquet(HISTORY)
pred = pd.read_csv(PREDICTIONS)

p = pred["predicted_home_win_probability"].to_numpy()
y = pred["y"].to_numpy()

print("=== CALIBRATION AUDIT ===")

for low in np.arange(0, 1, 0.1):
    high = round(float(low + 0.1), 10)
    mask = (p >= low) & (p < high)
    n = int(mask.sum())

    if n == 0:
        continue

    wins = int(y[mask].sum())
    ci = binomtest(wins, n).proportion_ci(
        confidence_level=0.95,
        method="exact"
    )

    print(
        f"{low:.0%}-{high:.0%}: "
        f"n={n}, "
        f"predicted={p[mask].mean():.1%}, "
        f"actual={wins/n:.1%}, "
        f"95% CI=[{ci.low:.1%}, {ci.high:.1%}]"
    )

def implied_probability(odds):
    odds = pd.to_numeric(odds, errors="coerce")
    return np.where(
        odds < 0,
        -odds / (-odds + 100),
        100 / (odds + 100)
    )

print("\n=== SPORTSBOOK AUDIT ===")

needed = {"home_moneyline", "away_moneyline"}

if not needed.issubset(games.columns):
    print("NOT VERIFIED: historical moneyline columns missing.")
    print("Available columns:", games.columns.tolist())
    raise SystemExit(0)

market = games[
    ["game_id", "home_moneyline", "away_moneyline"]
].copy()

joined = pred.merge(
    market,
    on="game_id",
    how="left",
    validate="one_to_one"
)

for col in ["home_moneyline", "away_moneyline"]:
    joined[col] = pd.to_numeric(
        joined[col], errors="coerce"
    )

valid = (
    joined.home_moneyline.notna()
    & joined.away_moneyline.notna()
    & (joined.home_moneyline != 0)
    & (joined.away_moneyline != 0)
)

matched = joined.loc[valid].copy()

print(f"Games with valid prices: {len(matched)}/{len(pred)}")

if len(matched) < 100:
    print("INSUFFICIENT COVERAGE: no sportsbook advantage claim.")
    raise SystemExit(0)

home_raw = implied_probability(matched.home_moneyline)
away_raw = implied_probability(matched.away_moneyline)

# Remove the sportsbook's two-sided margin.
market_prob = home_raw / (home_raw + away_raw)

model_prob = matched.predicted_home_win_probability.to_numpy()
actual = matched.y.to_numpy()

model_errors = (model_prob - actual) ** 2
market_errors = (market_prob - actual) ** 2

model_brier = float(model_errors.mean())
market_brier = float(market_errors.mean())
difference = market_brier - model_brier

rng = np.random.default_rng(2026)
indices = rng.integers(
    0, len(matched), size=(10000, len(matched))
)
bootstrap = (
    market_errors[indices] - model_errors[indices]
).mean(axis=1)

lower, upper = np.quantile(bootstrap, [0.025, 0.975])

report = {
    "matched_games": len(matched),
    "model_brier": model_brier,
    "sportsbook_no_vig_brier": market_brier,
    "market_minus_model_brier": difference,
    "paired_bootstrap_95_interval": [float(lower), float(upper)],
    "model_beats_market_on_brier": bool(difference > 0),
    "statistically_supported_improvement": bool(lower > 0),
    "important": (
        "Historical moneyline timestamp and whether prices were "
        "available before kickoff must be verified. "
        "Brier improvement does not establish betting profitability."
    )
}

(OUT / "market_audit.json").write_text(
    json.dumps(report, indent=2),
    encoding="utf-8"
)

print(json.dumps(report, indent=2))
