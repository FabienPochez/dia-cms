#!/usr/bin/env bash
# common.sh - Shared functions for rsync benchmarking scripts

set -euo pipefail

# Configuration
REMOTE_BASE="/home/archive"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$BASE_DIR/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Generate timestamp for log files
timestamp() {
    date +"%Y%m%d_%H%M%S"
}

# Test SSH connectivity to bx-archive
assert_ssh() {
    if ! ssh bx-archive "pwd" >/dev/null 2>&1; then
        echo "ERROR: Cannot connect to bx-archive. Check SSH alias configuration." >&2
        exit 1
    fi
}

# Create remote directory if it doesn't exist
ensure_remote_dir() {
    local remote_path="$1"
    echo "→ Ensuring remote directory: $remote_path"
    ssh bx-archive "mkdir -p $remote_path"
    echo "✅ Remote directory ready"
}

# Build rsync command with specified cipher
build_rsync_cmd() {
    local cipher="$1"
    local src="$2"
    local dest="$3"
    local extra_flags="${4:-}"
    
    echo "env RSYNC_RSH='ssh -p 23 -o Compression=no -c $cipher' rsync -ah --partial --inplace --stats $extra_flags \"$src\" \"$dest\""
}

# Run timed rsync command
run_timed_rsync() {
    local cipher="$1"
    local src="$2"
    local dest="$3"
    local log_file="$4"
    local extra_flags="${5:-}"
    
    local rsync_cmd
    rsync_cmd=$(build_rsync_cmd "$cipher" "$src" "$dest" "$extra_flags")
    
    echo "→ Running: $rsync_cmd"
    /usr/bin/time -f 'ELAPSED=%E | CPU=%P' bash -c "$rsync_cmd" 2>&1 | tee "$log_file"
}
