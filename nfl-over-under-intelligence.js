/* Doc's NFL War Room — Player O/U Intelligence (test branch)
   No invented game logs, prices, or predictive probabilities.
   Game logs must be supplied as data/player-game-logs-2026.json:
   {"players":[{"id":"...","name":"...","team":"SF","games":[{"date":"2026-10-01","passingYards":200,"receptions":4}]}]}
*/
(() => {
"use strict";
const MARKETS=[
["Passing yards","passingYards"],["Pass completions","completions"],
["Pass attempts","attempts"],["Rushing yards","rushingYards"],
["Rush attempts","carries"],["Receiving yards","receivingYards"],
["Receptions","receptions"],["Targets","targets"]
];
const style=document.createElement("style");
style.textContent=".doc-ou{margin-top:18px;padding:15px;border:1px solid #36516b;border-radius:10px;background:#10243a}.doc-ou h3{color:#35df93;margin-top:0}.doc-ou-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:9px}.doc-ou input,.doc-ou select{width:100%;padding:9px;margin:5px 0 10px;background:#edf3fa;color:#111;border:0;border-radius:6px}.doc-ou label{font-size:13px}.doc-ou .result{white-space:pre-wrap;line-height:1.6}.doc-ou .warning{color:#ffd184}";
document.head.append(style);
let dataset=null,error=null,active=null;
const number=v=>v===""||v===null||v===undefined?null:Number.isFinite(Number(v))?Number(v):null;
const pct=x=>(x*100).toFixed(1)+"%";
function breakEven(odds){return odds>0?100/(odds+100):(-odds)/((-odds)+100)}
function lookup(name,team){
 if(!dataset?.players)return null;
 const normalized=s=>String(s||"").toLowerCase().replace(/[^a-z]/g,"");
 return dataset.players.find(p=>(normalized(p.name)===normalized(name)||normalized(p.shortName)===normalized(name)||normalized(p.name).endsWith(normalized(name)))&&(!team||normalized(p.team)===normalized(team)|| (typeof playerTeamCodes!=="undefined"&&normalized(p.team)===normalized(playerTeamCodes[team]))))||null;
}
function draw(root,name,team){
 root.replaceChildren();
 const heading=document.createElement("h3");heading.textContent="OVER / UNDER Intelligence — historical evidence";root.append(heading);
 const note=document.createElement("p");note.className="note";note.textContent="Game logs are separate from season totals. No predictive probability or QUALIFIED grade is issued without a validated forecasting model.";root.append(note);
 const player=lookup(name,team);
 if(!player){const p=document.createElement("p");p.className="warning";p.textContent=error?"Game logs unavailable: "+error:"No verified per-game logs matched this player. Historical hit rates unavailable — PASS.";root.append(p);return;}
 const fields=document.createElement("div");fields.className="doc-ou-grid";
 const make=(label,type,options)=>{
  const wrap=document.createElement("label");wrap.textContent=label;
  const el=document.createElement(type);if(options)options.forEach(([title,value])=>el.add(new Option(title,value)));
  wrap.append(el);fields.append(wrap);return el;
 };
 const market=make("Market","select",MARKETS);
 const line=make("Sportsbook line (enter verified number)","input");line.type="number";line.step=".5";line.placeholder="e.g. 4.5";
 const odds=make("American odds (enter verified price)","input");odds.type="number";odds.step="1";odds.placeholder="e.g. -110";
 const side=make("Side","select",[["OVER","OVER"],["UNDER","UNDER"]]);
 root.append(fields);
 const output=document.createElement("p");output.className="result";root.append(output);
 function recalc(){
  const threshold=number(line.value),price=number(odds.value),key=market.value;
  const games=Array.isArray(player.games)?player.games.filter(g=>g&&/^\d{4}-(W\d{2}|\d\d-\d\d)$/.test(g.date)).sort((a,b)=>b.date.localeCompare(a.date)):[];
  const available=games.filter(g=>number(g[key])!==null);
  const last=available.slice(0,10);
  const sample=n=>{const rows=last.slice(0,n);if(threshold===null)return "enter line";if(!rows.length)return "no games";const over=rows.filter(g=>number(g[key])>threshold).length,under=rows.filter(g=>number(g[key])<threshold).length,push=rows.length-over-under;return over+"/"+rows.length+" OVER ("+pct(over/rows.length)+"), "+under+"/"+rows.length+" UNDER ("+pct(under/rows.length)+"), "+push+" push";};
  const validPrice=price!==null&&Number.isInteger(price)&&Math.abs(price)>=100&&price!==0;
  const gamesText=last.map(g=>g.date+": "+g[key]).join(" | ");
  output.textContent="Recorded games for market: "+available.length+"\nLast 5: "+sample(5)+"\nLast 10: "+sample(10)+"\nRecent results: "+(gamesText||"none")+"\nBreak-even: "+(validPrice?pct(breakEven(price)):"enter valid odds")+"\nModel probability: unavailable (not calibrated)\nOpponent adjustment: unavailable (not verified)\nDecision: PASS / REVIEW — no qualified edge established.";
 }
 [market,line,odds,side].forEach(el=>el.addEventListener("input",recalc));recalc();
}
function ensure(){
 const dialog=document.getElementById("playerIntelDialog"),stats=document.getElementById("playerIntelStats"),overlay=document.getElementById("playerIntelOverlay");
 if(!dialog||!stats||!overlay)return;
 let root=document.getElementById("docOverUnderIntel");
 if(!root){root=document.createElement("section");root.id="docOverUnderIntel";root.className="doc-ou";stats.insertAdjacentElement("afterend",root);}
 if(overlay.hidden)return;
 const name=document.getElementById("playerIntelTitle")?.textContent?.trim();
 const subtitle=document.getElementById("playerIntelSubtitle")?.textContent||"";
 const team=subtitle.split(" • ")[0].trim();
 const key=name+"|"+team;
 if(name&&key!==active){active=key;draw(root,name,team);}
}
const observer=new MutationObserver(ensure);
const overlay=document.getElementById("playerIntelOverlay");
if(overlay)observer.observe(overlay,{attributes:true,attributeFilter:["hidden"]});
document.addEventListener("click",e=>{if(e.target.closest?.(".player-intel-link"))queueMicrotask(ensure)});
fetch("data/player-game-logs-2026.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json()}).then(d=>{if(!Array.isArray(d.players))throw Error("Invalid players array");dataset=d;active=null;ensure()}).catch(e=>{error=e.message;active=null;ensure()});
})();
