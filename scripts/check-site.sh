#!/usr/bin/env bash
# Checks a deployed copy of the site: every address in scripts/urls.txt answers the way it should,
# and (when given a version) that the deploy really went live.
# Usage: scripts/check-site.sh <base-url> [expected-version]
set -uo pipefail
base="${1%/}"
want="${2:-}"
here="$(cd "$(dirname "$0")" && pwd)"
fail=0

if [ -n "$want" ]; then
  got=""
  for _ in $(seq 1 18); do
    got="$(curl -s --max-time 10 "$base/version.txt?check=$RANDOM" | tr -d '[:space:]')"
    [ "$got" = "$want" ] && break
    sleep 10
  done
  if [ "$got" = "$want" ]; then
    echo "ok    version ${want:0:7} is live on $base"
  else
    echo "FAIL  $base/version.txt says '${got:0:40}', expected ${want:0:7}. The deploy may have gone to a preview instead (see README: Troubleshooting)."
    fail=1
  fi
fi

while read -r path status _; do
  case "$path" in ''|'#'*) continue ;; esac
  # A fresh deploy can serve its pages a few seconds before its /feed/api functions answer,
  # so a miss gets three more tries, 5 seconds apart, before it counts.
  for try in 1 2 3 4; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$base$path")"
    [ "$code" = "$status" ] && break
    [ "$try" -lt 4 ] && sleep 5
  done
  if [ "$code" = "$status" ]; then
    echo "ok    $code $path"
  else
    echo "FAIL  $code $path (expected $status)"
    fail=1
  fi
done < "$here/urls.txt"

exit $fail
