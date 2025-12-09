#!/bin/bash
# Monitor for malicious activity after security fixes
# This script watches for any signs of command injection or malicious processes

set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-payload-payload-1}"
LOG_FILE="${LOG_FILE:-/var/log/malicious-activity-monitor.log}"
ALERT_FILE="${ALERT_FILE:-/var/log/malicious-activity-alerts.log}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"

# Suspicious patterns to watch for
PATTERNS=(
  "curl.*-s.*-k"
  "wget.*--no-check-certificate"
  "repositorylinux"
  "setup2\\.sh"
  "176\\.117\\.107\\.158"
  "139\\.59\\.59\\.33"
  "curl.*linux\\.sh"
  "wget.*r\\.sh"
  "bash.*http"
  "sh.*http"
  "exec.*curl"
  "exec.*wget"
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
  echo "[$timestamp] 🚨 ALERT: $message" | tee -a "$ALERT_FILE"
  echo -e "${RED}🚨 ALERT: $message${NC}" >&2
}

check_processes() {
  local found_suspicious=false
  
  # Check for malicious processes
  local malicious_procs=$(docker exec "$CONTAINER_NAME" sh -c "ps" 2>&1 | grep -iE "curl|wget|repositorylinux" || true)
  
  if [ -n "$malicious_procs" ]; then
    found_suspicious=true
    alert "Malicious process detected in container"
    echo "$malicious_procs" | while IFS= read -r line; do
      alert "  Process: $line"
    done
  fi
  
  return $([ "$found_suspicious" = true ] && echo 1 || echo 0)
}

check_logs() {
  local found_suspicious=false
  
  # Get recent logs (last CHECK_INTERVAL seconds)
  local recent_logs=$(docker logs "$CONTAINER_NAME" --since "${CHECK_INTERVAL}s" 2>&1)
  
  for pattern in "${PATTERNS[@]}"; do
    if echo "$recent_logs" | grep -qiE "$pattern"; then
      found_suspicious=true
      local matches=$(echo "$recent_logs" | grep -iE "$pattern" | head -5)
      alert "Suspicious pattern in logs: $pattern"
      echo "$matches" | while IFS= read -r line; do
        alert "  Match: $line"
      done
    fi
  done
  
  return $([ "$found_suspicious" = true ] && echo 1 || echo 0)
}

main() {
  log_message "INFO" "Starting malicious activity monitor"
  log_message "INFO" "Monitoring container: $CONTAINER_NAME"
  log_message "INFO" "Check interval: ${CHECK_INTERVAL}s"
  log_message "INFO" "Alert file: $ALERT_FILE"
  
  local alert_count=0
  
  while true; do
    local has_alerts=false
    
    if check_processes; then
      has_alerts=true
      alert_count=$((alert_count + 1))
    fi
    
    if check_logs; then
      has_alerts=true
      alert_count=$((alert_count + 1))
    fi
    
    if [ "$has_alerts" = false ]; then
      log_message "INFO" "No suspicious activity detected (total alerts: $alert_count)"
    fi
    
    sleep "$CHECK_INTERVAL"
  done
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
