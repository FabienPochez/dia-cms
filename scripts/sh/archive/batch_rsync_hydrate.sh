#!/usr/bin/env bash
# batch_rsync_hydrate.sh - Batch transfer files with parallel processing + JSONL logging
# Usage: batch_rsync_hydrate.sh <local_dir_or_glob> <remote_rel_dir> [options]

set -euo pipefail

# Get script directory for absolute paths
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
CONCURRENCY=2
VERIFY_RATE=0
APPLY=false
RETRIES=2
BWLIMIT=""
ALLOW_OUTSIDE_STAGING=true  # Default to true since this script works with /srv/media/imported/

# NEW: Log configuration
LOG_DIR="/srv/media/logs"
LOG_FILE="${LOG_DIR}/rsync-archive-success.jsonl"

usage() {
    echo "Usage: $0 <local_dir_or_glob> <remote_rel_dir> [options]"
    echo ""
    echo "Batch transfer files with parallel processing + JSONL logging (default: concurrency=2)"
    echo ""
    echo "Arguments:"
    echo "  local_dir_or_glob  Local directory or glob pattern (e.g., /srv/media/imported/1 or /srv/media/imported/1/*.mp3)"
    echo "  remote_rel_dir     Remote directory under /home/archive/ (e.g., legacy, 2025-10)"
    echo ""
    echo "Options:"
    echo "  --concurrency N    Number of parallel transfers (default: 2)"
    echo "  --verify-rate M    Verify every M-th file (0=disabled, default: 0)"
    echo "  --apply            Perform actual transfers (default: dry-run)"
    echo "  --retries N        Number of retries per file (default: 2)"
    echo "  --bwlimit RATE     Bandwidth limit (e.g., 8M, 1000K)"
    echo "  --list FILE        Read file list from FILE (one per line)"
    echo "  --allow-outside-staging  Allow files outside /srv/media/staging/"
    echo "  --log-file FILE    Custom log file path (default: $LOG_FILE)"
    echo "  --help             Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 /srv/media/imported/1 legacy --apply"
    echo "  $0 /srv/media/imported/1/*.mp3 2025-10 --apply --verify-rate 10"
    echo "  $0 --list files.txt legacy --apply --concurrency 4"
    echo ""
    echo "Logging:"
    echo "  Success log: $LOG_FILE"
    echo "  Next step: Run hydration script"
    echo "    docker exec payload-dev-scripts-1 sh -lc 'npx tsx scripts/hydrate-archive-paths.ts --log $LOG_FILE'"
}

# Parse arguments
LOCAL_INPUT=""
REMOTE_REL_DIR=""
FILE_LIST=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --concurrency)
            CONCURRENCY="$2"
            if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [[ "$CONCURRENCY" -lt 1 ]]; then
                echo "ERROR: Concurrency must be a positive integer" >&2
                exit 1
            fi
            shift 2
            ;;
        --verify-rate)
            VERIFY_RATE="$2"
            if ! [[ "$VERIFY_RATE" =~ ^[0-9]+$ ]]; then
                echo "ERROR: Verify rate must be a non-negative integer" >&2
                exit 1
            fi
            shift 2
            ;;
        --apply)
            APPLY=true
            shift
            ;;
        --retries)
            RETRIES="$2"
            if ! [[ "$RETRIES" =~ ^[0-9]+$ ]] || [[ "$RETRIES" -lt 0 ]]; then
                echo "ERROR: Retries must be a non-negative integer" >&2
                exit 1
            fi
            shift 2
            ;;
        --bwlimit)
            BWLIMIT="$2"
            shift 2
            ;;
        --list)
            FILE_LIST="$2"
            shift 2
            ;;
        --allow-outside-staging)
            ALLOW_OUTSIDE_STAGING=true
            shift
            ;;
        --log-file)
            LOG_FILE="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        -*)
            echo "ERROR: Unknown option '$1'" >&2
            usage
            exit 1
            ;;
        *)
            if [[ -z "$LOCAL_INPUT" ]]; then
                LOCAL_INPUT="$1"
            elif [[ -z "$REMOTE_REL_DIR" ]]; then
                REMOTE_REL_DIR="$1"
            else
                echo "ERROR: Too many arguments" >&2
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate arguments
if [[ -z "$REMOTE_REL_DIR" ]]; then
    echo "ERROR: Missing required argument: remote_rel_dir" >&2
    usage
    exit 1
fi

# Get file list
if [[ -n "$FILE_LIST" ]]; then
    if [[ ! -f "$FILE_LIST" ]]; then
        echo "ERROR: File list not found: $FILE_LIST" >&2
        exit 1
    fi
    # Use null-terminated strings to handle spaces in filenames
    mapfile -d '' FILES < <(cat "$FILE_LIST" | tr '\n' '\0')
elif [[ -d "$LOCAL_INPUT" ]]; then
    # Use find with null termination for spaces in filenames
    mapfile -d '' FILES < <(find "$LOCAL_INPUT" -type f \( -name "*.mp3" -o -name "*.m4a" \) -print0 2>/dev/null || true)
elif [[ -f "$LOCAL_INPUT" ]]; then
    FILES=("$LOCAL_INPUT")
else
    # Handle glob patterns
    mapfile -d '' FILES < <(find /srv/media/imported -name "$(basename "$LOCAL_INPUT")" -type f -print0 2>/dev/null || true)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "ERROR: No files found" >&2
    exit 1
fi

# Validate safety (allow imported or staging directory)
if [[ "$ALLOW_OUTSIDE_STAGING" = false ]]; then
    for file in "${FILES[@]}"; do
        if [[ "$file" != /srv/media/imported/* ]] && [[ "$file" != /srv/media/staging/* ]]; then
            echo "ERROR: File outside imported or staging directory: $file" >&2
            echo "Use --allow-outside-staging to override this safety check" >&2
            exit 1
        fi
    done
fi

# Create log directory
mkdir -p "$(dirname "$LOG_FILE")"

echo "=== Batch rsync Transfer with Hydration Logging ==="
echo "Files: ${#FILES[@]}"
echo "Concurrency: $CONCURRENCY"
echo "Remote: /home/archive/$REMOTE_REL_DIR"
echo "Mode: $([ "$APPLY" = true ] && echo "APPLY" || echo "DRY RUN")"
echo "Log file: $LOG_FILE"
if [[ $VERIFY_RATE -gt 0 ]]; then
    echo "Verify rate: every $VERIFY_RATE files"
fi
echo ""

# Test SSH connectivity
if ! ssh bx-archive "pwd" >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to bx-archive" >&2
    exit 1
fi

# Create remote directory
ssh bx-archive "mkdir -p /home/archive/$REMOTE_REL_DIR" || {
    echo "ERROR: Cannot create remote directory" >&2
    exit 1
}

# NEW: Extract episode ID from filename
extract_episode_id() {
    local filename="$1"
    # Extract 24-character hex ID from beginning of filename
    echo "$filename" | grep -oP '^[a-f0-9]{24}' || echo ""
}

# NEW: Log successful transfer
log_success() {
    local file="$1"
    local remote_dir="$2"
    local rsync_exit_code="$3"
    
    local filename=$(basename "$file")
    local episode_id=$(extract_episode_id "$filename")
    
    # Archive uses flat structure (just filename)
    local archive_path="$remote_dir/$filename"
    
    # Get file size
    local file_size
    if command -v stat >/dev/null 2>&1; then
        if stat -f%z "$file" >/dev/null 2>&1; then
            # macOS
            file_size=$(stat -f%z "$file")
        else
            # Linux
            file_size=$(stat -c%s "$file")
        fi
    else
        file_size=0
    fi
    
    # Create JSONL entry
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
    
    if [[ -n "$episode_id" ]]; then
        # Success with episode ID
        local log_entry=$(jq -nc \
            --arg episodeId "$episode_id" \
            --arg archivePath "$archive_path" \
            --arg bucket "$remote_dir" \
            --arg filename "$filename" \
            --argjson size "$file_size" \
            --arg ts "$timestamp" \
            --argjson exitCode "$rsync_exit_code" \
            '{episodeId: $episodeId, archivePath: $archivePath, bucket: $bucket, filename: $filename, size: $size, ts: $ts, rsyncExitCode: $exitCode}')
        
        echo "$log_entry" >> "$LOG_FILE"
        echo "📝 Logged: $episode_id → $archive_path"
    else
        # Error: no episode ID found
        local error_entry=$(jq -nc \
            --arg error "invalid_filename" \
            --arg filename "$filename" \
            --arg archivePath "$archive_path" \
            --arg ts "$timestamp" \
            --argjson exitCode "$rsync_exit_code" \
            '{error: $error, filename: $filename, archivePath: $archivePath, ts: $ts, rsyncExitCode: $exitCode}')
        
        echo "$error_entry" >> "$LOG_FILE"
        echo "⚠️  No episode ID found in: $filename"
    fi
}

# Transfer function
transfer_file() {
    local file="$1"
    local remote_dir="$2"
    local apply="$3"
    local retries="$4"
    local bwlimit="$5"
    local allow_outside="$6"
    
    local flags=""
    if [[ "$apply" = true ]]; then
        flags="$flags --apply"
    fi
    if [[ -n "$bwlimit" ]]; then
        flags="$flags --bwlimit $bwlimit"
    fi
    if [[ $retries -gt 0 ]]; then
        flags="$flags --retries $retries"
    fi
    if [[ "$allow_outside" = true ]]; then
        flags="$flags --allow-outside-staging"
    fi
    
    # Archive uses flat structure (just basename)
    local filename=$(basename "$file")
    
    if "$SCRIPT_ROOT/rsync_one.sh" $flags "$file" "$remote_dir"; then
        echo "✅ $filename"
        # NEW: Log successful transfer
        log_success "$file" "$remote_dir" 0
        return 0
    else
        echo "❌ $filename"
        # NEW: Log failed transfer
        log_success "$file" "$remote_dir" 1
        return 1
    fi
}

export -f transfer_file
export SCRIPT_ROOT
export LOG_FILE
export -f extract_episode_id
export -f log_success

# Run parallel transfers
echo "→ Starting transfers..."
START_TIME=$(date +%s)

SUCCESS_COUNT=0
FAIL_COUNT=0

# Use printf with null termination and xargs -0 for proper handling of spaces
printf '%s\0' "${FILES[@]}" | xargs -0 -I{} -P "$CONCURRENCY" bash -c 'transfer_file "$@"' _ {} "$REMOTE_REL_DIR" "$APPLY" "$RETRIES" "$BWLIMIT" "$ALLOW_OUTSIDE_STAGING" | while IFS= read -r line; do
    if [[ "$line" =~ ^✅ ]]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    elif [[ "$line" =~ ^❌ ]]; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    echo "$line"
done

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

# Verify sampling
VERIFY_COUNT=0
VERIFY_FAIL_COUNT=0
if [[ $VERIFY_RATE -gt 0 ]]; then
    echo ""
    echo "→ Running verification sampling..."
    for ((i=0; i<${#FILES[@]}; i+=VERIFY_RATE)); do
        file="${FILES[i]}"
        if "$SCRIPT_ROOT/rsync_verify.sh" "$file" "$REMOTE_REL_DIR"; then
            VERIFY_COUNT=$((VERIFY_COUNT + 1))
        else
            VERIFY_FAIL_COUNT=$((VERIFY_FAIL_COUNT + 1))
        fi
    done
fi

echo ""
echo "=== Results Summary ==="
echo "Total time: ${TOTAL_TIME}s"
echo "Files transferred: $SUCCESS_COUNT"
echo "Files failed: $FAIL_COUNT"
if [[ $VERIFY_RATE -gt 0 ]]; then
    echo "Files verified: $VERIFY_COUNT"
    echo "Verification failures: $VERIFY_FAIL_COUNT"
fi

echo ""
echo "📋 Success log written to: $LOG_FILE"
echo "Next step: Run hydration script"
echo "  docker exec payload-dev-scripts-1 sh -lc 'npx tsx scripts/hydrate-archive-paths.ts --log $LOG_FILE'"

if [[ $FAIL_COUNT -gt 0 ]] || [[ $VERIFY_FAIL_COUNT -gt 0 ]]; then
    echo "❌ Batch transfer completed with errors"
    exit 1
else
    echo "✅ Batch transfer completed successfully"
    exit 0
fi
