#!/usr/bin/env bash
# rsync_verify.sh - Verify file integrity using SHA256 checksums
# Usage: rsync_verify.sh <local_src> <remote_rel_dir>

set -euo pipefail

usage() {
    echo "Usage: $0 <local_src> <remote_rel_dir>"
    echo ""
    echo "Verify file integrity by comparing SHA256 checksums"
    echo ""
    echo "Arguments:"
    echo "  local_src      Local file path"
    echo "  remote_rel_dir Remote directory under ~/archive/"
    echo ""
    echo "Examples:"
    echo "  $0 /srv/media/staging/test.mp3 staging-test"
}

# Validate arguments
if [[ $# -ne 2 ]]; then
    echo "ERROR: Expected exactly 2 arguments" >&2
    usage
    exit 3
fi

LOCAL_SRC="$1"
REMOTE_REL_DIR="$2"

# Validate local source
if [[ ! -f "$LOCAL_SRC" ]]; then
    echo "ERROR: Local file does not exist: $LOCAL_SRC" >&2
    exit 3
fi

FILENAME=$(basename "$LOCAL_SRC")
REMOTE_FILE="bx-archive:/home/archive/$REMOTE_REL_DIR/$FILENAME"

# Test SSH connectivity
if ! ssh bx-archive "pwd" >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to bx-archive" >&2
    exit 2
fi

# Compute local checksum
LOCAL_CHECKSUM=$(sha256sum "$LOCAL_SRC" | cut -d' ' -f1)

# Set production SSH defaults
export RSYNC_RSH="${RSYNC_RSH:-ssh -p 23 -o Compression=no -o ControlMaster=auto -o ControlPath=~/.ssh/cm-%r@%h:%p -o ControlPersist=60 -c aes128-gcm@openssh.com}"

# Compute remote checksum
REMOTE_CHECKSUM=$(ssh bx-archive "sha256sum /home/archive/$REMOTE_REL_DIR/$FILENAME 2>/dev/null || openssl dgst -sha256 /home/archive/$REMOTE_REL_DIR/$FILENAME | sed -n 's/^.*= //p'" | cut -d' ' -f1)
if [[ -z "$REMOTE_CHECKSUM" ]]; then
    echo "ERROR: Cannot compute remote checksum" >&2
    exit 2
fi

# Compare checksums
if [[ "$LOCAL_CHECKSUM" == "$REMOTE_CHECKSUM" ]]; then
    echo "✅ $(basename "$LOCAL_SRC"): checksums match"
    exit 0
else
    echo "❌ $(basename "$LOCAL_SRC"): checksums mismatch (local: ${LOCAL_CHECKSUM:0:8}..., remote: ${REMOTE_CHECKSUM:0:8}...)"
    exit 1
fi
