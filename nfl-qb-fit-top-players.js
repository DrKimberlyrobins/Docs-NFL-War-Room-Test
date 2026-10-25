/* QB context + top players: research only, verified aggregates. */
(()=>{"use strict";
const codes={"Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB","Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC","Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LA","Miami Dolphins":"MIA","Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG","New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF","Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS"};
let data=null;
const num=x=>Number.isFinite(Number(x))?Number(x):null;
const fmt=x=>num(x)===null?"—":Number(x).toFixed(1);
function qbFor(team){return [...(team?.quarterbacks||[])].sort((a,b)=>(b.attempts||0)-(a.attempts||0))[0]}
function context(team,player,type){
const qb=qbFor(team),games=num(team?.games);
if(!qb||!games)return {label:"QB data unavailable",detail:"Cannot assess compatibility without verified quarterback statistics."};
const attempts=(qb.attempts||0)/games;
const qbName=qb.name;
const volume=attempts>=35?"high passing volume":attempts>=27?"moderate passing volume":"lower passing volume";
let detail=qbName+" leads recorded pass attempts ("+fmt(attempts)+"/team game; "+volume+"). ";
if(type==="WR")detail+="Player targets: "+fmt(player.targetsPerGame)+" per team game. Target volume is relevant to receiving props, but QB-to-player targets and starter confirmation are not yet verified.";
else detail+="Player carries: "+fmt(player.carriesPerGame)+"/game. QB rushing share, designed runs, and scrambles are not available in this dataset; rushing compatibility cannot be rated.";
return {label:"QB context: "+volume+" (not a fit grade)",detail};
}
function line(parent,txt,tag="p"){const e=document.createElement(tag);e.textContent=txt;parent.appendChild(e);return e}
function card(parent,teamName,p,type,team){const wrap=document.createElement("div");wrap.style.cssText="background:#20374c;border:1px solid #36516b;border-radius:9px;padding:12px;margin:9px 0";line(wrap,p.name+" — "+type,"strong");line(wrap,type==="WR"?"Targets/game: "+fmt(p.targetsPerGame)+" | Receptions/game: "+fmt(p.receptionsPerGame)+" | Receiving yards/game: "+fmt(p.yardsPerGame):"Carries/game: "+fmt(p.carriesPerGame)+" | Rushing yards/game: "+fmt(p.rushingYardsPerGame));const c=context(team,p,type);line(wrap,c.label);const info=line(wrap,c.detail);info.style.cssText="font-size:12px;color:#cbd5e1";parent.appendChild(wrap)}
function render(){
const host=document.getElementById("docsTopPlayers");if(!host)return;
host.replaceChildren();line(host,"TOP PLAYERS — QB CONTEXT","h2");
if(!data){line(host,"Loading verified player statistics...");return;}
line(host,"Research shortlist by recorded opportunity, not prop qualification. QB listed by most team pass attempts, not confirmed starter. Data updated: "+(data.updated||"unknown")+".").style.cssText="font-size:12px;color:#cbd5e1";
for(const id of ["away","home"]){const name=document.getElementById(id)?.value;const team=data.teams?.[codes[name]];if(!team){line(host,name+": verified data unavailable");continue;}
line(host,name,"h3");
const qb=qbFor(team);line(host,qb?"QB passing context: "+qb.name+" — "+fmt(qb.attempts/team.games)+" attempts/team game. QB rush tendency not yet verified.":"QB context unavailable.");
const wr=[...(team.receivers||[])].sort((a,b)=>(b.targetsPerGame||0)-(a.targetsPerGame||0)).slice(0,2);
const rb=[...(team.rushers||[])].sort((a,b)=>(b.carriesPerGame||0)-(a.carriesPerGame||0)).slice(0,2);
wr.forEach(p=>card(host,name,p,"WR",team));rb.forEach(p=>card(host,name,p,"RB",team));
}
}
function popout(){const overlay=document.getElementById("playerIntelOverlay");if(!overlay||overlay.hidden||!data)return;
const subtitle=document.getElementById("playerIntelSubtitle")?.textContent||"";
const teamName=subtitle.split(" • ")[0].trim();const team=data.teams?.[codes[teamName]];if(!team)return;
const playerName=document.getElementById("playerIntelTitle")?.textContent?.trim();const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const items=[...(team.receivers||[]).map(p=>({p,type:"WR"})),...(team.rushers||[]).map(p=>({p,type:"RB"}))];
const match=items.find(x=>norm(x.p.name)===norm(playerName));if(!match)return;
let box=document.getElementById("docsQBPlayerFit");if(!box){box=document.createElement("section");box.id="docsQBPlayerFit";box.style.cssText="padding:12px;margin:12px 0;background:#20374c;border:1px solid #35df93;border-radius:8px";document.getElementById("playerIntelStats").insertAdjacentElement("beforebegin",box);}
box.replaceChildren();line(box,"QB–PLAYER COMPATIBILITY CONTEXT","h3");const c=context(team,match.p,match.type);line(box,c.label);line(box,c.detail);line(box,"Compatibility rating: INSUFFICIENT DATA until QB-to-player opportunities and QB rushing split are verified.").style.fontSize="12px";
}
const obs=new MutationObserver(()=>{if(document.getElementById("playerIntelOverlay")?.hidden){document.getElementById("docsQBPlayerFit")?.remove();return;}popout()});
function init(){const anchor=document.querySelector(".panel h2");const panel=document.createElement("section");panel.className="panel";panel.id="docsTopPlayers";const scoring=[...document.querySelectorAll(".panel h2")].find(x=>x.textContent.includes("Scoring Prediction Engine"));if(scoring)scoring.closest(".panel").insertAdjacentElement("beforebegin",panel);else anchor?.closest(".panel")?.insertAdjacentElement("afterend",panel);
obs.observe(document.getElementById("playerIntelOverlay"),{attributes:true,attributeFilter:["hidden"]});
const old=window.analyze;window.analyze=function(...args){if(typeof old==="function")old.apply(this,args);render()};
fetch("data/players-2026.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json()}).then(d=>{data=d;render()}).catch(e=>{panel.textContent="Top players unavailable: "+e.message});
render();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();