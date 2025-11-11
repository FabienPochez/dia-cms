#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=${LOG_FILE:-/var/log/dia-cron/system-watch.log}
RUNQ_THRESHOLD=${RUNQ_THRESHOLD:-16}
SWAP_THRESHOLD_MB=${SWAP_THRESHOLD_MB:-512}
JOURNAL_WINDOW=${JOURNAL_WINDOW:-5 minutes}

timestamp=$(date -Is)
runq=$(awk '$1=="procs_running"{print $2}' /proc/stat)
swap_used_mb=$(free -m | awk '/^Swap:/ {print $3}')
oom_recent=$(journalctl -k --since "-${JOURNAL_WINDOW}" --no-pager 2>/dev/null | grep -i "Out of memory" || true)

mkdir -p "$(dirname "$LOG_FILE")"

status="OK"
notes=()

if (( runq > RUNQ_THRESHOLD )); then
  status="WARN"
  notes+=("runq>${RUNQ_THRESHOLD}")
fi

if (( swap_used_mb > SWAP_THRESHOLD_MB )); then
  status="WARN"
  notes+=("swap>${SWAP_THRESHOLD_MB}MB")
fi

if [[ -n "$oom_recent" ]]; then
  status="WARN"
  notes+=("oom_events=$(printf "%s" "$oom_recent" | wc -l)")
fi

note_summary="${notes[*]:-stable}"

printf '%s | status=%s runq=%s swap_used_mb=%s notes=%s\n' \
  "$timestamp" "$status" "$runq" "$swap_used_mb" "$note_summary" >> "$LOG_FILE"

if [[ "$status" != "OK" ]]; then
  logger -t dia-system-watch "status=$status runq=$runq swap=${swap_used_mb}MB notes=$note_summary"
  if [[ -n "$oom_recent" ]]; then
    printf '%s\n' "$oom_recent" >> "$LOG_FILE"
  fi
fi

