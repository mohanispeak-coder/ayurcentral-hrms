#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Standalone shell smoke page for local UI verification (no Google backend).
# For clasp push/pull: npx @google/clasp@2.4.2 (after `clasp login` in apps-script/).
node tests/generate-shell-smoke.js
