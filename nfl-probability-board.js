
/*
 DOC'S NFL WAR ROOM
 ALL-MATCHUP PROBABILITY BOARD V2

 - Works with every matchup in the War Room selectors
 - Preserves the seven existing provisional snapshots
 - Shows missing calculations honestly
 - Does not modify existing War Room calculations
 - Does not invent model probabilities or sportsbook prices
*/

(() => {
  "use strict";

  const snapshots = [
    ["TEN", "IND", "IND", 69.1, 73.3],
    ["CAR", "PHI", "CAR", 75.8, 60.6],
    ["PIT", "TB",  "PIT", 52.8, 56.8],
    ["BAL", "CLE", "BAL", 69.6, 61.0],
    ["NO",  "NYG", "NYG", 54.3, 49.4],
    ["CHI", "ATL", "CHI", 50.4, 51.7],
    ["NYJ", "NE",  "NE",  60.8, 75.3]
  ];

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

  function metric(label, value, color) {
    const block = element("div", undefined, {
      flex: "1 1 180px",
      padding: "15px",
      background: "#20384f",
      borderRadius: "10px",
      minWidth: "0"
    });

    block.appendChild(element("div", label, {
      fontSize: "13px",
      color: "#c1d2e2",
      marginBottom: "8px"
    }));

    block.appendChild(element("div", value, {
      fontSize: "29px",
      fontWeight: "bold",
      color: color
    }));

    return block;
  }

  function findSnapshot(away, home) {
    return snapshots.find(
      row => row[0] === away && row[1] === home
    ) || null;
  }

  function render() {
    const awaySelect = document.getElementById("away");
    const homeSelect = document.getElementById("home");
    const output = document.getElementById("docProbabilityOutput");

    if (!awaySelect || !homeSelect || !output) return;

    const away = selectedCode(awaySelect);
    const home = selectedCode(homeSelect);

    output.replaceChildren();

    if (!away || !home || away === home) {
      output.appendChild(element(
        "p",
        "Select two different NFL teams to view their probability comparison."
      ));
      return;
    }

    output.appendChild(element(
      "h3",
      `${names[away]} @ ${names[home]}`,
      { color: "#ffffff", marginBottom: "16px" }
    ));

    const saved = findSnapshot(away, home);

    const row = element("div", undefined, {
      display: "flex",
      flexWrap: "wrap",
      gap: "12px",
      marginBottom: "14px"
    });

    if (!saved) {
      row.appendChild(metric(
        "Original Model V2",
        "Not calculated",
        "#ffffff"
      ));

      row.appendChild(metric(
        "Sportsbook No-Vig",
        "Not available",
        "#ffffff"
      ));

      row.appendChild(metric(
        "Improved Model V3",
        "Not trained",
        "#ffffff"
      ));

      output.appendChild(row);

      output.appendChild(element(
        "div",
        "MATCHUP READY — Waiting for model and market data",
        {
          padding: "12px",
          background: "#493d20",
          color: "#ffe2a0",
          borderRadius: "8px",
          fontWeight: "bold"
        }
      ));

      output.appendChild(element(
        "p",
        "This matchup is recognized. We have not yet generated " +
        "an exact trained-model prediction or imported a " +
        "verified sportsbook price for it.",
        { lineHeight: "1.6" }
      ));

      return;
    }

    const favored = saved[2];
    const model = saved[3];
    const market = saved[4];

    const modelFavorite = model > 50
      ? favored
      : favored === away ? home : away;

    const marketFavorite = market > 50
      ? favored
      : favored === away ? home : away;

    const agreement = modelFavorite === marketFavorite;

    row.appendChild(metric(
      "Original V2 — " + names[favored],
      model.toFixed(1) + "%",
      "#54e8a5"
    ));

    row.appendChild(metric(
      "Sportsbook — " + names[favored],
      market.toFixed(1) + "%",
      "#8cc5ff"
    ));

    row.appendChild(metric(
      "Improved Model V3",
      "Not trained",
      "#ffffff"
    ));

    output.appendChild(row);

    output.appendChild(element(
      "div",
      agreement
        ? "AGREEMENT — Both favor " + names[modelFavorite]
        : "DISAGREEMENT — Model favors " +
          names[modelFavorite] +
          "; market favors " + names[marketFavorite],
      {
        padding: "12px",
        background: agreement ? "#174536" : "#53401d",
        color: agreement ? "#93ffd0" : "#ffe09a",
        borderRadius: "8px",
        fontWeight: "bold",
        marginBottom: "14px"
      }
    ));

    const table = element("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";

    const header = element("tr");

    ["Team", "Model V2", "Sportsbook"].forEach(label => {
      const th = element("th", label, {
        padding: "10px",
        borderBottom: "1px solid #4d6579",
        textAlign: "left"
      });
      header.appendChild(th);
    });

    table.appendChild(header);

    [away, home].forEach(code => {
      const isFavored = code === favored;

      const tr = element("tr");
      const values = [
        names[code],
        (isFavored ? model : 100 - model).toFixed(1) + "%",
        (isFavored ? market : 100 - market).toFixed(1) + "%"
      ];

      values.forEach(value => {
        tr.appendChild(element("td", value, {
          padding: "10px",
          borderBottom: "1px solid #344d62"
        }));
      });

      table.appendChild(tr);
    });

    const wrapper = element("div", undefined, {
      overflowX: "auto"
    });

    wrapper.appendChild(table);
    output.appendChild(wrapper);

    output.appendChild(element(
      "p",
      "Difference for " + names[favored] + ": " +
      (model - market >= 0 ? "+" : "") +
      (model - market).toFixed(1) +
      " percentage points.",
      { fontWeight: "bold" }
    ));

    output.appendChild(element(
      "p",
      "PROVISIONAL SNAPSHOT ONLY: Model percentages use " +
      "approximate 2026 inputs. Sportsbook percentages are " +
      "from saved prices, not live odds. No betting edge " +
      "has been verified.",
      {
        color: "#c5d0da",
        fontSize: "12px",
        lineHeight: "1.6"
      }
    ));
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

    // Refresh after existing War Room actions.
    document.addEventListener("click", event => {
      if (event.target.closest("button")) {
        setTimeout(render, 0);
      }
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
