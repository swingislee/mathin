#!/usr/bin/env bash
set -Eeuo pipefail

# Install or upgrade the loopback-only Pix2Text service on the Xiaomi host.
# Run from a committed Mathin source tree after enabling the host's proxy.

source_root="${1:-$PWD}"
service_root="${MATHIN_FORMULA_OCR_ROOT:-$HOME/services/mathin-formula-ocr}"
compose_source="$source_root/deploy/formula-ocr/compose.yml"
dockerfile_source="$source_root/deploy/formula-ocr/Dockerfile"

if [[ ! -f "$compose_source" || ! -f "$dockerfile_source" ]]; then
  echo "Formula OCR deployment files are missing under: $source_root/deploy/formula-ocr" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required on the deployment host." >&2
  exit 1
fi

service_root="$(mkdir -p "$service_root" && cd "$service_root" && pwd)"
model_root="$service_root/models"
mkdir -p "$model_root/huggingface"
chmod 700 "$service_root" "$model_root" "$model_root/huggingface"

exec 9>"$service_root/.deploy.lock"
if ! flock -n 9; then
  echo "Another Formula OCR deployment is already running." >&2
  exit 1
fi

install -m 0644 "$compose_source" "$service_root/compose.yml"
install -m 0644 "$dockerfile_source" "$service_root/Dockerfile"

export MATHIN_FORMULA_OCR_MODEL_ROOT="$model_root"
export MATHIN_FORMULA_OCR_UID="$(id -u)"
export MATHIN_FORMULA_OCR_GID="$(id -g)"
export HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}"
export HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-}}"

docker compose -f "$service_root/compose.yml" build --pull
docker compose -f "$service_root/compose.yml" up -d --remove-orphans

for _ in {1..90}; do
  if curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:8503/docs >/dev/null; then
    listeners="$(ss -ltnH 'sport = :8503')"
    if grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\[::\]):8503([[:space:]]|$)' <<<"$listeners"; then
      echo "Formula OCR unexpectedly listens on a wildcard interface." >&2
      exit 1
    fi
    if ! grep -Eq '(^|[[:space:]])(127\.0\.0\.1|\[::1\]):8503([[:space:]]|$)' <<<"$listeners"; then
      echo "Formula OCR did not bind the loopback interface." >&2
      exit 1
    fi
    docker compose -f "$service_root/compose.yml" ps
    echo "Formula OCR is ready at http://127.0.0.1:8503/pix2text"
    exit 0
  fi
  sleep 10
done

docker compose -f "$service_root/compose.yml" logs --tail=200 formula-ocr >&2
echo "Formula OCR did not become healthy within 15 minutes." >&2
exit 1
