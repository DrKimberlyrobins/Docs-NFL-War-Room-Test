/* Doc's NFL War Room — Evidence-based player O/U calculator.
 * Reads verified weekly stats and optionally existing Kambi snapshot.
 * Forecast is an explicitly labeled small-sample statistical estimate,
 * not a validated betting edge. Never auto-qualifies or saves.
 */
(() => {
"use strict";
const MARKETS=[["Passing yards","passingYards"],["Pass completions","completions"],["Pass attempts","attempts"],["Rushing yards","rushingYards"],["Rush attempts","carries"],["Receiving yards","receivingYards"],["Receptions","receptions"],["Targets","targets"]];
const CODES={"Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB","Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC","Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA","Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG","New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF","Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS"};
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const val=x=>x==null||String(x).trim()===""?null:Number.isFinite(Number(x))?Number(x):null;
const pct=n=>(100*n).toFixed(1)+"%";
const be=o=>o>0?100/(100+o):(-o)/(100-o);
const erf=x=>{const s=Math.sign(x),a=Math.abs(x),t=1/(1+.3275911*a);return s*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a))};
const cdf=x=>.5*(1+erf(x/Math.SQRT2));
const styles=document.createElement("style");styles.textContent=".doc-ou{margin-top:16px;padding:15px;border:1px solid #36516b;border-radius:10px;background:#10243a}.doc-ou h3{color:#35df93;margin:0 0 8px}.doc-ou-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px}.doc-ou input,.doc-ou select{width:100%;padding:9px;margin:5px 0 10px;background:#edf3fa;color:#111;border:0;border-radius:6px}.doc-ou label{font-size:13px}.doc-ou .result{white-space:pre-wrap;line-height:1.65}.doc-ou .warning{color:#ffd184}";document.head.append(styles);
let logs=null,quotes=null,loadError="",active="";
const getTeam=s=>CODES[s]||s;
function playerMatch(name,team){
 if(!Array.isArray(logs?.players))return null;
 const matches=logs.players.filter(p=>getTeam(team)===p.team);
 const exact=matches.find(p=>norm(p.name)===norm(name)||norm(p.shortName)===norm(name));
 if(exact)return exact;
 const surname=String(name).trim().split(/[.\\s]+/).pop();
 const candidates=matches.filter(p=>norm(p.name).endsWith(norm(surname))||norm(p.shortName).endsWith(norm(surname)));
 return candidates.length===1?candidates[0]:null;
}
function marketGuess(raw){
 const s=norm(raw);
 if(/pass.*yard/.test(s))return "passingYards";
 if(/pass.*completion/.test(s))return "completions";
 if(/pass.*attempt/.test(s))return "attempts";
 if(/rush.*yard/.test(s))return "rushingYards";
 if(/rush.*attempt|carr/.test(s))return "carries";
 if(/receiv.*yard/.test(s))return "receivingYards";
 if(/reception/.test(s))return "receptions";
 if(/target/.test(s))return "targets";
 return null;
}
function availableQuotes(player){
 if(!Array.isArray(quotes?.props))return [];
 const playerNames=[player.name,player.shortName].filter(Boolean);
 const exact=p=>playerNames.some(n=>norm(n)===norm(p));
 const parsed=[];
 for(const q of quotes.props){
  const name=q.player??q.playerName??q.participant??q.participantName??"";
  if(!exact(name))continue;
  const status=String(q.status??q.outcomeStatus??"OPEN").toUpperCase();
  if(status!=="OPEN"&&status!=="ACTIVE")continue;
  const descriptor=[q.category,q.categoryName,q.market,q.marketName,q.marketLabel,q.displayMarket,q.outcome,q.outcomeLabel,q.label].filter(Boolean).join(" ");
  if(/first half|1st half/i.test(descriptor))continue;
  const market=marketGuess(descriptor);
  if(!market)continue;
  let line=val(q.line??q.threshold);
  if(line===null){
   const text=[q.milestone,q.outcomeLabel,q.displayMarket,q.marketLabel].filter(Boolean).join(" ");
   const m=text.match(/(\\d+(?:\\.\\d+)?)\\s*\\+/);
   if(m)line=Number(m[1])-.5;
  }
  const odds=val(q.oddsAmerican??q.americanOdds??q.priceAmerican??q.price);
  const outcomeText=String(q.outcome??q.outcomeLabel??q.label??"").toLowerCase();
  const side=/\\bover\\b|\\d+\\s*\\+/.test(outcomeText)?"OVER":/\\bunder\\b/.test(outcomeText)?"UNDER":null;
  if(line===null||!Number.isInteger(odds)||Math.abs(odds)<100||!side)continue;
  parsed.push({market,line,odds,side,source:q});
 }
 return parsed;
}
function estimate(values,threshold,side){
 // Normal approximation, with conservative variance floor to avoid false certainty.
 if(values.length<5)return null;
 const n=values.length,mean=values.reduce((a,b)=>a+b,0)/n;
 const variance=values.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,n-1);
 const sd=Math.max(Math.sqrt(variance),Math.sqrt(Math.max(1,mean))*.7,1);
 // Future-game predictive distribution: sample variation + parameter uncertainty.
 const predictiveSd=sd*Math.sqrt(1+1/n);
 const continuity=.5;
 const p=side==="OVER"?1-cdf((threshold+continuity-mean)/predictiveSd):cdf((threshold-continuity-mean)/predictiveSd);
 return {mean,sd,p:Math.min(.99,Math.max(.01,p)),n};
}
function render(root,name,team){
 root.replaceChildren();
 const h=document.createElement("h3");h.textContent="Player OVER / UNDER Intelligence";root.append(h);
 const player=playerMatch(name,team);
 if(!player){const p=document.createElement("p");p.className="warning";p.textContent="No matched verified weekly game logs — PASS. "+loadError;root.append(p);return;}
 const grid=document.createElement("div");grid.className="doc-ou-grid";root.append(grid);
 function field(label,type,options){
  const wrapper=document.createElement("label");wrapper.textContent=label;
  const el=document.createElement(type);if(options)for(const [n,v] of options)el.add(new Option(n,v));
  wrapper.append(el);grid.append(wrapper);return el;
 }
 const market=field("Market","select",MARKETS);
 const line=field("Line (verified sportsbook)","input");line.type="number";line.step=".5";line.placeholder="Enter line";
 const odds=field("American odds (verified)","input");odds.type="number";odds.step="1";odds.placeholder="-110";
 const side=field("Side","select",[["OVER","OVER"],["UNDER","UNDER"]]);
 const quotesFound=availableQuotes(player);
 const note=document.createElement("p");note.className="note";note.textContent=quotesFound.length?"Kambi snapshot contains "+quotesFound.length+" possible player-market records; confirm prices and market side before use.":"No usable auto-matched Kambi prices. Enter a verified sportsbook line and odds.";root.append(note);
 const output=document.createElement("div");output.className="result";root.append(output);
 const quoteBtn=document.createElement("button");quoteBtn.type="button";quoteBtn.textContent="Use matching Kambi snapshot (if available)";quoteBtn.style.marginTop="5px";root.append(quoteBtn);
 quoteBtn.addEventListener("click",()=>{const q=quotesFound.find(x=>x.market===market.value&&x.side===side.value);if(!q){note.textContent="No matching market with American odds in the saved Kambi snapshot.";return;}line.value=q.line;odds.value=q.odds;note.textContent="Kambi saved snapshot loaded; verify freshness before using. Market: "+q.market+" "+q.side+" "+q.line+" at "+q.odds;recalc();});
 function recalc(){
  const threshold=val(line.value),price=val(odds.value),key=market.value;
  const games=(player.games||[]).filter(g=>Number.isInteger(g.week)&&val(g[key])!==null).sort((a,b)=>b.week-a.week);
  const values=games.map(g=>val(g[key]));
  const sample=n=>{const v=values.slice(0,n);if(threshold===null)return "enter line";if(!v.length)return "no games";const over=v.filter(x=>x>threshold).length,under=v.filter(x=>x<threshold).length,push=v.length-over-under;return "OVER "+over+"/"+v.length+" ("+pct(over/v.length)+"), UNDER "+under+"/"+v.length+" ("+pct(under/v.length)+"), pushes "+push;};
  const validPrice=price!==null&&Number.isInteger(price)&&Math.abs(price)>=100;
  const forecast=threshold!==null?estimate(values.slice(0,10),threshold,side.value):null;
  const breakEven=validPrice?be(price):null;
  const edge=forecast&&breakEven!==null?forecast.p-breakEven:null;
  output.textContent="Season player appearances with "+key+": "+games.length+"\nLast 5: "+sample(5)+"\nLast 10: "+sample(10)+"\nGame-by-game (newest first): "+(games.slice(0,10).map(g=>"W"+g.week+" "+g[key]).join(" | ")||"none")+"\nRecent average (last "+Math.min(10,values.length)+"): "+(values.length?(values.slice(0,10).reduce((a,b)=>a+b,0)/Math.min(10,values.length)).toFixed(2):"unavailable")+"\nSportsbook break-even: "+(breakEven!==null?pct(breakEven):"enter verified odds")+"\nExploratory model "+side.value+" estimate: "+(forecast?pct(forecast.p):"at least 5 verified player games needed")+"\nExploratory model minus break-even: "+(edge!==null?(100*edge).toFixed(1)+" percentage points":"unavailable")+"\nOpponent defensive adjustment: not established\nModel validation: NOT BACKTESTED\nGRADE: REVIEW ONLY — no automatic QUALIFIED designation or Sheets save.";
 }
 [market,line,odds,side].forEach(el=>el.addEventListener("input",recalc));recalc();
}
function ensure(){
 const overlay=document.getElementById("playerIntelOverlay"),stats=document.getElementById("playerIntelStats");
 if(!overlay||overlay.hidden||!stats)return;
 let root=document.getElementById("docOverUnderIntel");if(!root){root=document.createElement("section");root.id="docOverUnderIntel";root.className="doc-ou";stats.insertAdjacentElement("afterend",root);}
 const name=document.getElementById("playerIntelTitle")?.textContent?.trim(),team=document.getElementById("playerIntelSubtitle")?.textContent?.split(" • ")[0]?.trim();
 if(!name)return;
 const key=name+"|"+team;if(key!==active){active=key;render(root,name,team);}
}
const overlay=document.getElementById("playerIntelOverlay");if(overlay)new MutationObserver(ensure).observe(overlay,{attributes:true,attributeFilter:["hidden"]});
document.addEventListener("click",e=>{if(e.target.closest?.(".player-intel-link"))queueMicrotask(ensure)});
Promise.allSettled([fetch("data/player-game-logs-2026.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json()}),fetch("data/kambi-player-props-2026.json",{cache:"no-store"}).then(r=>r.json())]).then(([a,b])=>{
 if(a.status==="fulfilled"&&Array.isArray(a.value.players))logs=a.value;else loadError="Weekly logs have not been generated successfully.";
 if(b.status==="fulfilled"&&Array.isArray(b.value?.props))quotes=b.value;
 active="";ensure();
});
})();
