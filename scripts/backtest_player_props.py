#!/usr/bin/env python3
"""Leakage-free walk-forward audit of 2026 NFL player prop estimates.

Only prior games can inform a prediction. This evaluates synthetic historical
lines, not sportsbook odds. Player eligibility uses actual prior market usage.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

DATA = Path("data/player-game-logs-2026.json")
OUT = Path("data/player-model-audit-2026.json")
FIELDS = ("passingYards", "completions", "attempts", "rushingYards",
          "carries", "receivingYards", "receptions", "targets")
ROLE = {"passingYards": "attempts", "completions": "attempts",
        "attempts": "attempts", "rushingYards": "carries",
        "carries": "carries", "receivingYards": "targets",
        "receptions": "targets", "targets": "targets"}
MIN_ROLE = {"attempts": 10, "carries": 4, "targets": 3}


def estimate(values, line):
    n = len(values)
    avg = sum(values) / n
    sd = math.sqrt(sum((v - avg) ** 2 for v in values) / max(n - 1, 1))
    sd = max(sd, math.sqrt(max(1, avg)) * .7, 1) * math.sqrt(1 + 1 / n)
    z = (line + .5 - avg) / sd
    return min(.99, max(.01, .5 * math.erfc(z / math.sqrt(2))))


def main():
    source = json.loads(DATA.read_text(encoding="utf-8"))
    if source.get("season") != 2026 or not source.get("players"):
        raise ValueError("Missing or invalid 2026 player game logs")

    report = {}
    for market in FIELDS:
        predictions = []
        by_player = defaultdict(int)
        for player in source["players"]:
            games = sorted(player.get("games", []), key=lambda g: g["week"])
            # Dedupe weeks; a player should have only one row per team/week.
            unique = {g["week"]: g for g in games}
            games = [unique[w] for w in sorted(unique)]
            for i in range(5, len(games)):
                prior = games[:i]
                actual = games[i].get(market)
                if actual is None:
                    continue
                role = ROLE[market]
                recent_role = [float(g.get(role) or 0) for g in prior[-5:]]
                # Prior established role; exclude one-off trick plays,
                # but include players with an occasional zero in the market.
                if sum(recent_role) / len(recent_role) < MIN_ROLE[role]:
                    continue
                values = [float(g[market]) for g in prior if g.get(market) is not None]
                if len(values) < 5:
                    continue
                values = values[-10:]
                ordered = sorted(values)
                median = (ordered[(len(ordered)-1)//2] + ordered[len(ordered)//2]) / 2
                # Synthetic half-point threshold. Not an actual Kambi line.
                line = math.floor(median) + .5
                p = estimate(values, line)
                y = int(float(actual) > line)
                predictions.append((p, y))
                by_player[player.get("name") or player.get("shortName") or player.get("id")] += 1

        if not predictions:
            report[market] = {"predictions": 0, "uniquePlayers": 0, "status": "INSUFFICIENT_DATA"}
            continue
        n = len(predictions)
        brier = sum((p-y)**2 for p, y in predictions) / n
        actual_rate = sum(y for _, y in predictions) / n
        constant_brier = sum((.5-y)**2 for _, y in predictions) / n
        bins = []
        for low in (0, .2, .4, .6, .8):
            sample = [(p,y) for p,y in predictions if low <= p < low+.2]
            if sample:
                bins.append({"range": f"{low:.1f}-{low+.2:.1f}",
                             "count": len(sample),
                             "meanForecast": round(sum(p for p,_ in sample)/len(sample), 3),
                             "observedRate": round(sum(y for _,y in sample)/len(sample), 3)})
        report[market] = {
            "predictions": n,
            "uniquePlayers": len(by_player),
            "playersEvaluated": [{"name": name, "tests": count}
                                  for name, count in sorted(by_player.items())],
            "brier": round(brier, 4),
            "constant50Brier": round(constant_brier, 4),
            "overRate": round(actual_rate, 4),
            "beatsConstant50": brier < constant_brier,
            "status": "EXPLORATORY" if n >= 100 else "SMALL_SAMPLE",
            "bins": bins,
        }

    output = {"season": 2026, "source": source.get("source"),
              "method": "walk-forward; prior 5+ games; usage-qualified players; synthetic median-based lines",
              "warning": "NOT tested against historical sportsbook lines; NOT calibrated for betting or QUALIFIED picks",
              "markets": report}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print("Audit:", {k: (v["predictions"], v["uniquePlayers"], v["status"])
                     for k,v in report.items()})


if __name__ == "__main__":
    main()
