#!/usr/bin/env bash
# rsync_postair_weekly.sh - Archive working file to weekly bucket structure
# Usage: rsync_postair_weekly.sh <workingAbs> <destRel>
# Environment: EPISODE_ID must be set

set -euo pipefail

# Get script directory for absolute paths
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
REMOTE_BASE="/home/archive"
LOG_FILE="/srv/media/logs/cron-postair-archive.jsonl"

usage() {
    echo "Usage: $0 <workingAbs> <destRel>"
    echo ""
    echo "Archive working file to weekly bucket structure"
    echo ""
    echo "Arguments:"
    echo "  workingAbs    Absolute path to working file (e.g., /srv/media/imported/1/file.mp3)"
    echo "  destRel       Relative destination path (e.g., 2025/week-42/file.mp3)"
    echo ""
    echo "Environment:"
    echo "  EPISODE_ID    Episode ID for logging (required)"
    echo ""
    echo "Examples:"
    echo "  EPISODE_ID=123 $0 /srv/media/imported/1/file.mp3 2025/week-42/file.mp3"
    echo ""
    echo "Logging:"
    echo "  Success log: $LOG_FILE"
}

# Parse arguments
if [[ $# -ne 2 ]]; then
    echo "ERROR: Missing required arguments" >&2
    usage
    exit 1
fi

WORKING_ABS="$1"
DEST_REL="$2"

# Validate environment
if [[ -z "${EPISODE_ID:-}" ]]; then
    echo "ERROR: EPISODE_ID environment variable is required" >&2
    exit 1
fi

# Validate working file
if [[ ! -f "$WORKING_ABS" ]]; then
    echo "ERROR: Working file does not exist: $WORKING_ABS" >&2
    exit 1
fi

# Build remote target
REMOTE_TARGET="bx-archive:$REMOTE_BASE/$DEST_REL"

echo "=== rsync_postair_weekly.sh ==="
echo "Episode ID: $EPISODE_ID"
echo "Working file: $WORKING_ABS"
echo "Remote target: $REMOTE_TARGET"
echo ""

# Set production SSH defaults (from rsync_one.sh:114)
export RSYNC_RSH="${RSYNC_RSH:-ssh -p 23 -o Compression=no -o ControlMaster=auto -o ControlPath=~/.ssh/cm-%r@%h:%p -o ControlPersist=60 -c aes128-gcm@openssh.com}"

# Test SSH connectivity
echo "→ Testing SSH connectivity..."
if ! ssh bx-archive "pwd" >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to bx-archive. Check SSH alias configuration." >&2
    exit 1
fi
echo "✅ SSH connection successful"

# Create remote directory
echo "→ Creating remote directory..."
REMOTE_DIR="$(dirname "$REMOTE_BASE/$DEST_REL")"
ssh bx-archive "mkdir -p '$REMOTE_DIR'"
echo "✅ Remote directory created/verified: $REMOTE_DIR"

# Check if file already exists with same size
echo "→ Checking if file already exists..."
WORKING_SIZE=$(stat -c%s "$WORKING_ABS" 2>/dev/null || echo "0")
REMOTE_SIZE=""

if ssh bx-archive "test -f '$REMOTE_BASE/$DEST_REL'" 2>/dev/null; then
    REMOTE_SIZE=$(ssh bx-archive "stat -c%s '$REMOTE_BASE/$DEST_REL'" 2>/dev/null || echo "0")
    
    if [[ "$WORKING_SIZE" -eq "$REMOTE_SIZE" ]] && [[ "$WORKING_SIZE" -gt 0 ]]; then
        echo "✅ File already exists with same size ($WORKING_SIZE bytes) - skipping"
        
        # Log as skipped
        TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
        DURATION_MS=0
        
        LOG_ENTRY=$(jq -nc \
            --arg operation "cron_postair" \
            --arg episodeId "$EPISODE_ID" \
            --arg action "skipped" \
            --arg archivePath "$DEST_REL" \
            --argjson bytes "$WORKING_SIZE" \
            --arg ts "$TIMESTAMP" \
            --argjson duration_ms "$DURATION_MS" \
            --argjson rsyncExitCode 0 \
            '{operation: $operation, episodeId: $episodeId, action: $action, archivePath: $archivePath, bytes: $bytes, ts: $ts, duration_ms: $duration_ms, rsyncExitCode: $rsyncExitCode}')
        
        echo "$LOG_ENTRY" >> "$LOG_FILE"
        echo "📝 Logged: $EPISODE_ID → $DEST_REL (skipped)"
        exit 0
    else
        echo "⚠️  File exists but size differs (working: $WORKING_SIZE, remote: $REMOTE_SIZE) - overwriting"
    fi
else
    echo "📁 File does not exist on remote - proceeding with transfer"
fi

# Build rsync command
RSYNC_CMD="rsync -av --inplace --protect-args"

# Execute rsync
echo "→ Executing rsync..."
START_TIME=$(date +%s)

if $RSYNC_CMD "$WORKING_ABS" "$REMOTE_TARGET"; then
    END_TIME=$(date +%s)
    DURATION_MS=$(( (END_TIME - START_TIME) * 1000 ))
    
    echo "✅ rsync completed successfully"
    echo "Final remote path: $REMOTE_TARGET"
    
    # Get final file size
    FINAL_SIZE=$(stat -c%s "$WORKING_ABS" 2>/dev/null || echo "0")
    
    # Log success
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
    
    LOG_ENTRY=$(jq -nc \
        --arg operation "cron_postair" \
        --arg episodeId "$EPISODE_ID" \
        --arg action "archived" \
        --arg archivePath "$DEST_REL" \
        --argjson bytes "$FINAL_SIZE" \
        --arg ts "$TIMESTAMP" \
        --argjson duration_ms "$DURATION_MS" \
        --argjson rsyncExitCode 0 \
        '{operation: $operation, episodeId: $episodeId, action: $action, archivePath: $archivePath, bytes: $bytes, ts: $ts, duration_ms: $duration_ms, rsyncExitCode: $rsyncExitCode}')
    
    echo "$LOG_ENTRY" >> "$LOG_FILE"
    echo "📝 Logged: $EPISODE_ID → $DEST_REL (archived)"
    exit 0
else
    END_TIME=$(date +%s)
    DURATION_MS=$(( (END_TIME - START_TIME) * 1000 ))
    RSYNC_EXIT_CODE=$?
    
    echo "❌ rsync failed with exit code $RSYNC_EXIT_CODE"
    
    # Log error
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
    
    LOG_ENTRY=$(jq -nc \
        --arg operation "cron_postair" \
        --arg episodeId "$EPISODE_ID" \
        --arg action "error" \
        --arg archivePath "$DEST_REL" \
        --argjson bytes 0 \
        --arg ts "$TIMESTAMP" \
        --argjson duration_ms "$DURATION_MS" \
        --argjson rsyncExitCode "$RSYNC_EXIT_CODE" \
        '{operation: $operation, episodeId: $episodeId, action: $action, archivePath: $archivePath, bytes: $bytes, ts: $ts, duration_ms: $duration_ms, rsyncExitCode: $rsyncExitCode}')
    
    echo "$LOG_ENTRY" >> "$LOG_FILE"
    echo "📝 Logged: $EPISODE_ID → $DEST_REL (error)"
    exit $RSYNC_EXIT_CODE
fi
