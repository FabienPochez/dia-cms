#!/usr/bin/env bash
# rsync_one.sh - Copy file from staging to Hetzner Storage Box archive
# Usage: rsync_one.sh <local_src> [remote_rel_dir]
# Flags: --dry-run (default), --apply, --bwlimit <rate>

set -euo pipefail

# Default values
DRY_RUN=true
BWLIMIT=""
RETRIES=2
ALLOW_OUTSIDE_STAGING=false
REMOTE_BASE="/home/archive"
REMOTE_DEFAULT_DIR="staging-test"

usage() {
    echo "Usage: $0 [--apply] [--bwlimit <rate>] [--retries N] [--allow-outside-staging] <local_src> [remote_rel_dir]"
    echo ""
    echo "Copy file from /srv/media/staging/ to Hetzner Storage Box archive"
    echo ""
    echo "Arguments:"
    echo "  local_src      Local file path (must be under /srv/media/staging/)"
    echo "  remote_rel_dir Remote directory under /home/archive/ (default: staging-test)"
    echo ""
    echo "Flags:"
    echo "  --apply        Perform actual copy (default: dry-run)"
    echo "  --bwlimit      Bandwidth limit for rsync (e.g., 1000K, 1M)"
    echo "  --retries      Number of retries on failure (default: 2)"
    echo "  --allow-outside-staging  Allow files outside /srv/media/staging/"
    echo "  --help         Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 /srv/media/staging/test.mp3"
    echo "  $0 --apply /srv/media/staging/test.mp3"
    echo "  $0 --apply --retries 3 /srv/media/staging/test.mp3 production"
    echo "  $0 --apply --bwlimit 500K /srv/media/staging/test.mp3 production"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --apply)
            DRY_RUN=false
            shift
            ;;
        --bwlimit)
            BWLIMIT="$2"
            shift 2
            ;;
        --retries)
            RETRIES="$2"
            if ! [[ "$RETRIES" =~ ^[0-9]+$ ]] || [[ "$RETRIES" -lt 0 ]]; then
                echo "ERROR: Retries must be a non-negative integer" >&2
                exit 1
            fi
            shift 2
            ;;
        --allow-outside-staging)
            ALLOW_OUTSIDE_STAGING=true
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        -*)
            echo "ERROR: Unknown flag $1" >&2
            usage
            exit 1
            ;;
        *)
            break
            ;;
    esac
done

# Validate arguments
if [[ $# -lt 1 ]]; then
    echo "ERROR: Missing required argument: local_src" >&2
    usage
    exit 1
fi

LOCAL_SRC="$1"
REMOTE_REL_DIR="${2:-$REMOTE_DEFAULT_DIR}"

# Validate local source
if [[ ! -f "$LOCAL_SRC" ]]; then
    echo "ERROR: Local file does not exist: $LOCAL_SRC" >&2
    exit 1
fi

if [[ "$ALLOW_OUTSIDE_STAGING" = false ]] && [[ "$LOCAL_SRC" != /srv/media/staging/* ]]; then
    echo "ERROR: Local file must be under /srv/media/staging/: $LOCAL_SRC" >&2
    echo "Use --allow-outside-staging to override this safety check" >&2
    exit 1
fi

# Extract filename for remote path (flat structure - just basename)
FILENAME=$(basename "$LOCAL_SRC")
REMOTE_TARGET="bx-archive:$REMOTE_BASE/$REMOTE_REL_DIR/$FILENAME"

echo "=== rsync_one.sh ==="
echo "Local source: $LOCAL_SRC"
echo "Remote target: $REMOTE_TARGET"
echo "Mode: $([ "$DRY_RUN" = true ] && echo "DRY RUN" || echo "APPLY")"
if [[ -n "$BWLIMIT" ]]; then
    echo "Bandwidth limit: $BWLIMIT"
fi
echo "Retries: $RETRIES"
echo ""

# Set production SSH defaults
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
if [[ "$DRY_RUN" = false ]]; then
    ssh bx-archive "mkdir -p $REMOTE_BASE/$REMOTE_REL_DIR"
    echo "✅ Remote directory created/verified"
else
    echo "✅ Would create remote directory: $REMOTE_BASE/$REMOTE_REL_DIR"
fi

# Build rsync command
RSYNC_CMD="rsync -avh --progress --partial --inplace"
if [[ "$DRY_RUN" = true ]]; then
    RSYNC_CMD="$RSYNC_CMD --dry-run"
fi
if [[ -n "$BWLIMIT" ]]; then
    RSYNC_CMD="$RSYNC_CMD --bwlimit=$BWLIMIT"
fi

# Execute rsync with retry logic
echo "→ Executing rsync..."
RETRY_COUNT=0
while [[ $RETRY_COUNT -le $RETRIES ]]; do
    if $RSYNC_CMD "$LOCAL_SRC" "$REMOTE_TARGET"; then
        echo "✅ rsync completed successfully"
        echo "Final remote path: $REMOTE_TARGET"
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [[ $RETRY_COUNT -le $RETRIES ]]; then
            BACKOFF_TIME=$((2 ** RETRY_COUNT + 1))
            echo "❌ rsync failed (attempt $RETRY_COUNT/$((RETRIES + 1))), retrying in ${BACKOFF_TIME}s..."
            sleep $BACKOFF_TIME
        else
            echo "❌ rsync failed after $((RETRIES + 1)) attempts" >&2
            exit 1
        fi
    fi
done
