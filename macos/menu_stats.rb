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

DEFAULT_SERVER_UTC_OFFSET_MINUTES = 180

def wall_parts(value)
  match = value.to_s.strip.match(/(\d{4})[.\-](\d{2})[.\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  return nil unless match

  match.captures.map(&:to_i)
end

def nth_weekday(year, month, wday, n)
  first = Time.utc(year, month, 1)
  delta = (wday - first.wday) % 7
  1 + delta + (n - 1) * 7
end

def ny_offset_seconds(utc)
  year = utc.utc.year
  start_day = nth_weekday(year, 3, 0, 2)
  end_day = nth_weekday(year, 11, 0, 1)
  dst_start = Time.utc(year, 3, start_day, 7, 0, 0)
  dst_end = Time.utc(year, 11, end_day, 6, 0, 0)
  utc >= dst_start && utc < dst_end ? -4 * 3600 : -5 * 3600
end

def session_date_from_instant(time)
  utc = time.utc
  ny = Time.at(utc.to_i + ny_offset_seconds(utc)).utc
  year, month, day = ny.year, ny.month, ny.day
  if ny.hour >= 17
    rolled = Time.utc(year, month, day) + 86_400
    year, month, day = rolled.year, rolled.month, rolled.day
  end
  Time.utc(year, month, day)
end

def session_date(value, offset_minutes)
  parts = wall_parts(value)
  return nil unless parts

  year, month, day, hour, minute, second = parts
  utc = Time.utc(year, month, day, hour, minute, second) - (offset_minutes * 60)
  session_date_from_instant(utc)
end

def trade_session(trade, offset_minutes)
  session_date(trade["openTime"], offset_minutes) || session_date(trade["closeTime"], offset_minutes)
end

def start_of_week(day)
  offset = day.wday.zero? ? 6 : day.wday - 1
  day - (offset * 86_400)
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

def in_range?(trade, range, today, offset_minutes)
  opened = trade_session(trade, offset_minutes)
  return false unless opened

  case range
  when :today then opened == today
  when :week then opened >= start_of_week(today)
  when :month then opened.year == today.year && opened.month == today.month
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
    offset = data["serverUtcOffsetMinutes"]
    offset = DEFAULT_SERVER_UTC_OFFSET_MINUTES if offset.nil?
    today_session = session_date_from_instant(now)
    today = summarize(trades.select { |t| in_range?(t, :today, today_session, offset) })
    week = summarize(trades.select { |t| in_range?(t, :week, today_session, offset) })
    month = summarize(trades.select { |t| in_range?(t, :month, today_session, offset) })
    all = summarize(trades)
    {
      today: today[:pnl],
      week: week[:pnl],
      month: month[:pnl],
      all: all[:pnl],
      todayPnl: today[:pnl],
      weekPnl: week[:pnl],
      monthPnl: month[:pnl],
      allPnl: all[:pnl],
      winRate: all[:win_rate],
      trades: all[:trades],
      be: all[:be],
      statsLabel: format("Win rate  %.1f%%  ·  %d trades  ·  %d BE", all[:win_rate], all[:trades], all[:be]),
      title: money(today[:pnl]),
      positive: today[:pnl] >= 0,
      source: File.basename(src)
    }
  end

print JSON.generate(payload)
