# Trade Tracker

Local dashboard for MetaTrader 5 closed trades.

## Open it

You need two terminals from this folder:

```bash
ruby -run -e httpd . -p 8080
ruby watch-export.rb
```

Then open [http://localhost:8080](http://localhost:8080).

## Menu bar

The small P&L readout lives in the Mac menu bar (top-right, same area as moomoo). It shows **today’s** net, and the click menu has week / month / all, win rate, and a link back to the dashboard.

Open it with:

```bash
open ~/trade-tracker/macos/TradeTracker.app
```

It reads `trades.json` (or the MT5 export file directly) and refreshes every 5 seconds. MT5 still needs to be open for **new** trades. Quit from the menu when you want it gone.

To show it at login: System Settings → General → Login Items → add `TradeTracker`.

The dashboard refreshes every few seconds once the MT5 expert is writing `trade-tracker.json`. You can still use **Import MT5 report** for an Excel backup.

## Auto-export from MT5

1. Copy `mql5/TradeTrackerExport.mq5` into MT5 **Navigator → Expert Advisors** (or open the file in MetaEditor).
2. Compile it in MetaEditor (`F7`).
3. Drag **TradeTrackerExport** onto any chart (GOLD is fine).
4. Allow **Algo Trading** / AutoTrading so the expert can run.
5. It writes closed positions to MT5 Common Files as `trade-tracker.json` every 5 seconds and after each trade.

On this Mac the file lands at:

`~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/trade-tracker.json`

`watch-export.rb` copies that into this project so the browser can read it. MT5 must stay open and logged in.

## What the numbers mean

- **Net P&L** (today / week / month / all) includes every closed trade, including scratch exits.
- **Break-even** is net P&L from **−$10 through +$10**. Those trades stay in total P&L, the equity curve, and daily bars.
- **Win rate, profit factor, average win, average loss, and the win/loss slices** ignore break-even trades.
- Change `BE_LOSS_MAX` and `BE_PROFIT_MAX` in `app.js` if your scratch band is different.

Keep `trades.js`, `trades.json`, and `data/` off git — they are account history.
