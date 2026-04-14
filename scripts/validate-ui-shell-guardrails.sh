#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANUAL_CHECKLIST="docs/testing/ui-shell-manual-checklist.md"

usage() {
  cat <<'EOF'
Usage: bash scripts/validate-ui-shell-guardrails.sh [--ci-only] [--help]

Runs the Phase 1 UI-shell guardrail validation path.

Options:
  --ci-only   Run only the automated CI parity chain
  --help      Show this help text

Automated command chain mirrored from .github/workflows/deploy.yml:
  cd backend && cargo test --lib
  cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
  cd frontend && npm run check
  cd frontend && npm run lint
  cd frontend && npm run test
  cd frontend && npm run build

After the automated checks, default mode reminds you to continue with:
  docs/testing/ui-shell-manual-checklist.md
EOF
}

ci_only=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci-only)
      ci_only=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

printf 'Running automated UI-shell guardrail checks from %s\n' "$REPO_ROOT"

(
  cd "$REPO_ROOT/backend"
  cargo test --lib
)

(
  cd "$REPO_ROOT/backend"
  wasm-pack build --target web --out-dir ../frontend/pkg
)

(
  cd "$REPO_ROOT/frontend"
  npm run check
)

(
  cd "$REPO_ROOT/frontend"
  npm run lint
)

(
  cd "$REPO_ROOT/frontend"
  npm run test
)

(
  cd "$REPO_ROOT/frontend"
  npm run build
)

if [[ "$ci_only" == true ]]; then
  printf '\nAutomated UI-shell guardrail checks complete (--ci-only).\n'
  exit 0
fi

cat <<EOF

Automated UI-shell guardrail checks complete.

Next run the manual browser checks in:
  $MANUAL_CHECKLIST

Focus on:
- file-load navigation
- GPS in-place updates
- calibration behavior
EOF
