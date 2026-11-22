"use strict";

(() => {
  "use strict";

  let publishedV2;
  let modelError = false;
  let renderVersion = 0;

  const names = {
    ARI: "Arizona Cardinals",
    ATL: "Atlanta Falcons",
    BAL: "Baltimore Ravens",
    BUF: "Buffalo Bills",
    CAR: "Carolina Panthers",
    CHI: "Chicago Bears",
    CIN: "Cincinnati Bengals",
    CLE: "Cleveland Browns",
    DAL: "Dallas Cowboys",
    DEN: "Denver Broncos",
    DET: "Detroit Lions",
    GB: "Green Bay Packers",
    HOU: "Houston Texans",
    IND: "Indianapolis Colts",
    JAC: "Jacksonville Jaguars",
    KC: "Kansas City Chiefs",
    LV: "Las Vegas Raiders",
    LAC: "Los Angeles Chargers",
    LAR: "Los Angeles Rams",
    MIA: "Miami Dolphins",
    MIN: "Minnesota Vikings",
    NE: "New England Patriots",
    NO: "New Orleans Saints",
    NYG: "New York Giants",
    NYJ: "New York Jets",
    PHI: "Philadelphia Eagles",
    PIT: "Pittsburgh Steelers",
    SF: "San Francisco 49ers",
    SEA: "Seattle Seahawks",
    TB: "Tampa Bay Buccaneers",
    TEN: "Tennessee Titans",
    WAS: "Washington Commanders"
  };

  const aliases = {
    LA: "LAR",
    STL: "LAR",
    SD: "LAC",
    OAK: "LV",
    WSH: "WAS",
    JAX: "JAC",
    ARZ: "ARI"
  };

  function teamCode(raw) {
    const value = String(raw || "").trim().toLowerCase();
    const normalized = value.replace(/[^a-z0-9]/g, "");

    for (const [code, name] of Object.entries(names)) {
      if (normalized === code.toLowerCase() ||
          normalized === name.toLowerCase().replace(/[^a-z0-9]/g, "")) {
        return code;
      }
    }

    for (const [alias, code] of Object.entries(aliases)) {
      if (normalized === alias.toLowerCase()) return code;
    }

    const matches = {
      cardinals: "ARI", falcons: "ATL", ravens: "BAL",
      bills: "BUF", panthers: "CAR", bears: "CHI",
      bengals: "CIN", browns: "CLE", cowboys: "DAL",
      broncos: "DEN", lions: "DET", packers: "GB",
      texans: "HOU", colts: "IND", jaguars: "JAC",
      chiefs: "KC", raiders: "LV", chargers: "LAC",
      rams: "LAR", dolphins: "MIA", vikings: "MIN",
      patriots: "NE", saints: "NO", giants: "NYG",
      jets: "NYJ", eagles: "PHI", steelers: "PIT",
      "49ers": "SF", seahawks: "SEA", buccaneers: "TB",
      titans: "TEN", commanders: "WAS"
    };

    for (const [word, code] of Object.entries(matches)) {
      if (normalized.includes(word)) return code;
    }

    return null;
  }

  function selectedCode(select) {
    if (!select) return null;
    const option = select.selectedOptions?.[0];

    return (
      teamCode(select.value) ||
      teamCode(option?.textContent)
    );
  }

  function element(tag, text, style = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    Object.assign(node.style, style);
    return node;
  }

  function metric(label, rows, color) {
    const block = element("div", undefined, {
      flex: "1 1 220px",
      padding: "15px",
      background: "#20384f",
      borderRadius: "10px",
      minWidth: "0"
    });
    block.appendChild(element("h4", label, { margin: "0 0 8px", color }));
    for (const row of rows) block.appendChild(element("div", row, { marginBottom: "4px" }));
    return block;
  }

  const centralDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const formatTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "long", timeZone: "America/Chicago"
  });

  function competitor(event, side) {
    return event.competitions[0].competitors.find(team => team.homeAway === side)?.team;
  }

  function gameKey(event) {
    const schedule = window.docsNflSchedule;
    const season = event.season?.year ?? schedule.season?.year;
    const week = event.week?.number ?? schedule.week;
    const away = teamCode(competitor(event, "away")?.abbreviation);
    const home = teamCode(competitor(event, "home")?.abbreviation);
    const nflverseCode = code => code === "JAC" ? "JAX" : code;
    return { season, week, away, home, id: [season, String(week).padStart(2, "0"),
      nflverseCode(away), nflverseCode(home)].join("_") };
  }

  function savedPrediction(event, key) {
    if (publishedV2?.season !== key.season) return;
    const kickoff = Date.parse(event.date);
    return publishedV2.games.find(game => {
      const generated = Date.parse(game.snapshot_generated_utc);
      return game.game_id === key.id && game.week === key.week &&
        teamCode(game.away) === key.away && teamCode(game.home) === key.home &&
        game.date === centralDate.format(kickoff) &&
        generated < kickoff && generated <= Date.now() &&
        game.feature_cutoff_date <= centralDate.format(generated) &&
        [game.away_win_probability, game.home_win_probability].every(
          value => Number.isFinite(value) && value >= 0 && value <= 100
        ) && Math.abs(game.away_win_probability + game.home_win_probability - 100) < 0.1;
    });
  }

  function parseMoneyline(raw) {
    const text = String(raw ?? "").trim();
    if (/^(EVEN|EVS)$/i.test(text)) return 100;
    const price = /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
    return Number.isSafeInteger(price) && Math.abs(price) >= 100 ? price : null;
  }

  function implied(price) {
    return price > 0 ? 100 / (price + 100) : -price / (100 - price);
  }

  const percent = value => value.toFixed(2) + "%";
  const signed = price => price > 0 ? "+" + price : String(price);

  async function oddsRows(event, key) {
    const response = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" +
      encodeURIComponent(event.id), { cache: "no-store" }
    );
    if (!response.ok) throw new Error("ESPN odds request returned HTTP " + response.status);
    const payload = await response.json();
    const observed = Date.now();
    const header = payload.header;
    const sides = header?.competitions?.find(game => String(game.id) === String(event.id))?.competitors;
    if (String(header?.id) !== String(event.id) || header.season?.year !== key.season ||
        header.week !== key.week || !sides || ["away", "home"].some(side =>
          sides.find(team => team.homeAway === side)?.team?.id !== competitor(event, side)?.id)) {
      return ["Odds feed matchup, season, week, or team mapping did not match the schedule."];
    }

    const offers = (payload.pickcenter ?? []).filter(offer => offer.provider?.name);
    if (!offers.length) return ["ESPN returned no sportsbook odds for this game."];

    const missing = [];
    for (const offer of offers) {
      const provider = offer.provider.name;
      const awayOdds = offer.awayTeamOdds;
      const homeOdds = offer.homeTeamOdds;
      if ((awayOdds?.teamId && awayOdds.teamId !== competitor(event, "away").id) ||
          (homeOdds?.teamId && homeOdds.teamId !== competitor(event, "home").id)) {
        missing.push(provider + " odds team IDs did not match the schedule.");
        continue;
      }
      const away = parseMoneyline(offer.moneyline?.away?.close?.odds);
      const home = parseMoneyline(offer.moneyline?.home?.close?.odds);
      if (away === null || home === null) {
        const teams = [away === null && names[key.away], home === null && names[key.home]].filter(Boolean);
        missing.push(provider + " is missing a valid moneyline for " + teams.join(" and ") + ".");
        continue;
      }

      const awayImplied = implied(away);
      const homeImplied = implied(home);
      const total = awayImplied + homeImplied;
      const past = event.status?.type?.state !== "pre" || observed >= Date.parse(event.date);
      return [
        names[key.away] + " " + percent(100 * awayImplied / total) + " (" + signed(away) + ")",
        names[key.home] + " " + percent(100 * homeImplied / total) + " (" + signed(home) + ")",
        "Raw implied " + percent(100 * awayImplied) + " / " + percent(100 * homeImplied) +
          " • Sum " + percent(100 * total),
        provider + " via ESPN • " + (past ? "Closing prices" : "Pregame prices"),
        "Odds captured " + formatTime.format(observed) + " • Book update time unavailable"
      ];
    }
    return missing;
  }

  function render() {
    const version = ++renderVersion;
    const output = document.getElementById("docProbabilityOutput");
    if (!output) return;
    const away = selectedCode(document.getElementById("away"));
    const home = selectedCode(document.getElementById("home"));
    output.replaceChildren();

    if (!away || !home || away === home) {
      output.appendChild(element("p", "Select two different NFL teams to view their probability comparison."));
      return;
    }
    output.appendChild(element("h3", names[away] + " @ " + names[home]));
    const schedule = window.docsNflSchedule;
    const matches = (schedule?.games ?? []).filter(event => {
      const key = gameKey(event);
      return key.away === away && key.home === home;
    });
    const event = matches.length === 1 ? matches[0] : null;
    const key = event ? gameKey(event) : null;
    const unavailable = !schedule ? "Loading NFL schedule…" :
      schedule.error ? "NFL schedule feed unavailable." :
      matches.length > 1 ? "Multiple scheduled games match these teams." :
      "No game with these away/home teams on the current NFL slate.";

    const prediction = event && savedPrediction(event, key);
    const model = prediction ? [
      names[away] + " " + percent(prediction.away_win_probability),
      names[home] + " " + percent(prediction.home_win_probability),
      "Pregame snapshot " + formatTime.format(Date.parse(prediction.snapshot_generated_utc)),
      "Feature cutoff " + prediction.feature_cutoff_date + " • Conditional on no tie"
    ] : [!event ? unavailable : modelError ? "V2 prediction feed unavailable." :
      !publishedV2 ? "Loading trained V2 predictions…" : "No saved pregame V2 prediction for " + key.id + "."];

    if (event) {
      output.appendChild(element("p", key.id + " • ESPN " + event.id + " • " +
        formatTime.format(Date.parse(event.date)) + " • " + (event.status?.type?.description ?? "Scheduled")));
    }
    const row = element("div", undefined, { display: "flex", flexWrap: "wrap", gap: "12px" });
    const odds = metric("Sportsbook No-Vig", [event ? "Loading sportsbook odds…" : unavailable], "#8cc5ff");
    row.append(
      metric("Original Model V2", model, "#54e8a5"),
      odds,
      metric("Improved Model V3", ["No verified trained artifact"], "#ffffff")
    );
    output.appendChild(row);

    if (event) {
      oddsRows(event, key).catch(error => {
        console.warn("Sportsbook odds unavailable:", error);
        return ["ESPN sportsbook feed unavailable for " + key.id + "."];
      }).then(rows => {
        if (version === renderVersion) odds.replaceWith(metric("Sportsbook No-Vig", rows, "#8cc5ff"));
      });
    }
  }

  async function loadPublishedV2() {
    try {
      const response = await fetch("data/nfl-game-probabilities-2026.json", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      if (payload.model !== "pregame_logistic_v2" || !Array.isArray(payload.games)) {
        throw new Error("Unexpected probability schema");
      }
      publishedV2 = payload;
    } catch (error) {
      modelError = true;
      console.warn("Trained V2 probabilities unavailable:", error);
    }
    render();
  }

  function init() {
    const away = document.getElementById("away");
    const home = document.getElementById("home");

    if (!away || !home) {
      console.warn(
        "Probability board: away/home selectors not found."
      );
      return;
    }

    if (document.getElementById("docProbabilityPanel")) {
      render();
      return;
    }

    const panel = element("section", undefined, {
      background: "#13263c",
      border: "2px solid #35df93",
      borderRadius: "12px",
      padding: "20px",
      margin: "20px 0",
      color: "#ffffff"
    });

    panel.id = "docProbabilityPanel";

    panel.appendChild(element(
      "h2",
      "WAR ROOM — ALL GAME PROBABILITY INTELLIGENCE",
      { color: "#35df93", marginTop: "0" }
    ));

    panel.appendChild(element(
      "p",
      "Every NFL matchup • Original V2 vs. sportsbook • " +
      "Future V3 comparison",
      { color: "#c1d2e2" }
    ));

    const output = element("div");
    output.id = "docProbabilityOutput";
    panel.appendChild(output);

    const parentPanel = away.closest(".panel") ||
      away.parentElement?.parentElement;

    if (parentPanel) {
      parentPanel.insertAdjacentElement("afterend", panel);
    } else {
      document.body.prepend(panel);
    }

    away.addEventListener("change", render);
    home.addEventListener("change", render);

    document.addEventListener("docs-nfl-schedule", render);

    render();
    loadPublishedV2();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
