#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node tests/generate-shell-smoke.js

ASK_HR_SIBLING="$ROOT/../ayurveda-ai"
failed=0

for test_file in tests/*.test.js; do
  base="$(basename "$test_file")"
  case "$base" in
    ask-hr-answer-quality.test.js|ask-hr-knowledge-architecture.test.js)
      if [[ ! -d "$ASK_HR_SIBLING" ]]; then
        echo "SKIP $base — sibling repo not found at $ASK_HR_SIBLING"
        continue
      fi
      ;;
  esac
  echo "=== $base ==="
  if ! node "$test_file"; then
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo ""
  echo "One or more test files failed."
  exit 1
fi

echo ""
echo "All runnable Node contract tests passed."
