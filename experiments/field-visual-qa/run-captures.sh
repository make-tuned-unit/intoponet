#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
artifact_dir="$repo_root/experiments/field-visual-qa/artifacts"
public_snapshot="$artifact_dir/public-field-snapshot.json"
synthetic_snapshot="/tmp/intoponet-visual-synthetic.json"

"$repo_root/node_modules/.bin/esbuild" "$repo_root/packages/field-snapshot/src/fixtures.ts" --bundle --platform=node --format=esm --outfile=/tmp/intoponet-field-fixtures.mjs >/dev/null
node --input-type=module - <<'NODE'
import { demoFieldSnapshot } from '/tmp/intoponet-field-fixtures.mjs'
import { writeFileSync } from 'node:fs'
writeFileSync('/tmp/intoponet-visual-synthetic.json', JSON.stringify(demoFieldSnapshot()))
NODE
"$repo_root/node_modules/.bin/esbuild" "$repo_root/experiments/field-visual-qa/public-snapshot-fixture.ts" --bundle --platform=node --format=esm --outfile=/tmp/intoponet-public-visual-fixture.mjs >/dev/null
node --input-type=module - <<'NODE'
import { publicSnapshotFixture } from '/tmp/intoponet-public-visual-fixture.mjs'
import { writeFileSync } from 'node:fs'
writeFileSync('experiments/field-visual-qa/artifacts/public-field-snapshot.json', JSON.stringify(publicSnapshotFixture))
NODE

capture_one() {
  local kind="$1"
  local snapshot="$2"
  local port="$3"
  local scale="$4"
  local profile
  profile="$(mktemp -d "/tmp/intoponet-field-qa-${kind}.XXXXXX")"
  mkdir -p "$profile"
  cp "$snapshot" "$profile/public-field-snapshot.json"
  "$repo_root/node_modules/.bin/electron" \
    --remote-debugging-port="$port" \
    --user-data-dir="$profile" \
    --enable-logging=stderr \
    "$repo_root/apps/desktop/out/main/index.js" >"/tmp/intoponet-visual-qa-${kind}-${scale}.log" 2>&1 &
  local app_pid=$!
  trap 'kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; rm -rf "$profile"' RETURN
  node "$repo_root/experiments/field-visual-qa/capture.mjs" "$port" "$artifact_dir/${kind}-${scale}-north-america.png" "$scale"
  kill "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  trap - RETURN
  rm -rf "$profile"
}

capture_one synthetic "$synthetic_snapshot" 9235 earth
capture_one public "$public_snapshot" 9236 earth
capture_one synthetic "$synthetic_snapshot" 9235 city
capture_one public "$public_snapshot" 9236 city
