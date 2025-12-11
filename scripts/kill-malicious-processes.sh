#!/bin/bash
# Kill Malicious Processes Script
# Temporary security measure to detect and kill malicious processes
# Run continuously or as a one-time check

set -euo pipefail

LOG_FILE="/var/log/kill-malicious-processes.log"
ALERT_LOG="/var/log/malicious-processes-killed.log"
CHECK_INTERVAL=${CHECK_INTERVAL:-30}  # Check every 30 seconds by default
DRY_RUN=${DRY_RUN:-false}  # Set to "true" to only log without killing
CONTINUOUS_MODE=${CONTINUOUS_MODE:-true}  # Run continuously by default

# Malicious process patterns to detect and kill
# Includes latest attack patterns: x86, reactOnMynuts, bolts
MALWARE_PROCESSES=("xmrig" "miner" "sex.sh" "javs" "hash" "crypto" "x86" "reactOnMynuts" "bolts")
MALWARE_FILES=("sex.sh" "javs" "dockerd" "docker-daemon" "hash" "x86" "bolts")
MONITOR_DIRS=("/srv/payload" "/var/tmp" "/tmp" "/root" "/usr/local/bin" "/opt" "/dev")

# Suspicious directories where processes should not normally run from
SUSPICIOUS_DIRS=("/dev" "/proc")

# Legitimate processes to exclude (don't kill these)
LEGITIMATE_PROCESSES=("/usr/bin/dockerd" "/usr/local/bin/dockerd" "/usr/sbin/dockerd")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create log directory if it doesn't exist
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
    logger -t kill-malicious-processes "ALERT: $message"
    
    # Print colored alert
    echo -e "${RED}🚨 $message${NC}" >&2
}

success() {
    local message="$1"
    log "SUCCESS" "$message"
    echo -e "${GREEN}✅ $message${NC}"
}

warning() {
    local message="$1"
    log "WARNING" "$message"
    echo -e "${YELLOW}⚠️  $message${NC}"
}

# Check if a process is legitimate (should not be killed)
is_legitimate_process() {
    local pid="$1"
    local cmdline="$2"
    
    for legit in "${LEGITIMATE_PROCESSES[@]}"; do
        if [[ "$cmdline" == *"$legit"* ]]; then
            return 0  # Is legitimate
        fi
    done
    
    return 1  # Not legitimate
}

# Kill a malicious process
kill_malicious_process() {
    local pid="$1"
    local cmdline="$2"
    local proc_name="$3"
    
    # Check if process still exists
    if ! kill -0 "$pid" 2>/dev/null; then
        warning "Process $pid ($proc_name) no longer exists, skipping"
        return 0
    fi
    
    # Get process details before killing
    local proc_info=$(ps -p "$pid" -o pid,ppid,user,cmd --no-headers 2>/dev/null || echo "unknown")
    local proc_user=$(ps -p "$pid" -o user --no-headers 2>/dev/null || echo "unknown")
    
    if [ "$DRY_RUN" = "true" ]; then
        alert "DRY RUN: Would kill process PID=$pid ($proc_name) - User: $proc_user - Cmd: $cmdline"
        return 0
    fi
    
    # Try graceful kill first (SIGTERM)
    if kill -TERM "$pid" 2>/dev/null; then
        alert "Sent SIGTERM to malicious process PID=$pid ($proc_name) - User: $proc_user"
        log "INFO" "Process details: $proc_info"
        
        # Wait a moment for graceful shutdown
        sleep 2
        
        # Check if still running, force kill if needed
        if kill -0 "$pid" 2>/dev/null; then
            warning "Process $pid still running after SIGTERM, force killing with SIGKILL"
            kill -KILL "$pid" 2>/dev/null || true
            alert "Force killed malicious process PID=$pid ($proc_name) with SIGKILL"
        else
            success "Process PID=$pid ($proc_name) terminated gracefully"
        fi
    else
        # If TERM fails, try KILL directly
        warning "Failed to send SIGTERM to PID=$pid, trying SIGKILL"
        kill -KILL "$pid" 2>/dev/null || true
        alert "Force killed malicious process PID=$pid ($proc_name) with SIGKILL"
    fi
    
    # Verify process is dead
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        alert "WARNING: Process PID=$pid may still be running after kill attempt"
        return 1
    else
        success "Confirmed: Process PID=$pid ($proc_name) is terminated"
        return 0
    fi
}

# Check for malicious processes by name pattern
check_malware_processes() {
    local killed_count=0
    
    for proc_pattern in "${MALWARE_PROCESSES[@]}"; do
        # Special handling for dockerd - exclude legitimate one
        if [ "$proc_pattern" = "dockerd" ] || [ "$proc_pattern" = "docker-daemon" ]; then
            # Find dockerd processes but exclude legitimate ones
            local processes=$(ps aux | grep -iE "\b$proc_pattern\b" | grep -vE "grep|/usr/bin/dockerd|/usr/local/bin/dockerd|/usr/sbin/dockerd" || true)
        else
            # Find processes matching pattern
            local processes=$(ps aux | grep -iE "\b$proc_pattern\b" | grep -v grep || true)
        fi
        
        if [ -n "$processes" ]; then
            echo "$processes" | while read line; do
                # Extract PID (second column in ps aux output)
                local pid=$(echo "$line" | awk '{print $2}')
                local cmdline=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
                
                # Skip if empty PID
                [ -z "$pid" ] && continue
                
                # Skip if PID is not a number
                [[ ! "$pid" =~ ^[0-9]+$ ]] && continue
                
                # Check if legitimate process
                if is_legitimate_process "$pid" "$cmdline"; then
                    log "INFO" "Skipping legitimate process PID=$pid: $cmdline"
                    continue
                fi
                
                # Kill the malicious process
                if kill_malicious_process "$pid" "$cmdline" "$proc_pattern"; then
                    killed_count=$((killed_count + 1))
                fi
            done
        fi
    done
    
    return $killed_count
}

# Check for processes running malicious files
check_malware_file_processes() {
    local killed_count=0
    
    for dir in "${MONITOR_DIRS[@]}"; do
        [ ! -d "$dir" ] && continue
        
        for file in "${MALWARE_FILES[@]}"; do
            local full_path="$dir/$file"
            
            if [ -f "$full_path" ]; then
                # Find processes using this file
                local processes=$(lsof "$full_path" 2>/dev/null | grep -v COMMAND || true)
                
                if [ -n "$processes" ]; then
                    alert "Found processes using malicious file: $full_path"
                    
                    echo "$processes" | while read line; do
                        # Extract PID (second column in lsof output)
                        local pid=$(echo "$line" | awk '{print $2}')
                        local proc_name=$(echo "$line" | awk '{print $1}')
                        local cmdline=$(ps -p "$pid" -o cmd --no-headers 2>/dev/null || echo "unknown")
                        
                        # Skip if empty PID
                        [ -z "$pid" ] && continue
                        [[ ! "$pid" =~ ^[0-9]+$ ]] && continue
                        
                        # Kill the process
                        if kill_malicious_process "$pid" "$cmdline" "$proc_name"; then
                            killed_count=$((killed_count + 1))
                        fi
                    done
                fi
            fi
        done
    done
    
    return $killed_count
}

# Check for processes with suspicious command patterns
check_suspicious_command_patterns() {
    local killed_count=0
    
    # Patterns that indicate malicious activity (including latest attack patterns)
    local suspicious_patterns=(
        "wget.*193\.34\.213\.150"
        "wget.*216\.158\.232\.43"
        "curl.*193\.34\.213\.150"
        "curl.*216\.158\.232\.43"
        "busybox.*wget"
        "\./x86.*reactOnMynuts"
        "x86.*reactOnMynuts"
        "reactOnMynuts"
        "pool\.hashvault\.pro"
        "auto\.c3pool\.org"
        "c3pool\.com"
        "moneroocean\.stream"
        "193\.34\.213\.150"
        "216\.158\.232\.43"
        "cd /dev.*busybox"
        "chmod 777.*x86"
    )
    
    for pattern in "${suspicious_patterns[@]}"; do
        local processes=$(ps aux | grep -iE "$pattern" | grep -v grep || true)
        
        if [ -n "$processes" ]; then
            alert "Found process with suspicious command pattern: $pattern"
            
            echo "$processes" | while read line; do
                local pid=$(echo "$line" | awk '{print $2}')
                local cmdline=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
                
                [ -z "$pid" ] && continue
                [[ ! "$pid" =~ ^[0-9]+$ ]] && continue
                
                if kill_malicious_process "$pid" "$cmdline" "suspicious-pattern"; then
                    killed_count=$((killed_count + 1))
                fi
            done
        fi
    done
    
    return $killed_count
}

# Check for processes running from suspicious directories
check_suspicious_location_processes() {
    local killed_count=0
    
    for sus_dir in "${SUSPICIOUS_DIRS[@]}"; do
        # Find processes with executable path in suspicious directory
        # Get all processes and filter for those running from suspicious directory
        local processes=$(ps aux | awk -v dir="$sus_dir" '
            NR > 1 && $11 ~ "^" dir "/" {
                # Exclude legitimate system processes
                if ($11 !~ /^(\/dev\/null|\/dev\/zero|\/dev\/urandom|\/dev\/random|\/proc\/self|\/proc\/thread-self)/) {
                    print
                }
            }' || true)
        
        if [ -n "$processes" ]; then
            alert "Found process running from suspicious directory: $sus_dir"
            
            echo "$processes" | while read line; do
                local pid=$(echo "$line" | awk '{print $2}')
                local cmdline=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
                local exe_path=$(echo "$line" | awk '{print $11}')
                
                [ -z "$pid" ] && continue
                [[ ! "$pid" =~ ^[0-9]+$ ]] && continue
                
                # Skip if it's a legitimate system process
                if [[ "$exe_path" =~ ^(/dev/null|/dev/zero|/dev/urandom|/dev/random|/proc/self|/proc/thread-self) ]]; then
                    log "INFO" "Skipping legitimate system process from $sus_dir: PID=$pid"
                    continue
                fi
                
                # Additional check: skip if process name looks legitimate
                local proc_name=$(basename "$exe_path" 2>/dev/null || echo "")
                if [[ "$proc_name" =~ ^(sh|bash|dash|zsh|ksh)$ ]]; then
                    # Check if it's running a script from suspicious location
                    if [[ "$cmdline" =~ \.(sh|bash)$ ]] || [[ "$cmdline" =~ ^(sh|bash|\./) ]]; then
                        # This might be malicious, don't skip
                        :
                    else
                        log "INFO" "Skipping shell process from $sus_dir: PID=$pid"
                        continue
                    fi
                fi
                
                if kill_malicious_process "$pid" "$cmdline" "suspicious-location-$sus_dir"; then
                    killed_count=$((killed_count + 1))
                fi
            done
        fi
    done
    
    return $killed_count
}

# Main execution function
run_check() {
    local total_killed=0
    local check_time=$(date -u +"%Y-%m-%dT%H:%M:%S UTC")
    
    log "INFO" "Starting malicious process check at $check_time"
    
    if [ "$DRY_RUN" = "true" ]; then
        warning "DRY RUN MODE: No processes will actually be killed"
    fi
    
    # Check for malicious processes
    local killed1=0
    check_malware_processes && killed1=$? || killed1=$?
    total_killed=$((total_killed + killed1))
    
    # Check for processes using malicious files
    local killed2=0
    check_malware_file_processes && killed2=$? || killed2=$?
    total_killed=$((total_killed + killed2))
    
    # Check for suspicious command patterns
    local killed3=0
    check_suspicious_command_patterns && killed3=$? || killed3=$?
    total_killed=$((total_killed + killed3))
    
    # Check for processes running from suspicious locations
    local killed4=0
    check_suspicious_location_processes && killed4=$? || killed4=$?
    total_killed=$((total_killed + killed4))
    
    if [ $total_killed -gt 0 ]; then
        alert "Killed $total_killed malicious process(es) in this check"
    else
        log "INFO" "No malicious processes detected"
    fi
    
    return $total_killed
}

# Continuous monitoring mode
run_continuous() {
    log "INFO" "Starting continuous malicious process monitoring"
    log "INFO" "Check interval: $CHECK_INTERVAL seconds"
    log "INFO" "Monitoring processes: ${MALWARE_PROCESSES[*]}"
    log "INFO" "Monitoring files: ${MALWARE_FILES[*]}"
    log "INFO" "Monitoring directories: ${MONITOR_DIRS[*]}"
    log "INFO" "Suspicious directories: ${SUSPICIOUS_DIRS[*]}"
    
    if [ "$DRY_RUN" = "true" ]; then
        warning "DRY RUN MODE ENABLED - No processes will be killed"
    fi
    
    local total_killed=0
    local check_count=0
    
    # Handle interrupt signals
    trap 'log "INFO" "Monitoring stopped by user"; exit 0' INT TERM
    
    while true; do
        check_count=$((check_count + 1))
        
        # Run check
        local killed=0
        run_check && killed=$? || killed=$?
        total_killed=$((total_killed + killed))
        
        # Log status every 10 checks
        if [ $((check_count % 10)) -eq 0 ]; then
            log "INFO" "Monitoring active... (Check #$check_count, Total killed: $total_killed)"
        fi
        
        # Sleep until next check
        sleep "$CHECK_INTERVAL"
    done
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Kill malicious processes detected on the system.

OPTIONS:
    -c, --continuous    Run continuously (default: enabled, checks every 30 seconds)
    --once, --one-time  Run one-time check and exit
    -i, --interval SEC  Check interval in seconds (default: 30, only for continuous mode)
    -d, --dry-run       Only log, don't actually kill processes
    -h, --help          Show this help message

EXAMPLES:
    # Continuous monitoring (default, checks every 30 seconds)
    $0
    
    # One-time check
    $0 --once
    
    # Continuous monitoring with custom interval (check every 10 seconds)
    $0 --interval 10
    
    # Dry run (test without killing)
    $0 --dry-run
    
    # Run as background service
    nohup $0 > /dev/null 2>&1 &

LOG FILES:
    - $LOG_FILE (all activity)
    - $ALERT_LOG (only kills/alerts)

EOF
}

# Parse command line arguments
# Default to continuous mode unless --once is specified
CONTINUOUS=$CONTINUOUS_MODE

while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--continuous)
            CONTINUOUS=true
            shift
            ;;
        --once|--one-time)
            CONTINUOUS=false
            shift
            ;;
        -i|--interval)
            CHECK_INTERVAL="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Check if running as root (recommended for killing processes)
if [ "$EUID" -ne 0 ] && [ "$DRY_RUN" != "true" ]; then
    warning "Not running as root. Some processes may not be killable."
    warning "Consider running with: sudo $0 $*"
fi

# Run in appropriate mode
if [ "$CONTINUOUS" = "true" ]; then
    run_continuous
else
    run_check
    exit $?
fi


