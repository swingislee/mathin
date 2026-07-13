#!/usr/bin/env bash
set -Eeuo pipefail

WARN_PERCENT=${WARN_PERCENT:-75}
CRITICAL_PERCENT=${CRITICAL_PERCENT:-85}
BACKUP_ROOT=${BACKUP_ROOT:-}
STORAGE_DIR=${STORAGE_DIR:-/home/swing/services/supabase-project/volumes/storage}
MAX_BACKUP_AGE_HOURS=${MAX_BACKUP_AGE_HOURS:-26}
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL:-}

send() {
  local message=$1
  printf '%s\n' "$message" >&2
  [[ -z "$ALERT_WEBHOOK_URL" ]] && return 0
  curl --fail --silent --show-error --max-time 10 \
    -H 'content-type: application/json' \
    --data "$(printf '%s' "$message" | python3 -c 'import json,sys; print(json.dumps({"text":sys.stdin.read()}))')" \
    "$ALERT_WEBHOOK_URL" >/dev/null
}

status=0
declare -A checked=()
for path in / "$STORAGE_DIR" "$BACKUP_ROOT"; do
  [[ -z "$path" || ! -e "$path" ]] && continue
  target=$(df -P "$path" | awk 'NR==2 {print $6}')
  [[ -n "${checked[$target]:-}" ]] && continue
  checked[$target]=1
  used=$(df -P "$path" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
  if (( used >= CRITICAL_PERCENT )); then
    send "Mathin disk CRITICAL on $(hostname): $target is ${used}% full"
    status=2
  elif (( used >= WARN_PERCENT )); then
    send "Mathin disk WARNING on $(hostname): $target is ${used}% full"
    (( status < 1 )) && status=1
  fi
done

if [[ -n "$BACKUP_ROOT" ]]; then
  latest=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'mathin-*' -printf '%T@\n' 2>/dev/null | sort -nr | head -1)
  now=$(date +%s)
  if [[ -z "$latest" ]] || (( now - ${latest%.*} > MAX_BACKUP_AGE_HOURS * 3600 )); then
    send "Mathin backup STALE on $(hostname): no successful backup within ${MAX_BACKUP_AGE_HOURS}h"
    status=2
  fi
fi

exit "$status"
