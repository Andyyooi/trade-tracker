const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

// Scratch / stop-out around flat. Still counted in total P&L.
const BE_LOSS_MAX = 10;
const BE_PROFIT_MAX = 10;

const state = {
  trades: [],
  range: "all",
  charts: {},
};

function parseMt5Time(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value).trim().replace(/\./g, "-");
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  return d;
}

function startOfMonth(date) {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

function netOf(trade) {
  return Number(trade.net ?? (Number(trade.profit) + Number(trade.commission || 0) + Number(trade.swap || 0)));
}

function isBreakEven(trade) {
  const net = netOf(trade);
  return net >= -BE_LOSS_MAX && net <= BE_PROFIT_MAX;
}

function inRange(trade, range, now = new Date()) {
  const close = parseMt5Time(trade.closeTime);
  if (!close) return false;
  if (range === "today") return close >= startOfDay(now);
  if (range === "week") return close >= startOfWeek(now);
  if (range === "month") return close >= startOfMonth(now);
  return true;
}

function summarize(trades) {
  const nets = trades.map(netOf);
  const be = trades.filter(isBreakEven);
  const decided = trades.filter((t) => !isBreakEven(t));
  const wins = decided.filter((t) => netOf(t) > 0);
  const losses = decided.filter((t) => netOf(t) < 0);
  const pnl = nets.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, t) => a + netOf(t), 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + netOf(t), 0));
  const decidedCount = wins.length + losses.length;
  return {
    count: trades.length,
    pnl,
    breakEven: be.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decidedCount ? (wins.length / decidedCount) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    best: nets.length ? Math.max(...nets) : 0,
    worst: nets.length ? Math.min(...nets) : 0,
  };
}

function dailySeries(trades) {
  const map = new Map();
  for (const trade of [...trades].sort((a, b) => parseMt5Time(a.closeTime) - parseMt5Time(b.closeTime))) {
    const close = parseMt5Time(trade.closeTime);
    const key = close.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + netOf(trade));
  }
  let running = 0;
  return [...map.entries()].map(([date, pnl]) => {
    running += pnl;
    return { date, pnl, equity: running };
  });
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i].map((c) => String(c || "").trim());
    if (row[0] === "Time" && row[1] === "Position" && row[2] === "Symbol") return i;
  }
  return -1;
}

function parsePositions(rows) {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) throw new Error("Could not find the Positions table in this report.");
  const trades = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const first = String(row[0] || "").trim();
    if (!first) continue;
    if (["Orders", "Deals", "Open Positions", "Results", "Balance:"].includes(first)) break;
    if (!/^\d{4}[.-]\d{2}[.-]\d{2}/.test(first)) continue;
    const profit = Number(row[12] || 0);
    const commission = Number(row[10] || 0);
    const swap = Number(row[11] || 0);
    trades.push({
      openTime: String(row[0]),
      ticket: String(row[1] ?? ""),
      symbol: String(row[2] ?? ""),
      type: String(row[3] ?? "").toLowerCase(),
      volume: Number(row[4] || 0),
      openPrice: Number(row[5] || 0),
      sl: row[6] === "" || row[6] == null ? null : Number(row[6]),
      tp: row[7] === "" || row[7] == null ? null : Number(row[7]),
      closeTime: String(row[8] ?? ""),
      closePrice: Number(row[9] || 0),
      commission,
      swap,
      profit,
      net: Number((profit + commission + swap).toFixed(2)),
    });
  }
  return trades;
}

async function parseWorkbook(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  return parsePositions(rows);
}

function setText(id, value, pnl = false) {
  const el = document.getElementById(id);
  el.textContent = value;
  if (pnl) {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
    el.classList.toggle("pos", n > 0);
    el.classList.toggle("neg", n < 0);
  }
}

function destroyCharts() {
  Object.values(state.charts).forEach((chart) => chart.destroy());
  state.charts = {};
}

function renderCharts(trades) {
  destroyCharts();
  const series = dailySeries(trades);
  const summary = summarize(trades);
  const lineCtx = document.getElementById("equityChart");
  const pieCtx = document.getElementById("winChart");
  const barCtx = document.getElementById("dailyChart");

  state.charts.equity = new Chart(lineCtx, {
    type: "line",
    data: {
      labels: series.map((s) => s.date.slice(5)),
      datasets: [{
        label: "Cumulative net P&L",
        data: series.map((s) => s.equity),
        borderColor: "#e0b15a",
        backgroundColor: "rgba(224, 177, 90, 0.12)",
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: chartOptions("USD"),
  });

  state.charts.win = new Chart(pieCtx, {
    type: "doughnut",
    data: {
      labels: ["Wins", "Losses", "Break-even"],
      datasets: [{
        data: [summary.wins, summary.losses, summary.breakEven],
        backgroundColor: ["#3dd68c", "#ff5c7a", "#e0b15a"],
        borderWidth: 0,
      }],
    },
    options: {
      plugins: {
        legend: { labels: { color: "#8b95a8" } },
      },
      cutout: "62%",
    },
  });

  state.charts.daily = new Chart(barCtx, {
    type: "bar",
    data: {
      labels: series.map((s) => s.date.slice(5)),
      datasets: [{
        label: "Daily net P&L",
        data: series.map((s) => s.pnl),
        backgroundColor: series.map((s) => (s.pnl >= 0 ? "#3dd68c" : "#ff5c7a")),
      }],
    },
    options: chartOptions("USD"),
  });
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        ticks: { color: "#8b95a8", maxRotation: 0 },
        grid: { color: "rgba(255,255,255,0.04)" },
      },
      y: {
        ticks: { color: "#8b95a8" },
        grid: { color: "rgba(255,255,255,0.06)" },
      },
    },
  };
}

function renderTable(trades) {
  const body = document.getElementById("tradeBody");
  const sorted = [...trades].sort((a, b) => parseMt5Time(b.closeTime) - parseMt5Time(a.closeTime));
  body.innerHTML = sorted.map((t) => {
    const net = netOf(t);
    const outcome = isBreakEven(t) ? "be" : net > 0 ? "win" : "loss";
    return `<tr>
      <td>${t.closeTime}</td>
      <td>${t.symbol}</td>
      <td><span class="tag ${t.type}">${t.type}</span></td>
      <td>${t.volume}</td>
      <td>${t.openPrice}</td>
      <td>${t.closePrice}</td>
      <td><span class="tag ${outcome}">${outcome === "be" ? "BE" : outcome}</span></td>
      <td class="${net >= 0 ? "pos" : "neg"}">${currency.format(net)}</td>
    </tr>`;
  }).join("");
}

function render() {
  const now = new Date();
  const all = state.trades;
  const filtered = all.filter((t) => inRange(t, state.range, now));
  const byRange = {
    today: summarize(all.filter((t) => inRange(t, "today", now))),
    week: summarize(all.filter((t) => inRange(t, "week", now))),
    month: summarize(all.filter((t) => inRange(t, "month", now))),
    all: summarize(all),
  };
  setText("pnlToday", currency.format(byRange.today.pnl), true);
  setText("pnlWeek", currency.format(byRange.week.pnl), true);
  setText("pnlMonth", currency.format(byRange.month.pnl), true);
  setText("pnlAll", currency.format(byRange.all.pnl), true);

  const s = summarize(filtered);
  setText("statTrades", String(s.count));
  setText("statBE", String(s.breakEven));
  setText("statWinRate", `${s.winRate.toFixed(1)}%`);
  setText("statPF", Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "—");
  setText("statAvgWin", currency.format(s.avgWin), true);
  setText("statAvgLoss", currency.format(-s.avgLoss), true);
  document.getElementById("metaLine").textContent = all.length
    ? `${all.length} closed positions · break-even is net −$${BE_LOSS_MAX.toFixed(2)} to +$${BE_PROFIT_MAX.toFixed(2)} · click a P&L card to filter`
    : "Import an MT5 report or start the auto-export watcher";

  document.querySelectorAll(".kpi").forEach((el) => {
    el.classList.toggle("active", el.dataset.range === state.range);
  });

  if (filtered.length) {
    document.getElementById("empty").hidden = true;
    document.getElementById("dashboard").hidden = false;
    renderCharts(filtered);
    renderTable(filtered);
  } else {
    document.getElementById("dashboard").hidden = true;
    document.getElementById("empty").hidden = false;
  }
}

function loadTrades(trades) {
  const next = JSON.stringify(trades);
  if (next === JSON.stringify(state.trades)) return;
  state.trades = trades;
  render();
}

async function onFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const trades = await parseWorkbook(file);
    loadTrades(trades);
  } catch (err) {
    alert(err.message || "Could not parse that spreadsheet.");
  }
}

document.getElementById("fileInput").addEventListener("change", onFile);
document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
document.querySelectorAll(".kpi").forEach((el) => {
  el.addEventListener("click", () => {
    state.range = el.dataset.range;
    render();
  });
});

async function refreshLive() {
  try {
    const res = await fetch(`trades.json?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data?.trades)) loadTrades(data.trades);
  } catch {
    /* Excel/sample load is enough until the watcher is running */
  }
}

if (window.IMPORTED_TRADES?.trades?.length) {
  loadTrades(window.IMPORTED_TRADES.trades);
} else {
  render();
}

refreshLive();
setInterval(refreshLive, 4000);
