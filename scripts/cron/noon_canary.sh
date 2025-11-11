#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${PAYLOAD_CANARY_URL:-https://content.diaradio.live}
LOG_FILE=${LOG_FILE:-/var/log/dia-cron/noon-canary.log}

mkdir -p "$(dirname "$LOG_FILE")"

timestamp=$(date -Is)

deterministic_status=$(curl -fsS -o /dev/null -w '%{http_code}' "${BASE_URL}/api/schedule/deterministic?lookahead=120&maxItems=4" || echo "ERR")
admin_status=$(curl -fsS -o /dev/null -w '%{http_code}' "${BASE_URL}/admin" || echo "ERR")
preair_status=$(curl -fsS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/api/lifecycle/preair-rehydrate" || echo "ERR")

printf '%s | deterministic=%s admin=%s preair=%s\n' "$timestamp" "$deterministic_status" "$admin_status" "$preair_status" >> "$LOG_FILE"

if [[ "$deterministic_status" != "200" || "$admin_status" != "200" || "$preair_status" != "200" ]]; then
  logger -t dia-noon-canary "deterministic=$deterministic_status admin=$admin_status preair=$preair_status"
fi

