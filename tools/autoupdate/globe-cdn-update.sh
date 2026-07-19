#!/usr/bin/env bash
# Autoupdate installed Foundry modules from the Timeweb CDN.
#
# Reads the CDN manifest index, compares each module's published version to the
# installed one, and for any that are newer downloads the release zip and
# extracts it in place. Extraction overwrites dist/, lang/, module.json only;
# large map data (golarion.pmtiles, terrain/) is not in the zip and is left
# untouched.
#
# Intended to run on the staging Foundry host, either invoked by CI over SSH
# (see .github/workflows/release.yml) or on a systemd timer (see the .timer and
# .service units in this directory).
#
# Config via environment (all optional; defaults suit the staging host):
set -euo pipefail

CDN_BASE="${CDN_BASE:-https://s3.twcstorage.ru/foundry-modules}"
PREFIX="${CDN_PATH_PREFIX:-}"
MODULES_DIR="${MODULES_DIR:-/var/foundrydata-staging/Data/modules}"
FVTT_USER="${FVTT_USER:-fvtt}"
FVTT_SERVICE="${FVTT_SERVICE:-foundry-staging}"

DRY_RUN=0
FORCE=0
INSTALL_NEW=0
NO_RESTART=0
ONLY_MODULE=""

usage() {
  cat <<EOF
Usage: globe-cdn-update.sh [options]
  --dry-run        show what would change, do nothing
  --force          reinstall even if versions match
  --all            also install modules from the CDN that are not yet installed
  --no-restart     do not restart the Foundry service afterwards
  --module <id>    only consider a single module id
Environment: CDN_BASE, CDN_PATH_PREFIX, MODULES_DIR, FVTT_USER, FVTT_SERVICE
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --all) INSTALL_NEW=1 ;;
    --no-restart) NO_RESTART=1 ;;
    --module) ONLY_MODULE="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

for bin in curl jq unzip; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing required tool: $bin" >&2; exit 1; }
done

# Return 0 if $1 is strictly newer than $2 (semver-ish, via sort -V).
version_gt() {
  [ "$1" = "$2" ] && return 1
  local newest
  newest="$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)"
  [ "$newest" = "$1" ]
}

log() { echo "[cdn-update] $*"; }

INDEX_URL="${CDN_BASE}/manifest-index.json"
log "fetching index: ${INDEX_URL}"
INDEX_JSON="$(curl -fsSL "$INDEX_URL")" || { echo "failed to fetch index" >&2; exit 1; }

mapfile -t IDS < <(echo "$INDEX_JSON" | jq -r '.modules[].id')
[ "${#IDS[@]}" -eq 0 ] && { log "index lists no modules; nothing to do"; exit 0; }

CHANGED=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for id in "${IDS[@]}"; do
  [ -n "$ONLY_MODULE" ] && [ "$id" != "$ONLY_MODULE" ] && continue

  remote_ver="$(echo "$INDEX_JSON" | jq -r --arg id "$id" '.modules[] | select(.id==$id) | .version')"
  target_dir="${MODULES_DIR}/${id}"
  installed_json="${target_dir}/module.json"

  if [ ! -d "$target_dir" ]; then
    if [ "$INSTALL_NEW" -eq 1 ]; then
      installed_ver="(new)"
    else
      log "skip ${id}: not installed (use --all to install)"
      continue
    fi
  else
    installed_ver="$(jq -r '.version // "0.0.0"' "$installed_json" 2>/dev/null || echo "0.0.0")"
  fi

  if [ "$FORCE" -ne 1 ] && [ "$installed_ver" != "(new)" ] && ! version_gt "$remote_ver" "$installed_ver"; then
    log "ok ${id}: ${installed_ver} is current"
    continue
  fi

  log "update ${id}: ${installed_ver} -> ${remote_ver}"
  if [ "$DRY_RUN" -eq 1 ]; then CHANGED=$((CHANGED + 1)); continue; fi

  if [ -n "$PREFIX" ]; then zip_url="${CDN_BASE}/${PREFIX}/${id}/${id}-${remote_ver}.zip"; else zip_url="${CDN_BASE}/${id}/${id}-${remote_ver}.zip"; fi
  zip_path="${TMP}/${id}.zip"
  curl -fsSL "$zip_url" -o "$zip_path" || { echo "::download failed for ${id} (${zip_url})"; continue; }

  mkdir -p "$target_dir"
  # Overwrite in place; leaves untracked large assets (pmtiles, terrain/) alone.
  unzip -o -q "$zip_path" -d "$target_dir"
  chown -R "${FVTT_USER}:${FVTT_USER}" "$target_dir" 2>/dev/null || true
  CHANGED=$((CHANGED + 1))
done

if [ "$CHANGED" -eq 0 ]; then
  log "no changes"
  exit 0
fi

log "${CHANGED} module(s) changed"
if [ "$DRY_RUN" -eq 1 ] || [ "$NO_RESTART" -eq 1 ]; then
  log "restart skipped"
  exit 0
fi

log "restarting ${FVTT_SERVICE}"
systemctl restart "$FVTT_SERVICE"
log "done"
