const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

// Scratch / stop-out around flat. Still counted in total P&L.
const BE_LOSS_MAX = 10;
const BE_PROFIT_MAX = 10;

const STORAGE_KEY = "trade-tracker-trades-v1";
const GITHUB_TRADES_URL =
  "https://raw.githubusercontent.com/Andyyooi/trade-tracker/main/trades.json";
const GIST_ID = "f6ccd30b14d45a80a6b6cd0921b2b90b";
const GIST_API_URL = `https://api.github.com/gists/${GIST_ID}`;
const GIST_TRADES_URL =
  `https://gist.githubusercontent.com/Andyyooi/${GIST_ID}/raw/trades.json`;

function localTradesUrl() {
  return `trades.json?t=${Date.now()}`;
}

function parseTradeFeed(data) {
  if (!data || !Array.isArray(data.trades)) {
    throw new Error("missing trades array");
  }
  return data;
}

async function loadFromGistApi() {
  const res = await fetch(`${GIST_API_URL}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`gist api → ${res.status}`);
  const gist = await res.json();
  const file = gist.files?.["trades.json"];
  if (!file?.content) throw new Error("gist api → missing trades.json");
  return parseTradeFeed(JSON.parse(file.content));
}

async function refreshLive() {
  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";

  // Gist API first on the hosted site (avoids CDN caching the raw file).
  if (!local) {
    try {
      const data = await loadFromGistApi();
      // Empty is a valid reset after switching MT5 accounts.
      applyFeed(data, { persist: true });
      return;
    } catch (err) {
      console.warn("Gist API feed failed, trying fallbacks", err);
    }
  }

  const urls = local
    ? [localTradesUrl(), `${GIST_TRADES_URL}?t=${Date.now()}`]
    : [
      `${GIST_TRADES_URL}?t=${Date.now()}`,
      `${GITHUB_TRADES_URL}?t=${Date.now()}`,
      localTradesUrl(),
    ];

  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastError = `${url} → ${res.status}`;
        continue;
      }
      const data = parseTradeFeed(JSON.parse(await res.text()));
      applyFeed(data, { persist: true });
      return;
    } catch (err) {
      lastError = `${url} → ${err.message || err}`;
    }
  }
  if (!state.trades.length && lastError) {
    const empty = document.getElementById("empty");
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = `Could not load trade feed.<br><small>${lastError}</small>`;
    }
  }
}

const state = {
  trades: [],
  range: "all",
  day: null,
  calendarMonth: new Date(),
  calendarTouched: false,
  // MT5 server is GMT+3 while Europe is on summer time. The export overrides this.
  serverUtcOffsetMinutes: 180,
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

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcDateKey(ms) {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nthWeekday(year, monthIndex, weekday, n) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return 1 + delta + (n - 1) * 7;
}

function nyOffsetSeconds(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  const startDay = nthWeekday(year, 2, 0, 2);
  const endDay = nthWeekday(year, 10, 0, 1);
  const dstStart = Date.UTC(year, 2, startDay, 7, 0, 0);
  const dstEnd = Date.UTC(year, 10, endDay, 6, 0, 0);
  return utcMs >= dstStart && utcMs < dstEnd ? -4 * 3600 : -5 * 3600;
}

function sessionDayKeyFromUtcMs(utcMs) {
  const nyMs = utcMs + nyOffsetSeconds(utcMs) * 1000;
  const ny = new Date(nyMs);
  let y = ny.getUTCFullYear();
  let m = ny.getUTCMonth();
  let d = ny.getUTCDate();
  if (ny.getUTCHours() >= 17) {
    const next = new Date(Date.UTC(y, m, d) + 86400000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth();
    d = next.getUTCDate();
  }
  return utcDateKey(Date.UTC(y, m, d));
}

function brokerUtcMs(value) {
  const match = String(value || "").trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
  return wall - state.serverUtcOffsetMinutes * 60 * 1000;
}

function sessionDayKeyFromBroker(value) {
  const utcMs = brokerUtcMs(value);
  if (utcMs == null) return null;
  return sessionDayKeyFromUtcMs(utcMs);
}

function tradeSessionKey(trade) {
  return sessionDayKeyFromBroker(trade.openTime) || sessionDayKeyFromBroker(trade.closeTime);
}

function sessionDayStartKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return utcDateKey(date.getTime());
}

function compactPnl(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${sign}$${k.toFixed(k >= 10 ? 1 : 2)}K`;
  }
  if (abs >= 100) return `${sign}$${abs.toFixed(abs % 1 === 0 ? 0 : 1)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function netOf(trade) {
  return Number(trade.net ?? (Number(trade.profit) + Number(trade.commission || 0) + Number(trade.swap || 0)));
}

function isBreakEven(trade) {
  const net = netOf(trade);
  return net >= -BE_LOSS_MAX && net <= BE_PROFIT_MAX;
}

function inRange(trade, range, now = new Date()) {
  const key = tradeSessionKey(trade);
  if (!key) return false;
  const today = sessionDayKeyFromUtcMs(now.getTime());
  if (range === "today") return key === today;
  if (range === "week") return key >= sessionDayStartKey(today);
  if (range === "month") return key.slice(0, 7) === today.slice(0, 7);
  return true;
}

function matchesView(trade, now = new Date()) {
  if (state.day) return tradeSessionKey(trade) === state.day;
  return inRange(trade, state.range, now);
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

function equitySeries(trades) {
  const byDay = new Map();
  for (const trade of trades) {
    const key = tradeSessionKey(trade);
    if (!key) continue;
    byDay.set(key, (byDay.get(key) || 0) + netOf(trade));
  }
  let equity = 0;
  return [...byDay.keys()].sort().map((day) => {
    const change = byDay.get(day);
    equity += change;
    return {
      label: day.slice(5),
      change: Number(change.toFixed(2)),
      equity: Number(equity.toFixed(2)),
    };
  });
}

function tradesByDay(trades) {
  const map = new Map();
  for (const trade of trades) {
    const key = tradeSessionKey(trade);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(trade);
  }
  return map;
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
  const series = equitySeries(trades);
  const summary = summarize(trades);
  const lineCtx = document.getElementById("equityChart");
  const pieCtx = document.getElementById("winChart");

  state.charts.equity = new Chart(lineCtx, {
    type: "line",
    data: {
      labels: series.map((s) => s.label),
      datasets: [{
        label: "Equity",
        data: series.map((s) => s.equity),
        borderColor: "#e0b15a",
        backgroundColor: "rgba(224, 177, 90, 0.12)",
        fill: true,
        tension: 0.2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#e0b15a",
        borderWidth: 2,
        spanGaps: true,
      }],
    },
    options: chartOptions(series),
  });

  state.charts.win = new Chart(pieCtx, {
    type: "doughnut",
    data: {
      labels: ["Wins", "Losses", "Break-even"],
      datasets: [{
        data: [summary.wins, summary.losses, summary.breakEven],
        backgroundColor: ["#3dd68c", "#ff5c7a", "#e0b15a"],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = ctx.raw || 0;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total ? ((value / total) * 100).toFixed(1) : "0.0";
              return ` ${value} (${pct}%)`;
            },
          },
        },
      },
      cutout: "68%",
    },
  });

  renderWinLegend(summary);
  requestAnimationFrame(() => {
    state.charts.equity?.resize();
    state.charts.win?.resize();
  });
}

function renderWinLegend(summary) {
  const total = summary.wins + summary.losses + summary.breakEven;
  const rows = [
    { label: "Wins", count: summary.wins, color: "#3dd68c" },
    { label: "Losses", count: summary.losses, color: "#ff5c7a" },
    { label: "Break-even", count: summary.breakEven, color: "#e0b15a" },
  ];
  document.getElementById("winLegend").innerHTML = rows.map((row) => {
    const pct = total ? (row.count / total) * 100 : 0;
    return `<li>
      <span class="pie-swatch" style="background:${row.color}"></span>
      <span class="pie-name">${row.label}</span>
      <span class="pie-count">${row.count}</span>
      <span class="pie-pct">${pct.toFixed(1)}%</span>
    </li>`;
  }).join("") + `<li class="pie-rate">Win rate <strong>${summary.winRate.toFixed(1)}%</strong></li>`;
}

function chartOptions(series = []) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const point = series[ctx.dataIndex];
            if (!point) return ` ${currency.format(ctx.parsed.y)}`;
            return [
              ` Day ${currency.format(point.change)}`,
              ` Equity ${currency.format(point.equity)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "#8b95a8",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
        grid: { color: "rgba(255,255,255,0.04)" },
      },
      y: {
        ticks: {
          color: "#8b95a8",
          callback: (value) => compactPnl(value),
        },
        grid: { color: "rgba(255,255,255,0.06)" },
      },
    },
  };
}

function renderCalendar(trades) {
  state.calendarMonth = startOfMonth(state.calendarMonth);
  const monthDate = state.calendarMonth;
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const title = monthDate.toLocaleString("en-US", { month: "long", year: "numeric" });
  document.getElementById("calTitle").textContent = title;

  const byDay = tradesByDay(trades);
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = sessionDayKeyFromUtcMs(Date.now());
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push('<div class="cal-cell empty"></div>');
  }

  let monthTrades = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = localDateKey(new Date(year, month, day));
    const dayTrades = byDay.get(key) || [];
    monthTrades = monthTrades.concat(dayTrades);
    const summary = summarize(dayTrades);
    const isToday = key === todayKey;
    const selected = key === state.day;
    const has = dayTrades.length > 0;
    const tone = !has ? "" : summary.pnl > 0 ? "win" : summary.pnl < 0 ? "loss" : "flat";
    const classes = [
      "cal-cell",
      tone,
      has ? "has-trades" : "",
      isToday ? "today" : "",
      selected ? "selected" : "",
    ].filter(Boolean).join(" ");
    const body = has
      ? `<div class="cal-pnl ${summary.pnl >= 0 ? "pos" : "neg"}">${compactPnl(summary.pnl)}</div>
         <div class="cal-meta">${summary.count} trade${summary.count === 1 ? "" : "s"}<br>${summary.winRate.toFixed(1)}%</div>
         <span class="cal-dot ${summary.pnl >= 0 ? "pos" : "neg"}"></span>`
      : "";
    cells.push(
      `<button type="button" class="${classes}" data-day="${key}" ${has ? "" : "disabled"}>
        <div class="cal-day">${day}</div>
        ${body}
      </button>`
    );
  }

  while (cells.length % 7 !== 0) {
    cells.push('<div class="cal-cell empty"></div>');
  }

  document.getElementById("calGrid").innerHTML = cells.join("");

  const monthSummary = summarize(monthTrades);
  const monthLabel = startOfMonth(new Date()).getTime() === monthDate.getTime()
    ? "This month"
    : title;
  document.getElementById("calMonthStats").innerHTML =
    `<div>${monthLabel}</div>
     <div><strong class="${monthSummary.pnl >= 0 ? "pos" : "neg"}">${currency.format(monthSummary.pnl)}</strong>
     · ${monthSummary.count} trades · ${monthSummary.winRate.toFixed(1)}% win</div>`;
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

function rangeLabel(range) {
  if (range === "today") return "today";
  if (range === "week") return "this week";
  if (range === "month") return "this month";
  return "all imported trades";
}

function goHome() {
  state.range = "all";
  state.day = null;
  render();
}

function shiftCalendar(delta) {
  const next = new Date(startOfMonth(state.calendarMonth));
  next.setMonth(next.getMonth() + delta);
  state.calendarMonth = startOfMonth(next);
  state.calendarTouched = true;
  renderCalendar(state.trades);
}

function render() {
  const now = new Date();
  const all = state.trades;
  const filtered = all.filter((t) => matchesView(t, now));
  const viewingDay = Boolean(state.day);
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

  const homeBtn = document.getElementById("homeBtn");
  homeBtn.hidden = !all.length || (state.range === "all" && !viewingDay);

  document.querySelectorAll(".kpi").forEach((el) => {
    el.classList.toggle("active", !viewingDay && el.dataset.range === state.range);
  });

  const empty = document.getElementById("empty");
  const dashboard = document.getElementById("dashboard");
  const rangeEmpty = document.getElementById("rangeEmpty");
  const dashboardBody = document.getElementById("dashboardBody");

  if (!all.length) {
    empty.hidden = false;
    dashboard.hidden = true;
    document.getElementById("metaLine").textContent = "Waiting for the live trade feed…";
    return;
  }

  empty.hidden = true;
  dashboard.hidden = false;
  const viewLabel = viewingDay
    ? new Date(`${state.day}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    : rangeLabel(state.range);
  document.getElementById("metaLine").textContent =
    `${all.length} closed positions · viewing ${viewLabel} · click a P&L card or a calendar day to filter`;

  renderCalendar(all);

  if (!filtered.length) {
    rangeEmpty.hidden = false;
    dashboardBody.hidden = true;
    document.getElementById("rangeEmptyText").textContent =
      `No closed trades for ${viewLabel}. Total history still has ${all.length} trades.`;
    destroyCharts();
    return;
  }

  rangeEmpty.hidden = true;
  dashboardBody.hidden = false;
  renderCharts(filtered);
  renderTable(filtered);
}

function saveTradesLocally(trades) {
  try {
    if (!trades.length) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trades }));
  } catch {
    /* Safari private mode / quota — import still works for this session */
  }
}

function readTradesLocally() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return Array.isArray(saved?.trades) ? saved.trades : null;
  } catch {
    return null;
  }
}

function preferredCalendarMonth(trades) {
  const thisMonth = startOfMonth(new Date());
  let latest = null;
  let hasThisMonth = false;
  for (const trade of trades) {
    const key = tradeSessionKey(trade);
    if (!key) continue;
    const session = new Date(`${key}T00:00:00`);
    if (session >= thisMonth) hasThisMonth = true;
    if (!latest || session > latest) latest = session;
  }
  if (hasThisMonth || !latest) return thisMonth;
  return startOfMonth(latest);
}

function applyFeed(data, options) {
  const offset = Number(data?.serverUtcOffsetMinutes);
  const offsetChanged = Number.isFinite(offset) && offset !== state.serverUtcOffsetMinutes;
  if (Number.isFinite(offset)) state.serverUtcOffsetMinutes = offset;
  const unchanged = JSON.stringify(data.trades) === JSON.stringify(state.trades);
  loadTrades(data.trades, options);
  if (offsetChanged && unchanged) render();
}

function loadTrades(trades, { persist = true } = {}) {
  const next = JSON.stringify(trades);
  if (next === JSON.stringify(state.trades)) return;
  state.trades = trades;
  if (!state.calendarTouched) state.calendarMonth = preferredCalendarMonth(trades);
  if (persist) saveTradesLocally(trades);
  render();
}

async function onFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const trades = await parseWorkbook(file);
    loadTrades(trades, { persist: true });
  } catch (err) {
    alert(err.message || "Could not parse that spreadsheet.");
  }
}

document.getElementById("fileInput").addEventListener("change", onFile);
document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
document.getElementById("homeBtn").addEventListener("click", goHome);
document.getElementById("showAllBtn").addEventListener("click", goHome);
document.querySelector("h1").addEventListener("click", goHome);
document.querySelector("h1").style.cursor = "pointer";
document.querySelectorAll(".kpi").forEach((el) => {
  el.addEventListener("click", () => {
    state.range = el.dataset.range;
    state.day = null;
    if (el.dataset.range === "month" || el.dataset.range === "today" || el.dataset.range === "week") {
      state.calendarMonth = startOfMonth(new Date());
      state.calendarTouched = true;
    }
    render();
  });
});
document.getElementById("calPrev").addEventListener("click", () => shiftCalendar(-1));
document.getElementById("calNext").addEventListener("click", () => shiftCalendar(1));
document.getElementById("calThisMonth").addEventListener("click", () => {
  state.calendarMonth = startOfMonth(new Date());
  state.calendarTouched = true;
  state.day = null;
  state.range = "month";
  render();
});
document.getElementById("calGrid").addEventListener("click", (event) => {
  const cell = event.target.closest("[data-day]");
  if (!cell || cell.disabled || !cell.classList.contains("has-trades")) return;
  state.day = cell.dataset.day;
  render();
});

if (window.IMPORTED_TRADES?.trades?.length) {
  loadTrades(window.IMPORTED_TRADES.trades, { persist: false });
} else {
  const saved = readTradesLocally();
  if (saved?.length) loadTrades(saved, { persist: false });
  else render();
}

refreshLive();
setInterval(refreshLive, 4000);
