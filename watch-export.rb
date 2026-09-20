#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "digest"
require "fileutils"
require "open3"

$stdout.sync = true

ROOT = File.expand_path(__dir__)
SRC = ARGV[0] || File.expand_path(
  "~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/trade-tracker.json"
)
DST_JSON = File.join(ROOT, "trades.json")
DST_JS = File.join(ROOT, "trades.js")
PUSH_TO_GITHUB = ENV.fetch("PUSH_TO_GITHUB", "1") != "0"

puts "Watching #{SRC}"
puts "Writing #{DST_JSON}"
puts "GitHub push: #{PUSH_TO_GITHUB ? "on" : "off"}"

def push_trades_snapshot(count)
  Dir.chdir(ROOT) do
    status, = Open3.capture2("git", "status", "--porcelain", "trades.json")
    return if status.strip.empty?

    ok = system("git", "add", "trades.json")
    return unless ok

    message = "Update trades snapshot (#{count} closed)"
    ok = system("git", "commit", "-m", message)
    return unless ok

    if system("git", "push", "origin", "HEAD")
      puts "#{Time.now.strftime("%H:%M:%S")} pushed trades.json to GitHub"
    else
      puts "#{Time.now.strftime("%H:%M:%S")} git push failed — check gh auth"
    end
  end
end

last_digest = nil
loop do
  if File.file?(SRC)
    raw = File.read(SRC)
    digest = Digest::SHA256.hexdigest(raw)
    if digest != last_digest
      data = JSON.parse(raw)
      pretty = JSON.pretty_generate(data)
      File.write(DST_JSON, pretty)
      File.write(DST_JS, "window.IMPORTED_TRADES = #{pretty};\n")
      count = Array(data["trades"]).size
      puts "#{Time.now.strftime("%H:%M:%S")} synced #{count} closed trades"
      push_trades_snapshot(count) if PUSH_TO_GITHUB
      last_digest = digest
    end
  end
  sleep 2
end
