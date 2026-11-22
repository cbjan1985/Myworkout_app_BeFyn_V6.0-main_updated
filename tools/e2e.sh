#!/bin/sh
# Starts the static server, runs the browser flows, stops the server. Needs Playwright (see tests/e2e/lib.mjs).
cd "$(dirname "$0")/.."
node tools/serve.mjs 8099 >/dev/null 2>&1 &
SRV=$!
sleep 1
node tests/e2e/flows.mjs "$@"
CODE=$?
kill $SRV 2>/dev/null
exit $CODE
