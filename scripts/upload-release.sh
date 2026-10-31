#!/usr/bin/env bash
# Upload one macOS release to the Atlas Atlantic Blob store and delete every older release there,
# so the store only ever holds the current version (about 250 MB).
# Usage, from the repo root:
#   scripts/upload-release.sh 0.1.4 --keep-older   upload, leaving older releases (the live site still links to them)
#   (deploy the website so it links to the new release)
#   scripts/upload-release.sh 0.1.4 --prune-only   remove every release older than 0.1.4
#   scripts/upload-release.sh 0.1.4                upload and prune in one go
# Needs: the intoponet-preview project on the Atlas Atlantic team, with the intoponet-releases store connected.
set -euo pipefail

version="${1:?usage: scripts/upload-release.sh <version> [--keep-older|--prune-only]}"
mode="${2:-}"
release_dir="dist/macos/release/${version}-arm64"
dmg="${release_dir}/Intoponet-${version}-arm64.dmg"
zip="${release_dir}/Intoponet-${version}-arm64-mac.zip"
[[ "$mode" == "--prune-only" || ( -f "$dmg" && -f "$zip" ) ]] || { echo "missing $dmg or $zip" >&2; exit 1; }

# The token lives only in this temporary file and is removed on exit.
env_file="$(mktemp -t intoponet-blob)"
trap 'rm -f "$env_file"' EXIT
token=""
# The store may be connected to only some environments; any of them carries its token.
for environment in production preview development; do
  vercel env pull "$env_file" --environment "$environment" --yes >/dev/null 2>&1 || continue
  token="$(grep '^BLOB_READ_WRITE_TOKEN=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"' || true)"
  [[ -n "$token" && "$token" != "[SENSITIVE]" ]] && break
  token=""
done
unset VERCEL_OIDC_TOKEN BLOB_STORE_ID
if [[ -n "$token" ]]; then
  blob() { vercel blob "$@" --rw-token "$token"; }
else
  # Stores connected with OIDC have no read-write token: use the project's OIDC token
  # (refreshed into .env.local by `vercel link`) with the Atlas Atlantic store's id.
  # Take the token from an environment the store is connected to (it carries BLOB_STORE_ID).
  read_var() { grep "^$1=" "$env_file" | head -1 | cut -d= -f2- | tr -d '"' || true; }
  oidc=""
  store_id=""
  for environment in production preview; do
    vercel env pull "$env_file" --environment "$environment" --yes >/dev/null 2>&1 || continue
    store_id="$(read_var BLOB_STORE_ID)"
    oidc="$(read_var VERCEL_OIDC_TOKEN)"
    [[ -n "$store_id" && -n "$oidc" ]] && break
    oidc=""
  done
  [[ -n "$oidc" ]] || { echo "no Blob credentials: connect the intoponet-releases store to intoponet-preview" >&2; exit 1; }
  echo "Using store ${store_id} (${environment} environment)"
  blob() { vercel blob "$@" --oidc-token "$oidc" --store-id "$store_id"; }
fi

if [[ "$mode" != "--prune-only" ]]; then
  echo "Uploading ${version}…"
  blob put "$dmg" --pathname "releases/${version}/Intoponet-${version}-arm64.dmg" --access public --allow-overwrite true
  blob put "$zip" --pathname "releases/${version}/Intoponet-${version}-arm64-mac.zip" --access public --allow-overwrite true
fi

if [[ "$mode" == "--keep-older" ]]; then
  echo "Keeping older releases: run with --prune-only after the website deploy."
  blob list --prefix releases/
  exit 0
fi
echo "Removing older releases…"
old="$(blob list --prefix releases/ --limit 100 2>/dev/null | grep -oE 'https://[^ ]+/releases/[^ ]+' | grep -v "/releases/${version}/" || true)"
if [[ -n "$old" ]]; then
  # shellcheck disable=SC2086
  blob del $old
else
  echo "nothing older to remove"
fi

echo "Store now holds:"
blob list --prefix releases/
