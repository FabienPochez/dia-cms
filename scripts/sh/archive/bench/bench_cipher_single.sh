#!/usr/bin/env bash
# bench_cipher_single.sh - A/B test AES-GCM vs CHACHA20 cipher performance
# Usage: bench_cipher_single.sh <local_file>

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

usage() {
    echo "Usage: $0 <local_file>"
    echo ""
    echo "A/B test single file upload with AES-GCM vs CHACHA20 ciphers"
    echo ""
    echo "Arguments:"
    echo "  local_file    Local file path (must be under /srv/media/staging/)"
    echo ""
    echo "Examples:"
    echo "  $0 /srv/media/staging/test.mp3"
    echo "  $0 /srv/media/staging/685e6a58b3ef76e0e25c2753__xingarmorning__xingar-morning-w-myako__001.mp3"
}

# Validate arguments
if [[ $# -ne 1 ]]; then
    echo "ERROR: Expected exactly 1 argument" >&2
    usage
    exit 1
fi

LOCAL_FILE="$1"

# Validate local file
if [[ ! -f "$LOCAL_FILE" ]]; then
    echo "ERROR: Local file does not exist: $LOCAL_FILE" >&2
    exit 1
fi

if [[ "$LOCAL_FILE" != /srv/media/staging/* ]]; then
    echo "ERROR: Local file must be under /srv/media/staging/: $LOCAL_FILE" >&2
    exit 1
fi

FILENAME=$(basename "$LOCAL_FILE")
TS=$(timestamp)

echo "=== rsync Cipher Benchmark (Single File) ==="
echo "File: $LOCAL_FILE"
echo "Size: $(du -h "$LOCAL_FILE" | cut -f1)"
echo "Timestamp: $TS"
echo ""

# Test SSH connectivity
echo "→ Testing SSH connectivity..."
assert_ssh
echo "✅ SSH connection successful"

# Ensure remote directories exist
ensure_remote_dir "$REMOTE_BASE/bench/aes"
ensure_remote_dir "$REMOTE_BASE/bench/chacha"

echo ""
echo "=== Testing AES-GCM Cipher ==="
AES_LOG="$LOG_DIR/bench-aes-$TS.log"
AES_DEST="bx-archive:$REMOTE_BASE/bench/aes/$FILENAME"

run_timed_rsync "aes128-gcm@openssh.com" "$LOCAL_FILE" "$AES_DEST" "$AES_LOG"

echo ""
echo "=== Testing CHACHA20 Cipher ==="
CHACHA_LOG="$LOG_DIR/bench-chacha-$TS.log"
CHACHA_DEST="bx-archive:$REMOTE_BASE/bench/chacha/$FILENAME"

run_timed_rsync "chacha20-poly1305@openssh.com" "$LOCAL_FILE" "$CHACHA_DEST" "$CHACHA_LOG"

echo ""
echo "=== Results Summary ==="
echo "AES-GCM Results:"
echo "  $(grep 'ELAPSED=' "$AES_LOG" | tail -1)"
echo "  $(grep -A 5 'Number of files:' "$AES_LOG" | tail -5)"
echo ""
echo "CHACHA20 Results:"
echo "  $(grep 'ELAPSED=' "$CHACHA_LOG" | tail -1)"
echo "  $(grep -A 5 'Number of files:' "$CHACHA_LOG" | tail -5)"
echo ""
echo "Log files:"
echo "  AES-GCM: $AES_LOG"
echo "  CHACHA20: $CHACHA_LOG"
echo ""
echo "✅ Benchmark completed"
