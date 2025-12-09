#!/bin/bash
# Monitor command execution for suspicious patterns
# This script watches Payload logs for command injection attempts
# and alerts on suspicious command patterns

set -euo pipefail

LOG_FILE="${LOG_FILE:-/var/log/command-execution-monitor.log}"
ALERT_FILE="${ALERT_FILE:-/var/log/command-execution-alerts.log}"
CONTAINER_NAME="${CONTAINER_NAME:-payload-payload-1}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"

# Suspicious patterns to watch for
PATTERNS=(
  "curl.*-s.*-k"
  "wget.*--no-check-certificate"
  "repositorylinux"
  "setup2\.sh"
  "176\.117\.107\.158"
  "139\.59\.59\.33"
  "curl.*linux\.sh"
  "wget.*r\.sh"
  "bash.*http"
  "sh.*http"
)

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

log_message() {
  local level=$1
  shift
  local message="$*"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

alert() {
  local message="$*"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] ALERT: $message" | tee -a "$ALERT_FILE"
  echo -e "${RED}🚨 ALERT: $message${NC}" >&2
}

check_logs() {
  local found_suspicious=false
  
  # Get recent logs (last CHECK_INTERVAL seconds)
  local recent_logs=$(docker logs "$CONTAINER_NAME" --since "${CHECK_INTERVAL}s" 2>&1)
  
  for pattern in "${PATTERNS[@]}"; do
    if echo "$recent_logs" | grep -qiE "$pattern"; then
      found_suspicious=true
      local matches=$(echo "$recent_logs" | grep -iE "$pattern" | head -5)
      alert "Suspicious pattern detected: $pattern"
      echo "$matches" | while IFS= read -r line; do
        alert "  Match: $line"
      done
    fi
  done
  
  # Check for exec/execFile calls with suspicious arguments
  if echo "$recent_logs" | grep -qiE "exec.*curl|exec.*wget|exec.*bash.*http|exec.*sh.*http"; then
    found_suspicious=true
    local matches=$(echo "$recent_logs" | grep -iE "exec.*curl|exec.*wget|exec.*bash.*http|exec.*sh.*http" | head -5)
    alert "Suspicious exec() call detected"
    echo "$matches" | while IFS= read -r line; do
      alert "  Match: $line"
    done
  fi
  
  if [ "$found_suspicious" = false ]; then
    log_message "INFO" "No suspicious patterns detected in last ${CHECK_INTERVAL}s"
  fi
}

main() {
  log_message "INFO" "Starting command execution monitor"
  log_message "INFO" "Monitoring container: $CONTAINER_NAME"
  log_message "INFO" "Check interval: ${CHECK_INTERVAL}s"
  log_message "INFO" "Alert file: $ALERT_FILE"
  
  while true; do
    check_logs
    sleep "$CHECK_INTERVAL"
  done
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
