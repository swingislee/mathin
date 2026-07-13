#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_ROOT=${BACKUP_ROOT:-}
STORAGE_DIR=${STORAGE_DIR:-/home/swing/services/supabase-project/volumes/storage}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
DB_NAME=${DB_NAME:-postgres}
DB_USER=${DB_USER:-postgres}
RETENTION_DAYS=${RETENTION_DAYS:-30}
ALLOW_LOCAL_BACKUP=${ALLOW_LOCAL_BACKUP:-0}
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL:-}

alert() {
  local message=$1
  printf '%s\n' "$message" >&2
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    curl --fail --silent --show-error --max-time 10 \
      -H 'content-type: application/json' \
      --data "$(printf '%s' "$message" | python3 -c 'import json,sys; print(json.dumps({"text":sys.stdin.read()}))')" \
      "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

fail() {
  alert "Mathin P4E backup FAILED on $(hostname): $*"
  exit 1
}

[[ -n "$BACKUP_ROOT" ]] || fail 'BACKUP_ROOT is required'
[[ "$BACKUP_ROOT" = /* && "$BACKUP_ROOT" != / && ${#BACKUP_ROOT} -ge 8 ]] || fail 'BACKUP_ROOT must be a safe absolute path'
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail 'RETENTION_DAYS must be an integer'
command -v docker >/dev/null || fail 'docker is unavailable'
command -v findmnt >/dev/null || fail 'findmnt is unavailable'
command -v flock >/dev/null || fail 'flock is unavailable'
[[ -d "$STORAGE_DIR" ]] || fail "Storage directory does not exist: $STORAGE_DIR"

mkdir -p -- "$BACKUP_ROOT"
mount_target=$(findmnt -n -o TARGET -T "$BACKUP_ROOT")
if [[ "$ALLOW_LOCAL_BACKUP" != 1 && "$mount_target" == / ]]; then
  fail "BACKUP_ROOT is on the system disk; mount an off-host/NAS/object-storage filesystem or explicitly set ALLOW_LOCAL_BACKUP=1 for a drill"
fi

exec 9>"$BACKUP_ROOT/.p4e-backup.lock"
flock -n 9 || fail 'another backup is already running'

stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp="$BACKUP_ROOT/.mathin-$stamp.partial"
final="$BACKUP_ROOT/mathin-$stamp"
cleanup() { rm -rf -- "$tmp"; }
trap cleanup EXIT
mkdir -- "$tmp"

start=$(date +%s)
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --no-owner >"$tmp/database.dump" || fail 'pg_dump failed'
tar -C "$STORAGE_DIR" -czf "$tmp/storage.tar.gz" . || fail 'Storage archive failed'

docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -Atqc \
  "select json_build_object(
    'students',(select count(*) from public.students),
    'orders',(select count(*) from public.orders),
    'payments',(select count(*) from public.payments),
    'domain_events',(select count(*) from public.domain_events),
    'schema_migrations',(select count(*) from public.schema_migrations),
    'storage_objects',(select count(*) from storage.objects)
  );" >"$tmp/database-counts.json" || fail 'database count manifest failed'

find "$STORAGE_DIR" -type f -printf '%P\t%s\n' | LC_ALL=C sort >"$tmp/storage-files.tsv"
(
  cd "$tmp"
  sha256sum database.dump storage.tar.gz database-counts.json storage-files.tsv >SHA256SUMS
)

end=$(date +%s)
cat >"$tmp/manifest.env" <<EOF
created_at=$stamp
host=$(hostname)
database=$DB_NAME
duration_seconds=$((end-start))
storage_bytes=$(awk -F '\t' '{sum+=$2} END{print sum+0}' "$tmp/storage-files.tsv")
storage_files=$(wc -l <"$tmp/storage-files.tsv")
EOF

mv -- "$tmp" "$final"
trap - EXIT
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'mathin-*' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
alert "Mathin P4E backup OK on $(hostname): $final ($((end-start))s)"
