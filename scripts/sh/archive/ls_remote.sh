#!/usr/bin/env bash
# ls_remote.sh - List files in remote archive directory
# Usage: ls_remote.sh [remote_rel_dir] [--du] [--tree]

set -euo pipefail

# Default values
REMOTE_DEFAULT_DIR="staging-test"
SHOW_DU=false
SHOW_TREE=false

usage() {
    echo "Usage: $0 [remote_rel_dir] [--du] [--tree] [--exists]"
    echo ""
    echo "List files in remote archive directory"
    echo "Exit codes: 0=success, 1=directory not found, 2=SSH error"
    echo ""
    echo "Arguments:"
    echo "  remote_rel_dir Remote directory under /home/archive/ (default: staging-test)"
    echo ""
    echo "Flags:"
    echo "  --du           Also show disk usage with 'du -sh'"
    echo "  --tree         Show directory tree structure (depth 2)"
    echo "  --exists       Check if directory exists (exit 0/1)"
    echo "  --help         Show this help"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 staging-test --du"
    echo "  $0 production --tree"
    echo "  $0 --exists staging/2024-01-15"
}

# Parse arguments
CHECK_EXISTS=false
REMOTE_REL_DIR="$REMOTE_DEFAULT_DIR"
while [[ $# -gt 0 ]]; do
    case $1 in
        --du)
            SHOW_DU=true
            shift
            ;;
        --tree)
            SHOW_TREE=true
            shift
            ;;
        --exists)
            CHECK_EXISTS=true
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
            REMOTE_REL_DIR="$1"
            shift
            ;;
    esac
done

REMOTE_DIR="bx-archive:/home/archive/$REMOTE_REL_DIR"

# Handle --exists flag
if [[ "$CHECK_EXISTS" = true ]]; then
    if ssh bx-archive "test -d /home/archive/$REMOTE_REL_DIR"; then
        echo "✅ Directory exists: /home/archive/$REMOTE_REL_DIR"
        exit 0
    else
        echo "❌ Directory not found: /home/archive/$REMOTE_REL_DIR"
        exit 1
    fi
fi

echo "=== ls_remote.sh ==="
echo "Remote directory: $REMOTE_DIR"
echo ""

# Test SSH connectivity
if ! ssh bx-archive "pwd" >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to bx-archive" >&2
    exit 2
fi

# List files
ssh bx-archive "ls -la /home/archive/$REMOTE_REL_DIR/" || {
    echo "ERROR: Cannot list remote directory" >&2
    exit 1
}

# Show disk usage if requested
if [[ "$SHOW_DU" = true ]]; then
    echo ""
    ssh bx-archive "du -sh /home/archive/$REMOTE_REL_DIR/"
fi

# Show tree if requested
if [[ "$SHOW_TREE" = true ]]; then
    echo ""
    ssh bx-archive "find /home/archive/$REMOTE_REL_DIR/ -maxdepth 2 -type f | head -20"
fi
