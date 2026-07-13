#!/usr/bin/env bash
set -Eeuo pipefail

WARN_PERCENT=${WARN_PERCENT:-75}
CRITICAL_PERCENT=${CRITICAL_PERCENT:-85}
BACKUP_ROOT=${BACKUP_ROOT:-}
STORAGE_DIR=${STORAGE_DIR:-/home/swing/services/supabase-project/volumes/storage}
MAX_BACKUP_AGE_HOURS=${MAX_BACKUP_AGE_HOURS:-26}
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL:-}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
DB_NAME=${DB_NAME:-postgres}
DB_USER=${DB_USER:-postgres}

persist_to_dashboard() {
  local severity=$1 message=$2
  command -v docker >/dev/null || return 0
  python3 -c 'import sys; q=lambda s:"\047"+s.replace("\047","\047\047")+"\047"; print("insert into public.operational_errors(level,event,message,environment) values(%s,%s,%s,%s);"%(q(sys.argv[1]),q("infra.disk_alert"),q(sys.argv[2]),q("infrastructure")))' "$severity" "$message" \
    | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -v ON_ERROR_STOP=1 >/dev/null || true
}

send() {
  local severity=$1 message=$2
  printf '%s\n' "$message" >&2
  persist_to_dashboard "$severity" "$message"
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
    send critical "Mathin disk CRITICAL on $(hostname): $target is ${used}% full"
    status=2
  elif (( used >= WARN_PERCENT )); then
    send warning "Mathin disk WARNING on $(hostname): $target is ${used}% full"
    (( status < 1 )) && status=1
  fi
done

if [[ -n "$BACKUP_ROOT" ]]; then
  latest=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'mathin-*' -printf '%T@\n' 2>/dev/null | sort -nr | head -1)
  now=$(date +%s)
  if [[ -z "$latest" ]] || (( now - ${latest%.*} > MAX_BACKUP_AGE_HOURS * 3600 )); then
    send critical "Mathin backup STALE on $(hostname): no successful backup within ${MAX_BACKUP_AGE_HOURS}h"
    status=2
  fi
fi

exit "$status"
