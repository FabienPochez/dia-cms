#!/bin/bash
# Active Threat Monitoring Script
# Monitors for malware reappearance and suspicious activity
# Run continuously to catch persistence mechanisms

set -euo pipefail

LOG_FILE="/var/log/active-threat-monitor.log"
ALERT_LOG="/var/log/active-threat-alerts.log"
CHECK_INTERVAL=30  # Check every 30 seconds
MONITOR_DURATION=${1:-7200}  # Default 2 hours, can override

# Malware indicators
MALWARE_PROCESSES=("hash" "javs" "dockerd" "docker-daemon" "sex.sh" "xmrig" "miner" "crypto")
MALWARE_FILES=("hash" "javs" "dockerd" "docker-daemon" "sex.sh")
MONITOR_DIRS=("/srv/payload" "/var/tmp" "/tmp" "/root" "/usr/local/bin" "/opt")
MINING_POOLS=("auto.c3pool.org" "c3pool.com" "hashvault.pro" "moneroocean.stream")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Create log directory
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$ALERT_LOG")"

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S UTC")
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

alert() {
    local message="$1"
    log "ALERT" "$message"
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%S UTC")] $message" >> "$ALERT_LOG"
    
    # Log to syslog
    logger -t active-threat-monitor "ALERT: $message"
    
    # Print colored alert
    echo -e "${RED}🚨 ALERT: $message${NC}" >&2
}

check_malware_processes() {
    local found=0
    for proc in "${MALWARE_PROCESSES[@]}"; do
        # Exclude legitimate dockerd
        if [ "$proc" = "dockerd" ]; then
            local suspicious=$(ps aux | grep -iE "\b$proc\b" | grep -vE "grep|/usr/bin/dockerd" || true)
        else
            local suspicious=$(ps aux | grep -iE "\b$proc\b" | grep -v grep || true)
        fi
        
        if [ -n "$suspicious" ]; then
            alert "Suspicious process detected: $proc"
            echo "$suspicious" | while read line; do
                alert "  Process details: $line"
            done
            found=1
        fi
    done
    return $found
}

check_malware_files() {
    local found=0
    for dir in "${MONITOR_DIRS[@]}"; do
        [ ! -d "$dir" ] && continue
        
        for file in "${MALWARE_FILES[@]}"; do
            local full_path="$dir/$file"
            if [ -f "$full_path" ]; then
                local file_info=$(stat -c "%s %y %U:%G" "$full_path" 2>/dev/null || echo "unknown")
                alert "Malware file detected: $full_path (Size: $(echo $file_info | cut -d' ' -f1) bytes, Modified: $(echo $file_info | cut -d' ' -f2-3), Owner: $(echo $file_info | cut -d' ' -f4))"
                
                # Check if file is executable
                if [ -x "$full_path" ]; then
                    alert "  ⚠️  File is executable!"
                    local proc_info=$(lsof "$full_path" 2>/dev/null || true)
                    if [ -n "$proc_info" ]; then
                        alert "  File is being used by processes:"
                        echo "$proc_info" | while read line; do
                            alert "    $line"
                        done
                    fi
                fi
                found=1
            fi
        done
    done
    return $found
}

check_suspicious_network() {
    local found=0
    
    # Check for connections to mining pools
    for pool in "${MINING_POOLS[@]}"; do
        local connections=$(ss -tuna 2>/dev/null | grep -i "$pool" || true)
        if [ -n "$connections" ]; then
            alert "Suspicious network connection to mining pool: $pool"
            echo "$connections" | while read line; do
                alert "  Connection: $line"
            done
            found=1
        fi
    done
    
    # Check for high outbound connections (potential C2)
    local outbound_count=$(ss -tuna 2>/dev/null | grep ESTAB | grep -v "127.0.0.1\|::1" | wc -l)
    if [ "$outbound_count" -gt 50 ]; then
        alert "High number of outbound connections detected: $outbound_count"
        found=1
    fi
    
    return $found
}

check_high_resource_usage() {
    local found=0
    
    # Check for processes using >80% CPU
    local high_cpu=$(ps aux --sort=-%cpu | awk 'NR>1 && $3 > 80.0 && $11 !~ /^(systemd|kthreadd|ksoftirqd|migration|rcu_|watchdog|containerd|dockerd|mongod|postgres|nginx|node|python|php-fpm|gunicorn|libretime|icecast|rabbitmq)/ {print $3"% CPU - PID:"$2" - "$11" "$12" "$13}' | head -5)
    
    if [ -n "$high_cpu" ]; then
        alert "High CPU usage detected:"
        echo "$high_cpu" | while read line; do
            alert "  $line"
        done
        found=1
    fi
    
    # Check for processes using >2GB RAM
    local high_mem=$(ps aux --sort=-%mem | awk 'NR>1 && $6 > 2097152 && $11 !~ /^(systemd|kthreadd|containerd|dockerd|mongod|postgres|nginx|node|python|php-fpm|gunicorn|libretime|icecast|rabbitmq)/ {printf "%.1fGB RAM - PID:%s - %s %s %s\n", $6/1024/1024, $2, $11, $12, $13}' | head -5)
    
    if [ -n "$high_mem" ]; then
        alert "High memory usage detected:"
        echo "$high_mem" | while read line; do
            alert "  $line"
        done
        found=1
    fi
    
    return $found
}

check_new_executables() {
    local found=0
    local check_file="/tmp/.monitor-executables-$$"
    
    # Track executables in monitored directories
    for dir in "${MONITOR_DIRS[@]}"; do
        [ ! -d "$dir" ] && continue
        
        find "$dir" -type f -executable -newer "$check_file" 2>/dev/null | while read exec_file; do
            # Skip known legitimate files
            if [[ "$exec_file" =~ (node_modules|\.git|\.next|\.cursor|\.vscode) ]]; then
                continue
            fi
            
            alert "New executable file detected: $exec_file"
            local file_info=$(stat -c "%s %y %U:%G" "$exec_file" 2>/dev/null || echo "unknown")
            alert "  Details: Size: $(echo $file_info | cut -d' ' -f1) bytes, Modified: $(echo $file_info | cut -d' ' -f2-3), Owner: $(echo $file_info | cut -d' ' -f4)"
            found=1
        done
    done
    
    # Update check file
    touch "$check_file"
    
    return $found
}

check_docker_containers() {
    local found=0
    
    # Check for new containers
    local new_containers=$(docker ps -a --format "{{.Names}}\t{{.CreatedAt}}" | awk -v cutoff="$(date -d '5 minutes ago' -Iseconds)" '$2 > cutoff {print $1}')
    
    if [ -n "$new_containers" ]; then
        alert "New Docker containers created in last 5 minutes:"
        echo "$new_containers" | while read container; do
            alert "  Container: $container"
        done
        found=1
    fi
    
    # Check for suspicious container processes
    docker ps --format "{{.Names}}" | while read container; do
        local suspicious=$(docker exec "$container" ps aux 2>/dev/null | grep -iE "hash|javs|miner|xmrig|crypto" | grep -v grep || true)
        if [ -n "$suspicious" ]; then
            alert "Suspicious process in container $container:"
            echo "$suspicious" | while read line; do
                alert "  $line"
            done
            found=1
        fi
    done
    
    return $found
}

# Main monitoring loop
main() {
    local start_time=$(date +%s)
    local end_time=$((start_time + MONITOR_DURATION))
    local check_count=0
    local alert_count=0
    
    log "INFO" "Starting active threat monitoring"
    log "INFO" "Monitoring duration: $MONITOR_DURATION seconds ($(($MONITOR_DURATION / 60)) minutes)"
    log "INFO" "Check interval: $CHECK_INTERVAL seconds"
    log "INFO" "Monitoring directories: ${MONITOR_DIRS[*]}"
    log "INFO" "Monitoring processes: ${MALWARE_PROCESSES[*]}"
    
    # Create initial check file for new executables
    touch "/tmp/.monitor-executables-$$"
    
    while [ $(date +%s) -lt $end_time ]; do
        check_count=$((check_count + 1))
        local current_time=$(date -u +"%Y-%m-%dT%H:%M:%S UTC")
        local elapsed=$(( $(date +%s) - start_time ))
        local remaining=$(( end_time - $(date +%s) ))
        
        if [ $((check_count % 20)) -eq 0 ]; then
            log "INFO" "Monitoring active... (Check #$check_count, Elapsed: ${elapsed}s, Remaining: ${remaining}s)"
        fi
        
        # Run all checks
        local alerts_found=0
        
        check_malware_processes && alerts_found=1
        check_malware_files && alerts_found=1
        check_suspicious_network && alerts_found=1
        check_high_resource_usage && alerts_found=1
        check_new_executables && alerts_found=1
        check_docker_containers && alerts_found=1
        
        if [ $alerts_found -eq 1 ]; then
            alert_count=$((alert_count + 1))
        fi
        
        # Sleep until next check
        sleep "$CHECK_INTERVAL"
    done
    
    log "INFO" "Monitoring completed"
    log "INFO" "Total checks: $check_count"
    log "INFO" "Total alerts: $alert_count"
    
    # Cleanup
    rm -f "/tmp/.monitor-executables-$$"
    
    if [ $alert_count -gt 0 ]; then
        alert "Monitoring session completed with $alert_count alert(s) - Review $ALERT_LOG"
        exit 1
    else
        log "INFO" "No threats detected during monitoring period"
        exit 0
    fi
}

# Handle signals
trap 'log "INFO" "Monitoring interrupted by signal"; exit 130' INT TERM

# Run main function
main "$@"

