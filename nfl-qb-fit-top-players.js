/* QB context + top players: research only, verified aggregates. */
(()=>{"use strict";
const codes={"Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB","Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC","Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LA","Miami Dolphins":"MIA","Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG","New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF","Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS"};
let data=null, rushingLogs=null;
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function qbRush(teamCode,qb){if(!rushingLogs||!qb)return null;const passGames=new Set(rushingLogs.filter(x=>x.team===teamCode&&x.category==='passing'&&normalize(x.player)===normalize(qb.name)).map(x=>x.gameId));const rush=rushingLogs.filter(x=>x.team===teamCode&&x.category==='rushing'&&normalize(x.player)===normalize(qb.name));const games=passGames.size||new Set(rush.map(x=>x.gameId)).size;if(!games)return null;const yards=rush.reduce((a,x)=>a+(Number(x.yards)||0),0),attempts=rush.reduce((a,x)=>a+(Number(x.opportunities)||0),0);return {games,attempts,yards,attemptsPerGame:attempts/games,yardsPerGame:yards/games};}
function rushDescription(teamCode,qb){const r=qbRush(teamCode,qb);return r?'QB rush: '+fmt(r.attemptsPerGame)+' attempts/game, '+fmt(r.yardsPerGame)+' yards/game ('+r.games+' observed QB passing games; includes scrambles and kneels where recorded).':'QB rush: no verified QB game-log match';}
const num=x=>Number.isFinite(Number(x))?Number(x):null;
const fmt=x=>num(x)===null?"—":Number(x).toFixed(1);
function qbFor(team){return [...(team?.quarterbacks||[])].sort((a,b)=>(b.attempts||0)-(a.attempts||0))[0]}
function context(team,player,type){
const qb=qbFor(team),games=num(team?.games);
if(!qb||!games)return {label:"QB data unavailable",detail:"Cannot assess compatibility without verified quarterback statistics."};
const attempts=(qb.attempts||0)/games;
const qbName=qb.name;
const rush=rushDescription(Object.keys(data?.teams||{}).find(k=>data.teams[k]===team),qb);
const volume=attempts>=35?"high passing volume":attempts>=27?"moderate passing volume":"lower passing volume";
let detail=qbName+" leads recorded pass attempts ("+fmt(attempts)+"/team game; "+volume+"). "+rush+". ";
if(type==="WR")detail+="Player targets: "+fmt(player.targetsPerGame)+" per team game. Target volume is relevant to receiving props, but QB-to-player targets and starter confirmation are not yet verified.";
else detail+="Player carries: "+fmt(player.carriesPerGame)+"/game. QB rush attempts and yards are shown above; designed runs versus scrambles are not separated, so rushing compatibility cannot yet be rated.";
return {label:"QB context: "+volume+" (not a fit grade)",detail};
}
function line(parent,txt,tag="p"){const e=document.createElement(tag);e.textContent=txt;parent.appendChild(e);return e}
function card(parent,teamName,p,type,team){const wrap=document.createElement("div");wrap.style.cssText="background:#20374c;border:1px solid #36516b;border-radius:9px;padding:12px;margin:9px 0";line(wrap,p.name+" — "+type,"strong");line(wrap,type==="WR"?"Targets/game: "+fmt(p.targetsPerGame)+" | Receptions/game: "+fmt(p.receptionsPerGame)+" | Receiving yards/game: "+fmt(p.yardsPerGame):"Carries/game: "+fmt(p.carriesPerGame)+" | Rushing yards/game: "+fmt(p.rushingYardsPerGame));const c=context(team,p,type);
const qb=qbFor(team), passVolume=qb&&team.games?Number(qb.attempts)/Number(team.games):0;
const highPass=type==="WR"&&passVolume>=35&&Number(p.targetsPerGame)>=7;
if(highPass){wrap.style.border="2px solid #35df93";wrap.style.boxShadow="0 0 0 1px rgba(53,223,147,.25)";const badge=line(wrap,"🟢 HIGH PASSING-VOLUME OPPORTUNITY — QB "+fmt(passVolume)+" attempts/team game; WR "+fmt(p.targetsPerGame)+" targets/game","strong");badge.style.cssText="display:block;color:#7cf5ba;margin:8px 0";}else if(type==="WR"&&passVolume>=35){const badge=line(wrap,"PASS-HEAVY QB — receiver target volume below highlight threshold","small");badge.style.cssText="display:block;color:#cbd5e1;margin:6px 0";}
if(type==="RB"){
const teamCode=codes[teamName],qr=qbRush(teamCode,qb);
const carries=Number(p.carriesPerGame);
if(qr&&Number.isFinite(carries)&&carries>=15&&qr.attemptsPerGame<=4){
wrap.style.border="2px solid #60a5fa";wrap.style.boxShadow="0 0 0 1px rgba(96,165,250,.25)";
const badge=line(wrap,"🔵 RB RUSHING OPPORTUNITY — "+fmt(carries)+" carries/game; QB "+fmt(qr.attemptsPerGame)+" rush attempts/game","strong");
badge.style.cssText="display:block;color:#93c5fd;margin:8px 0";
}else{
const note=line(wrap,qr?"RB rushing highlight not met — RB "+fmt(carries)+" carries/game; QB "+fmt(qr.attemptsPerGame)+" rush attempts/game.":"RB rushing highlight pending — QB rushing log unavailable.","small");
note.style.cssText="display:block;color:#cbd5e1;margin:6px 0";
}
}
line(wrap,c.label);const info=line(wrap,c.detail);info.style.cssText="font-size:12px;color:#cbd5e1";parent.appendChild(wrap)}
function render(){
const host=document.getElementById("docsTopPlayers");if(!host)return;
host.replaceChildren();line(host,"TOP PLAYERS — QB CONTEXT","h2");
if(!data){line(host,"Loading verified player statistics...");return;}
line(host,"Research shortlist by recorded opportunity, not prop qualification. Green highlights receivers with QB passing volume ≥35 attempts/team game AND receiver targets ≥7/team game. Blue highlights rushers with ≥15 carries/game when the QB averages ≤4 rush attempts/game. Both are opportunity screens, not verified QB–RB chemistry or qualified bets. QB listed by most team pass attempts, not confirmed starter. Data updated: "+(data.updated||"unknown")+".").style.cssText="font-size:12px;color:#cbd5e1";
for(const id of ["away","home"]){const name=document.getElementById(id)?.value;const team=data.teams?.[codes[name]];if(!team){line(host,name+": verified data unavailable");continue;}
line(host,name,"h3");
const qb=qbFor(team);line(host,qb?"QB passing context: "+qb.name+" — "+fmt(qb.attempts/team.games)+" attempts/team game. "+rushDescription(codes[name],qb)+". ":"QB context unavailable.");
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
fetch("data/player-gamelogs-2026.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json()}).then(d=>{rushingLogs=d.logs;render()}).catch(()=>{rushingLogs=null;render()});
fetch("data/players-2026.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json()}).then(d=>{data=d;render()}).catch(e=>{panel.textContent="Top players unavailable: "+e.message});
render();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();