#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "time"

BE_LOSS_MAX = 10.0
BE_PROFIT_MAX = 10.0
HOME = File.expand_path("~")
CANDIDATES = [
  File.join(HOME, "trade-tracker/trades.json"),
  File.join(
    HOME,
    "Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/trade-tracker.json"
  )
].freeze

def parse_mt5_time(value)
  Time.strptime(value.to_s.strip.tr(".", "-"), "%Y-%m-%d %H:%M:%S")
rescue ArgumentError
  nil
end

def start_of_day(time)
  Time.local(time.year, time.month, time.day)
end

def start_of_week(time)
  day = start_of_day(time)
  offset = day.wday.zero? ? 6 : day.wday - 1
  day - (offset * 24 * 60 * 60)
end

def start_of_month(time)
  Time.local(time.year, time.month, 1)
end

def net_of(trade)
  if trade["net"]
    trade["net"].to_f
  else
    trade["profit"].to_f + trade["commission"].to_f + trade["swap"].to_f
  end
end

def break_even?(trade)
  n = net_of(trade)
  n >= -BE_LOSS_MAX && n <= BE_PROFIT_MAX
end

def in_range?(trade, range, now)
  close = parse_mt5_time(trade["closeTime"])
  return false unless close
  case range
  when :today then close >= start_of_day(now)
  when :week then close >= start_of_week(now)
  when :month then close >= start_of_month(now)
  else true
  end
end

def summarize(trades)
  pnl = trades.sum { |t| net_of(t) }
  decided = trades.reject { |t| break_even?(t) }
  wins = decided.select { |t| net_of(t) > 0 }
  losses = decided.select { |t| net_of(t) < 0 }
  decided_count = wins.size + losses.size
  {
    pnl: pnl.round(2),
    trades: trades.size,
    be: trades.count { |t| break_even?(t) },
    win_rate: decided_count.zero? ? 0.0 : ((wins.size.to_f / decided_count) * 100).round(1)
  }
end

def money(value)
  sign = value.negative? ? "-" : (value.positive? ? "+" : "")
  format("%s$%.2f", sign, value.abs)
end

src = CANDIDATES.select { |path| File.file?(path) }.max_by { |path| File.mtime(path) }
now = Time.now
empty = { today: 0, week: 0, month: 0, all: 0, winRate: 0, trades: 0, be: 0, title: "$0.00", positive: true, source: "none" }

payload =
  if src.nil?
    empty
  else
    data = JSON.parse(File.read(src))
    trades = Array(data["trades"])
    today = summarize(trades.select { |t| in_range?(t, :today, now) })
    week = summarize(trades.select { |t| in_range?(t, :week, now) })
    month = summarize(trades.select { |t| in_range?(t, :month, now) })
    all = summarize(trades)
    {
      today: today[:pnl],
      week: week[:pnl],
      month: month[:pnl],
      all: all[:pnl],
      winRate: all[:win_rate],
      trades: all[:trades],
      be: all[:be],
      title: money(today[:pnl]),
      positive: today[:pnl] >= 0,
      source: File.basename(src)
    }
  end

print JSON.generate(payload)
