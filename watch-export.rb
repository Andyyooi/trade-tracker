#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "digest"
require "fileutils"
require "open3"
require "tmpdir"

$stdout.sync = true

ROOT = File.expand_path(__dir__)
SRC = ARGV[0] || File.expand_path(
  "~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/trade-tracker.json"
)
DST_JSON = File.join(ROOT, "trades.json")
DST_JS = File.join(ROOT, "trades.js")
GIST_ID = ENV.fetch("GIST_ID", "f6ccd30b14d45a80a6b6cd0921b2b90b")
PUSH_TO_GIST = ENV.fetch("PUSH_TO_GIST", "1") != "0"
PUSH_TO_GITHUB = ENV.fetch("PUSH_TO_GITHUB", "0") != "0"
GH = ENV.fetch("GH", File.expand_path("~/bin/gh"))

puts "Watching #{SRC}"
puts "Writing #{DST_JSON}"
puts "Gist push: #{PUSH_TO_GIST ? "on (#{GIST_ID})" : "off"}"
puts "GitHub repo push: #{PUSH_TO_GITHUB ? "on" : "off"}"

def which_gh
  return GH if File.executable?(GH)
  found, = Open3.capture2("which", "gh")
  found.strip.empty? ? "gh" : found.strip
end

def push_gist(count)
  gh = which_gh
  content = File.read(DST_JSON)
  payload_path = File.join(Dir.tmpdir, "trade-tracker-gist.json")
  File.write(payload_path, JSON.generate(
    "files" => {
      "trades.json" => { "content" => content }
    }
  ))
  out, err, status = Open3.capture3(
    gh, "api", "-X", "PATCH", "/gists/#{GIST_ID}",
    "--input", payload_path
  )
  if status.success?
    puts "#{Time.now.strftime("%H:%M:%S")} pushed #{count} trades to gist"
  else
    puts "#{Time.now.strftime("%H:%M:%S")} gist push failed: #{err.empty? ? out : err}"
  end
end

def push_repo(count)
  Dir.chdir(ROOT) do
    status, = Open3.capture2("git", "status", "--porcelain", "trades.json")
    return if status.strip.empty?

    return unless system("git", "add", "trades.json")
    return unless system("git", "commit", "-m", "Update trades snapshot (#{count} closed)")
    if system("git", "push", "origin", "HEAD")
      puts "#{Time.now.strftime("%H:%M:%S")} pushed trades.json to GitHub repo"
    else
      puts "#{Time.now.strftime("%H:%M:%S")} git push failed"
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
      push_gist(count) if PUSH_TO_GIST
      push_repo(count) if PUSH_TO_GITHUB
      last_digest = digest
    end
  end
  sleep 2
end
