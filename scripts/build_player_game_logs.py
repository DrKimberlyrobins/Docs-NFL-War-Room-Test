#!/usr/bin/env python3
"""Build verified 2026 NFL weekly player game logs from nflverse player_stats release.
Run: python scripts/build_player_game_logs.py
Requires no third-party Python packages. Exits nonzero if the season is missing.
"""
import csv, io, json, os, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SEASON=2026
URL="https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv"
FIELDS={"passingYards":"passing_yards","completions":"completions","attempts":"attempts","rushingYards":"rushing_yards","carries":"carries","receivingYards":"receiving_yards","receptions":"receptions","targets":"targets"}
def num(s):
    try:
        n=float(s)
        return int(n) if n.is_integer() else n
    except (ValueError,TypeError): return None
def build():
    request=urllib.request.Request(URL,headers={"User-Agent":"Docs-NFL-War-Room/1.0"})
    with urllib.request.urlopen(request,timeout=90) as response:
        reader=csv.DictReader(io.TextIOWrapper(response,encoding="utf-8-sig"))
        required={"season","week","season_type","player_id","player_name","recent_team"}|set(FIELDS.values())
        missing=required-set(reader.fieldnames or [])
        if missing: raise RuntimeError("Source schema missing columns: "+", ".join(sorted(missing)))
        players={}
        for r in reader:
            if r["season"]!=str(SEASON) or r["season_type"]!="REG": continue
            pid=r["player_id"].strip()
            team=r["recent_team"].strip()
            week=num(r["week"])
            if not pid or not team or not isinstance(week,int): continue
            name=(r.get("player_display_name") or r["player_name"]).strip()
            key=(pid,team)
            p=players.setdefault(key,{"id":pid,"name":name,"shortName":r["player_name"].strip(),"team":team,"games":[]})
            game={"date":f"{SEASON}-W{week:02d}","week":week}
            for target,source in FIELDS.items():
                value=num(r.get(source))
                if value is not None: game[target]=value
            p["games"].append(game)
        if not players: raise RuntimeError("No 2026 regular-season player logs in source; refusing to write empty output")
        for p in players.values(): p["games"].sort(key=lambda g:g["week"],reverse=True)
        out={"season":SEASON,"source":URL,"updated":datetime.now(timezone.utc).isoformat(),"players":list(players.values())}
        path=Path("data/player-game-logs-2026.json")
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(out,separators=(",",":")),encoding="utf-8")
        print("Wrote",len(players),"player/team records;",sum(len(p["games"]) for p in players.values()),"weekly records")
if __name__=="__main__":build()
