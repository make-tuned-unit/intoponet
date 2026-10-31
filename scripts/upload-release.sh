#!/usr/bin/env bash
# Upload one macOS release to the Atlas Atlantic Blob store and delete every older release there,
# so the store only ever holds the current version (about 250 MB).
# Usage, from the repo root: scripts/upload-release.sh 0.1.3
# Needs: the intoponet-preview project on the Atlas Atlantic team, with the intoponet-releases store connected.
set -euo pipefail

version="${1:?usage: scripts/upload-release.sh <version>}"
release_dir="dist/macos/release/${version}-arm64"
dmg="${release_dir}/Intoponet-${version}-arm64.dmg"
zip="${release_dir}/Intoponet-${version}-arm64-mac.zip"
[[ -f "$dmg" && -f "$zip" ]] || { echo "missing $dmg or $zip" >&2; exit 1; }

# The token lives only in this temporary file and is removed on exit.
env_file="$(mktemp -t intoponet-blob)"
trap 'rm -f "$env_file"' EXIT
vercel env pull "$env_file" --environment production --yes >/dev/null
token="$(grep '^BLOB_READ_WRITE_TOKEN=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"')"
[[ -n "$token" ]] || { echo "no BLOB_READ_WRITE_TOKEN: connect the intoponet-releases store to intoponet-preview first" >&2; exit 1; }
# A leftover OIDC token in .env.local makes the CLI refuse an explicit rw token.
unset VERCEL_OIDC_TOKEN BLOB_STORE_ID

blob() { vercel blob "$@" --rw-token "$token"; }

echo "Uploading ${version}…"
blob put "$dmg" --pathname "releases/${version}/Intoponet-${version}-arm64.dmg" --access public --allow-overwrite true
blob put "$zip" --pathname "releases/${version}/Intoponet-${version}-arm64-mac.zip" --access public --allow-overwrite true

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
