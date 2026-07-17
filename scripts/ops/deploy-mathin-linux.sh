#!/usr/bin/env bash
set -Eeuo pipefail

# Build an immutable standalone Mathin release for a Linux user service.
# Run this on the deployment host from an unpacked/cloned source tree.

source_root="${1:-$PWD}"
service_root="${MATHIN_SERVICE_ROOT:-$HOME/services/mathin}"
node_bin="${MATHIN_NODE_BIN:-$HOME/.local/bin/node}"
pnpm_bin="${MATHIN_PNPM_BIN:-$HOME/.local/bin/pnpm}"
runtime_env="$service_root/config/.env.production.local"

if [[ ! -d "$source_root" ]]; then
  echo "Source directory does not exist: $source_root" >&2
  exit 1
fi
if [[ ! -x "$node_bin" || ! -x "$pnpm_bin" ]]; then
  echo "Node or pnpm is unavailable; set MATHIN_NODE_BIN and MATHIN_PNPM_BIN." >&2
  exit 1
fi
if [[ ! -f "$runtime_env" ]]; then
  echo "Production environment file is missing: $runtime_env" >&2
  exit 1
fi

source_root="$(cd "$source_root" && pwd)"
service_root="$(mkdir -p "$service_root" && cd "$service_root" && pwd)"
releases_root="$service_root/releases"
release_id="$(date -u +%Y%m%d-%H%M%S)"
release_dir="$releases_root/$release_id"
release_tmp="$releases_root/.${release_id}.tmp"
source_env="$source_root/.env.production.local"
current_link="$service_root/current"
previous_link="$service_root/previous"
previous_release_id=""

exec 9>"$service_root/.deploy.lock"
if ! flock -n 9; then
  echo "Another Mathin deployment is already running." >&2
  exit 1
fi

if [[ -n "${MATHIN_RELEASE_COMMIT:-}" ]]; then
  if [[ "$MATHIN_RELEASE_COMMIT" =~ ^[0-9a-f]{40,64}$ ]]; then
    release_commit="$MATHIN_RELEASE_COMMIT"
  else
    echo "MATHIN_RELEASE_COMMIT must be a full Git commit SHA when set." >&2
    exit 1
  fi
elif git -C "$source_root" rev-parse --verify HEAD >/dev/null 2>&1; then
  release_commit="$(git -C "$source_root" rev-parse HEAD)"
else
  release_commit="unknown"
fi

mkdir -p "$releases_root"

if [[ -e "$current_link" && ! -L "$current_link" ]]; then
  echo "Refusing to replace a non-symlink current release path: $current_link" >&2
  exit 1
fi
if [[ -e "$previous_link" && ! -L "$previous_link" ]]; then
  echo "Refusing to replace a non-symlink previous release path: $previous_link" >&2
  exit 1
fi
if [[ -L "$current_link" ]]; then
  current_release="$(readlink -f "$current_link" || true)"
  case "$current_release" in
    "$releases_root"/*)
      previous_release_id="${current_release##*/}"
      ;;
    *)
      echo "Current release points outside the releases directory: $current_release" >&2
      exit 1
      ;;
  esac
fi

cleanup() {
  rm -f "$source_env"
  if [[ -d "$release_tmp" ]]; then
    rm -rf "$release_tmp"
  fi
}
trap cleanup EXIT

cp -p "$runtime_env" "$source_env"

(
  cd "$source_root"
  "$pnpm_bin" install --frozen-lockfile
  NODE_ENV=production "$pnpm_bin" build
)

mkdir -p "$release_tmp"
cp -a "$source_root/.next/standalone/." "$release_tmp/"
mkdir -p "$release_tmp/.next"
cp -a "$source_root/.next/static" "$release_tmp/.next/static"
if [[ -d "$source_root/public" ]]; then
  cp -a "$source_root/public" "$release_tmp/public"
fi

while IFS= read -r -d '' link; do
  resolved="$(readlink -f "$link" || true)"
  # Next's output-file tracing may preserve a few unused pnpm aggregate links
  # whose package is not traced into standalone. They are already broken in
  # the standalone output; only a resolvable link escaping this release is a
  # deployment isolation failure.
  if [[ -z "$resolved" ]]; then
    continue
  fi
  case "$resolved" in
    "$release_tmp"/*) ;;
    *)
      echo "Release dependency link escapes the release: $link -> $resolved" >&2
      exit 1
      ;;
  esac
done < <(find "$release_tmp/node_modules" -type l -print0)

cat > "$release_tmp/release.json" <<EOF
{"release":"$release_id","commit":"$release_commit","builtAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

mv "$release_tmp" "$release_dir"
ln -sfn "releases/$release_id" "$service_root/current.next"
mv -Tf "$service_root/current.next" "$current_link"

systemctl --user daemon-reload
systemctl --user restart mathin.service
systemctl --user --no-pager --full status mathin.service

for _ in {1..30}; do
  if curl --noproxy '*' -fsS --max-time 3 http://127.0.0.1:3131/api/health | grep -q '"status":"ok"'; then
    if [[ -n "$previous_release_id" ]]; then
      ln -sfn "releases/$previous_release_id" "$service_root/previous.next"
      mv -Tf "$service_root/previous.next" "$previous_link"
    fi
    exit 0
  fi
  sleep 1
done

echo "Mathin did not become healthy on 127.0.0.1:3131." >&2
if [[ -n "$previous_release_id" ]]; then
  echo "Restoring the previous release: $previous_release_id" >&2
  ln -sfn "releases/$previous_release_id" "$service_root/current.next"
  mv -Tf "$service_root/current.next" "$current_link"
  systemctl --user restart mathin.service
fi
exit 1
