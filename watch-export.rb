#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "fileutils"

$stdout.sync = true

ROOT = File.expand_path(__dir__)
SRC = ARGV[0] || File.expand_path(
  "~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/trade-tracker.json"
)
DST_JSON = File.join(ROOT, "trades.json")
DST_JS = File.join(ROOT, "trades.js")

puts "Watching #{SRC}"
puts "Writing #{DST_JSON}"

last_mtime = nil
loop do
  if File.file?(SRC)
    mtime = File.mtime(SRC)
    if mtime != last_mtime
      data = JSON.parse(File.read(SRC))
      pretty = JSON.pretty_generate(data)
      File.write(DST_JSON, pretty)
      File.write(DST_JS, "window.IMPORTED_TRADES = #{pretty};\n")
      count = Array(data["trades"]).size
      puts "#{Time.now.strftime("%H:%M:%S")} synced #{count} closed trades"
      last_mtime = mtime
    end
  end
  sleep 2
end
