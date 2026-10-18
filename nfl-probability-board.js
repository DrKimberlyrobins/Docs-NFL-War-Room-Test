
/*
 DOC'S NFL WAR ROOM — PROBABILITY COMPARISON V1
 Saved October 18, 2026 comparison snapshot.

 IMPORTANT:
 - Model numbers are provisional approximations.
 - Sportsbook probabilities are from saved prices,
   not live odds.
 - These are NOT validated betting signals.
 - No existing War Room functions are overwritten.
*/

(() => {
  "use strict";

  const games = [
    {
      away: "Tennessee Titans",
      home: "Indianapolis Colts",
      pick: "Indianapolis Colts",
      model: 69.1,
      market: 73.3
    },
    {
      away: "Carolina Panthers",
      home: "Philadelphia Eagles",
      pick: "Carolina Panthers",
      model: 75.8,
      market: 60.6
    },
    {
      away: "Pittsburgh Steelers",
      home: "Tampa Bay Buccaneers",
      pick: "Pittsburgh Steelers",
      model: 52.8,
      market: 56.8
    },
    {
      away: "Baltimore Ravens",
      home: "Cleveland Browns",
      pick: "Baltimore Ravens",
      model: 69.6,
      market: 61.0
    },
    {
      away: "New Orleans Saints",
      home: "New York Giants",
      pick: "New York Giants",
      model: 54.3,
      market: 49.4
    },
    {
      away: "Chicago Bears",
      home: "Atlanta Falcons",
      pick: "Chicago Bears",
      model: 50.4,
      market: 51.7
    },
    {
      away: "New York Jets",
      home: "New England Patriots",
      pick: "New England Patriots",
      model: 60.8,
      market: 75.3
    }
  ];

  function make(tag, text, styles = {}) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    Object.assign(el.style, styles);
    return el;
  }

  function percentageBar(value, color) {
    const track = make("div", undefined, {
      height: "12px",
      background: "#294158",
      borderRadius: "20px",
      overflow: "hidden",
      margin: "8px 0 16px"
    });

    const fill = make("div", undefined, {
      height: "100%",
      width: value + "%",
      background: color,
      borderRadius: "20px"
    });

    track.appendChild(fill);
    return track;
  }

  function line(label, value, color) {
    const wrapper = make("div");
    const top = make("div", undefined, {
      display: "flex",
      justifyContent: "space-between",
      gap: "10px",
      flexWrap: "wrap"
    });

    top.appendChild(make("strong", label));
    top.appendChild(make("strong", value.toFixed(1) + "%", {
      color: color,
      fontSize: "20px"
    }));

    wrapper.appendChild(top);
    wrapper.appendChild(percentageBar(value, color));
    return wrapper;
  }

  function render() {
    const panel = document.getElementById("docProbabilityPanel");
    if (!panel) return;

    const away = document.getElementById("away")?.value;
    const home = document.getElementById("home")?.value;
    const output = document.getElementById("docProbabilityOutput");

    if (!output) return;
    output.replaceChildren();

    const game = games.find(
      g => g.away === away && g.home === home
    );

    if (!game) {
      output.appendChild(make(
        "p",
        "No saved probability snapshot for this matchup. " +
        "We will calculate this game when the trained model " +
        "is connected."
      ));
      return;
    }

    const marketPick = game.market > 50
      ? game.pick
      : (game.pick === game.home ? game.away : game.home);

    const agree = marketPick === game.pick;
    const difference = game.model - game.market;

    output.appendChild(make("h3", game.away + " @ " + game.home, {
      color: "#ffffff",
      marginTop: "8px"
    }));

    output.appendChild(make(
      "p",
      "Original model favors: " + game.pick,
      { color: "#b9d0e3" }
    ));

    output.appendChild(line(
      "Original Model V2 — " + game.pick,
      game.model,
      "#35df93"
    ));

    output.appendChild(line(
      "Sportsbook no-vig — " + game.pick,
      game.market,
      "#7ebcff"
    ));

    const status = make(
      "div",
      agree
        ? "AGREEMENT — Both favor " + game.pick
        : "DISAGREEMENT — Market favors " + marketPick,
      {
        padding: "12px",
        borderRadius: "8px",
        background: agree ? "#163e35" : "#503e20",
        color: agree ? "#8affc3" : "#ffda89",
        fontWeight: "bold",
        marginBottom: "12px"
      }
    );

    output.appendChild(status);

    const gap = make(
      "p",
      "Probability difference for " + game.pick + ": " +
      (difference >= 0 ? "+" : "") +
      difference.toFixed(1) + " percentage points"
    );

    output.appendChild(gap);

    const table = make("table");
    const head = make("tr");

    ["Team", "Our V2", "Sportsbook"].forEach(text => {
      head.appendChild(make("th", text));
    });

    table.appendChild(head);

    [game.pick, game.pick === game.home ? game.away : game.home]
      .forEach((team, index) => {
        const tr = make("tr");
        const model = index === 0 ? game.model : 100 - game.model;
        const market = index === 0 ? game.market : 100 - game.market;

        [
          team,
          model.toFixed(1) + "%",
          market.toFixed(1) + "%"
        ].forEach(value => {
          tr.appendChild(make("td", value));
        });

        table.appendChild(tr);
      });

    const wrap = make("div", undefined, {
      overflowX: "auto"
    });

    wrap.appendChild(table);
    output.appendChild(wrap);

    const footer = make(
      "p",
      "MODEL STATUS: PROVISIONAL. " +
      "V2 uses an approximate input snapshot, not exact " +
      "2026 game-level features. Market values are saved " +
      "historical snapshots, not live quotes. " +
      "Agreement does not establish betting value.",
      {
        fontSize: "12px",
        color: "#b9c0cc",
        lineHeight: "1.6",
        marginTop: "15px"
      }
    );

    output.appendChild(footer);
  }

  function init() {
    const matchupPanel = document.getElementById("away")?.closest(".panel");

    if (!matchupPanel) {
      console.error("Probability board: matchup panel not found");
      return;
    }

    if (document.getElementById("docProbabilityPanel")) return;

    const panel = make("div", undefined, {
      background: "#13263c",
      border: "2px solid #35df93",
      borderRadius: "12px",
      padding: "20px",
      margin: "20px 0",
      color: "white"
    });

    panel.id = "docProbabilityPanel";

    panel.appendChild(make(
      "h2",
      "WAR ROOM — WIN PROBABILITY INTELLIGENCE",
      {
        color: "#35df93",
        marginTop: "0"
      }
    ));

    panel.appendChild(make(
      "p",
      "Original model vs. sportsbook market — " +
      "October 18 saved comparison.",
      { color: "#b9d0e3" }
    ));

    const output = make("div");
    output.id = "docProbabilityOutput";
    panel.appendChild(output);

    matchupPanel.insertAdjacentElement("afterend", panel);

    document.getElementById("away")
      .addEventListener("change", render);

    document.getElementById("home")
      .addEventListener("change", render);

    const analyzeButton = matchupPanel.querySelector("button");
    if (analyzeButton) {
      analyzeButton.addEventListener("click", render);
    }

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
