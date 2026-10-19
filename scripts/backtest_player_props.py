#!/usr/bin/env python3
"""Walk-forward reliability audit of a simple NFL prop baseline.
Uses prior weeks only. This is a diagnostic, not a sportsbook edge model.
"""
import json,math
from pathlib import Path
DATA=Path("data/player-game-logs-2026.json")
OUT=Path("data/player-model-audit-2026.json")
FIELDS=("passingYards","completions","attempts","rushingYards","carries","receivingYards","receptions","targets")
def cdf(x):return .5*(1+math.erf(x/math.sqrt(2)))
def predict(a,line):
 n=len(a);avg=sum(a)/n;sd=math.sqrt(sum((x-avg)**2 for x in a)/(n-1))
 sd=max(sd,math.sqrt(max(1,avg))*.7,1)*math.sqrt(1+1/n)
 return min(.99,max(.01,1-cdf((line+.5-avg)/sd)))
def main():
 source=json.loads(DATA.read_text())
 results={}
 for market in FIELDS:
  predictions=[]
  for player in source["players"]:
   games=sorted(player["games"],key=lambda x:x["week"])
   for i in range(5,len(games)):
    train=[float(g[market]) for g in games[:i] if g.get(market) is not None]
    actual=games[i].get(market)
    if len(train)<5 or actual is None:continue
    # Median of prior games is a retrospective test threshold,
    # NOT an observed sportsbook line.
    line=sorted(train)[len(train)//2]+.5
    p=predict(train[-10:],line)
    outcome=int(float(actual)>line)
    predictions.append((p,outcome))
  if predictions:
   brier=sum((p-y)**2 for p,y in predictions)/len(predictions)
   bins=[]
   for low in (0,.2,.4,.6,.8):
    sample=[(p,y) for p,y in predictions if low<=p<low+.2]
    if sample:bins.append({"range":f"{low:.1f}-{low+.2:.1f}","count":len(sample),"meanForecast":round(sum(p for p,_ in sample)/len(sample),3),"observedRate":round(sum(y for _,y in sample)/len(sample),3)})
   results[market]={"predictions":len(predictions),"brier":round(brier,4),"bins":bins}
 OUT.write_text(json.dumps({"season":2026,"note":"Walk-forward synthetic median thresholds; NOT sportsbook-line calibration or proof of profitable edge","markets":results},indent=2))
 print("Backtest markets:",len(results),"evaluations:",sum(v["predictions"] for v in results.values()))
if __name__=="__main__":main()
