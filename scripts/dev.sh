#!/bin/bash
#
# The full dev loop: Vite on the frontend, cargo-watch rebuilding the wasm
# core into frontend/pkg. The `ve-wasm-reload` plugin in vite.config.ts
# reloads the page when a rebuild lands, so an edit to Rust and an edit to
# TypeScript both end with the browser showing the new code.
#
# Requires cargo-watch (cargo install cargo-watch). Without it this still
# runs, printing a warning and serving the frontend only — which is the same
# thing `npm run dev` gives you.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pids=()

cleanup() {
    # A single Ctrl-C in the terminal reaches the whole process group, but a
    # kill of this script does not, so take the children down explicitly.
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null
    done
    wait 2>/dev/null
}
trap cleanup EXIT INT TERM

if command -v cargo-watch &> /dev/null; then
    echo "👀 Watching backend/ → frontend/pkg"
    cargo watch \
        --workdir "$REPO_ROOT/backend" \
        --watch src \
        --watch Cargo.toml \
        --shell 'wasm-pack build --target web --out-dir ../frontend/pkg' &
    pids+=($!)
else
    echo "⚠️  cargo-watch not found — Rust changes will NOT rebuild."
    echo "   Install it with: cargo install cargo-watch"
    echo "   Or rebuild by hand with: npm run build:wasm"
fi

echo "🚀 Starting Vite dev server"
npm --prefix "$REPO_ROOT/frontend" run dev &
pids+=($!)

# Exit as soon as either side dies, rather than leaving a half-running loop.
wait -n
