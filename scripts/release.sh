#!/bin/sh
# Rolls a version out through Crossfade and waits for the verdict (OSB style: PUT, then poll GET).
#
#   release.sh <app> <version> [host:port] [plan]
#
# Environment:
#   CROSSFADE_API_KEY  required; an app-scoped key (Settings > API keys, or POST /api/v1/keys)
#   CROSSFADE_URL      dashboard/API origin (default http://127.0.0.1:3000)
#   CROSSFADE_TIMEOUT  seconds to wait for a verdict (default 7200)
#
# Exit codes: 0 promoted and applied at the edge; 1 rolled back or cancelled (applied);
#             2 timeout, transport error, or the request was refused.
# Stop the previous container only after exit 0.
set -eu

die() { printf 'crossfade: %s\n' "$1" >&2; exit 2; }

[ $# -ge 2 ] || die "usage: release.sh <app> <version> [host:port] [plan]"
app=$1
version=$2
upstream=${3:-}
plan=${4:-}
url=${CROSSFADE_URL:-http://127.0.0.1:3000}
timeout=${CROSSFADE_TIMEOUT:-7200}
[ -n "${CROSSFADE_API_KEY:-}" ] || die "set CROSSFADE_API_KEY"
command -v jq >/dev/null || die "jq is required"

id=$( (uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid) | tr 'A-Z' 'a-z')
host=${upstream%:*}
port=${upstream##*:}
body=$(jq -n --arg app "$app" --arg version "$version" --arg host "$host" --arg port "$port" --arg plan "$plan" --arg upstream "$upstream" '
  {app: $app, candidate: ({name: $version} + (if $upstream == "" then {} else {host: $host, port: ($port | tonumber)} end))}
  + (if $plan == "" then {} else {plan: $plan} end)')

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

code=$(curl -sS -o "$tmp/body" -w '%{http_code}' -X PUT "$url/api/v1/releases/$id" \
  -H "x-api-key: $CROSSFADE_API_KEY" -H 'content-type: application/json' -d "$body") || die "cannot reach $url"
case "$code" in
  200 | 202) ;;
  *) die "release refused ($code): $(cat "$tmp/body")" ;;
esac
printf 'crossfade: %s created (%s -> %s)\n' "$(jq -r .key "$tmp/body")" "$(jq -r .from "$tmp/body")" "$version"

deadline=$(($(date +%s) + timeout))
last=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  code=$(curl -sS -D "$tmp/headers" -o "$tmp/body" -w '%{http_code}' "$url/api/v1/releases/$id" -H "x-api-key: $CROSSFADE_API_KEY") || code=000
  if [ "$code" = 200 ]; then
    line=$(jq -r '"\(.status) \(.step.weight)% \(.step.phase // "") \(if .hold then "(" + .hold.reason + ")" else "" end)"' "$tmp/body")
    [ "$line" != "$last" ] && printf 'crossfade: %s\n' "$line" && last=$line
    if [ "$(jq -r '.terminal and .applied' "$tmp/body")" = true ]; then
      [ "$(jq -r .status "$tmp/body")" = promoted ] && exit 0
      printf 'crossfade: %s\n' "$(jq -c '.outcome' "$tmp/body")" >&2
      exit 1
    fi
  fi
  wait=$(sed -n 's/^[Rr]etry-[Aa]fter: *\([0-9]*\).*/\1/p' "$tmp/headers" 2>/dev/null | head -1)
  sleep "${wait:-2}"
done
die "timed out after ${timeout}s waiting for a verdict on $id"
