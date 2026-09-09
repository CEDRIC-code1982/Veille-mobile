#!/usr/bin/env bash
#
# Steps 5 to 8 of the daily routine: validate the proposals, verify them
# against the sources, publish, then commit and push.
#
# The commit deliberately goes through the pre-commit hook, which runs the
# privacy scan. A refused commit must stop the run, never be bypassed.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

export PATH="$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

npm run classify:file || exit 1
npm run verify || exit 1
npm run publish || exit 1

git add data/items data/index.json digest || exit 1

if git diff --staged --quiet; then
  echo 'no data change, nothing to commit'
  exit 0
fi

git commit -m 'data: daily watch update' || exit 1

if git remote get-url origin >/dev/null 2>&1; then
  git push || exit 1
fi
