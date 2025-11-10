#!/usr/bin/env bash
# bench_parallel.sh - Test total throughput with multiple parallel transfers
# Usage: bench_parallel.sh [--cipher aes|chacha] [--concurrency 4] [--count 4]

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Default values
CIPHER="chacha20-poly1305@openssh.com"
CONCURRENCY=4
COUNT=4

usage() {
    echo "Usage: $0 [--cipher aes|chacha] [--concurrency N] [--count N]"
    echo ""
    echo "Test total throughput with multiple parallel transfers"
    echo ""
    echo "Options:"
    echo "  --cipher       Cipher to use: aes or chacha (default: chacha)"
    echo "  --concurrency  Number of parallel transfers (default: 4)"
    echo "  --count        Number of files to transfer (default: 4)"
    echo "  --help         Show this help"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 --cipher aes --concurrency 2 --count 3"
    echo "  $0 --cipher chacha --concurrency 8 --count 4"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --cipher)
            case "$2" in
                aes)
                    CIPHER="aes128-gcm@openssh.com"
                    ;;
                chacha)
                    CIPHER="chacha20-poly1305@openssh.com"
                    ;;
                *)
                    echo "ERROR: Invalid cipher '$2'. Use 'aes' or 'chacha'." >&2
                    exit 1
                    ;;
            esac
            shift 2
            ;;
        --concurrency)
            CONCURRENCY="$2"
            if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [[ "$CONCURRENCY" -lt 1 ]]; then
                echo "ERROR: Concurrency must be a positive integer" >&2
                exit 1
            fi
            shift 2
            ;;
        --count)
            COUNT="$2"
            if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [[ "$COUNT" -lt 1 ]]; then
                echo "ERROR: Count must be a positive integer" >&2
                exit 1
            fi
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument '$1'" >&2
            usage
            exit 1
            ;;
    esac
done

TS=$(timestamp)

echo "=== rsync Parallel Throughput Benchmark ==="
echo "Cipher: $CIPHER"
echo "Concurrency: $CONCURRENCY"
echo "File count: $COUNT"
echo "Timestamp: $TS"
echo ""

# Test SSH connectivity
echo "→ Testing SSH connectivity..."
assert_ssh
echo "✅ SSH connection successful"

# Get list of files to transfer
echo "→ Selecting files from staging directory..."
FILES=($(ls /srv/media/staging/*.mp3 | sort | head -n "$COUNT"))

if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "ERROR: No MP3 files found in /srv/media/staging/" >&2
    exit 1
fi

echo "Selected files:"
for file in "${FILES[@]}"; do
    echo "  $(basename "$file") ($(du -h "$file" | cut -f1))"
done
echo ""

# Ensure remote directory exists
ensure_remote_dir "$REMOTE_BASE/bench/parallel"

# Create parallel transfer function
transfer_file() {
    local file="$1"
    local filename=$(basename "$file")
    local dest="bx-archive:$REMOTE_BASE/bench/parallel/$filename"
    local log_file="$LOG_DIR/bench-parallel-$TS-$filename.log"
    
    echo "→ Transferring $filename..."
    /usr/bin/time -f 'ELAPSED=%E' bash -c "$(build_rsync_cmd "$CIPHER" "$file" "$dest")" 2>&1 | tee "$log_file"
}

export -f transfer_file build_rsync_cmd
export CIPHER REMOTE_BASE LOG_DIR TS

echo "→ Starting parallel transfers..."
START_TIME=$(date +%s)

# Run parallel transfers
printf '%s\n' "${FILES[@]}" | xargs -I{} -P "$CONCURRENCY" bash -c 'transfer_file "$@"' _ {}

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

echo ""
echo "=== Results Summary ==="
echo "Total time: ${TOTAL_TIME}s"
echo "Files transferred: ${#FILES[@]}"
echo "Concurrency: $CONCURRENCY"
echo "Cipher: $CIPHER"
echo ""
echo "Individual file results:"
for file in "${FILES[@]}"; do
    filename=$(basename "$file")
    log_file="$LOG_DIR/bench-parallel-$TS-$filename.log"
    if [[ -f "$log_file" ]]; then
        echo "  $filename: $(grep 'ELAPSED=' "$log_file" | tail -1)"
    fi
done
echo ""
echo "Log files: $LOG_DIR/bench-parallel-$TS-*.log"
echo "✅ Parallel benchmark completed"
