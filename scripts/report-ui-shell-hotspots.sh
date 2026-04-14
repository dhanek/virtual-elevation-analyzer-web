#!/usr/bin/env bash
set -euo pipefail

TARGET="frontend/src/main.ts"

if [[ ! -f "$TARGET" ]]; then
  printf 'Missing target: %s\n' "$TARGET" >&2
  exit 1
fi

count_matches() {
  local pattern="$1"
  local file="$2"
  rg -F -c "$pattern" "$file"
}

printf 'UI shell hotspot report\n'
printf 'Target: %s\n\n' "$TARGET"

line_count=$(wc -l < "$TARGET" | tr -d ' ')
get_element_count=$(count_matches 'document.getElementById(' "$TARGET")
add_listener_count=$(count_matches 'addEventListener(' "$TARGET")
inner_html_count=$(count_matches 'innerHTML = `' "$TARGET")
inline_style_count=$(count_matches 'style="' "$TARGET")
any_annotation_count=$(count_matches ': any' "$TARGET")

printf 'Baseline counts\n'
printf '  lines: %s\n' "$line_count"
printf '  document.getElementById(: %s\n' "$get_element_count"
printf '  addEventListener(: %s\n' "$add_listener_count"
printf '  innerHTML = `: %s\n' "$inner_html_count"
printf '  style=" : %s\n' "$inline_style_count"
printf '  : any: %s\n\n' "$any_annotation_count"

printf 'Hotspot function anchors\n'
rg -n '^async function showGpsLapVEPlot\b|^async function updateGpsLapVEPlots\b|^async function showOutAndBackVEPlot\b|^async function updateOutAndBackVEPlots\b|^async function handleAnalyze\b|^function initializeSection3\b|^async function showVirtualElevationAnalysisInline\b|^function setupVESliders\b|^async function calculateAutoRho\b' "$TARGET"
