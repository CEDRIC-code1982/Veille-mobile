#!/usr/bin/env bash
#
# Steps 1 to 3 of the daily routine: sync, collect, and emit the classification
# request. The commands are grouped into one script so the scheduled routine
# needs a single shell permission instead of one per command, which is what
# lets it run unattended.
#
# Exits non-zero on a real failure. A missing remote is not a failure.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# A scheduled session does not necessarily inherit the login shell PATH.
export PATH="$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if git remote get-url origin >/dev/null 2>&1; then
  git pull --ff-only || echo 'pull failed, continuing on the local state'
fi

npm run collect || exit 1
npm run classify:request || exit 1
