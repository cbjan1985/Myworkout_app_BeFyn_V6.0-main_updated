#!/bin/sh
# Starts the dev server and runs the randomised UI test for the given seeds (default 1 2). Each run can take 1-3 minutes.
cd "$(dirname "$0")/.."
node tools/serve.mjs 8099 >/dev/null 2>&1 & SRV=$!; sleep 1; CODE=0
for s in ${@:-1 2}; do timeout 280 node tests/e2e/monkey.mjs $s 300 || CODE=1; done
kill $SRV 2>/dev/null; exit $CODE
