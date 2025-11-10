#!/bin/bash
# Quick LibreTime v2 API Test Helper
# Usage: ./quick-lt-test.sh [LT_URL] [LT_API_KEY] [LT_FILE_ID]

set -euo pipefail

# Parse arguments or use environment variables
LT_URL="${1:-${LT_URL:-http://libretime-nginx-1:8080}}"
LT_API_KEY="${2:-${LT_API_KEY:-}}"
LT_FILE_ID="${3:-${LT_FILE_ID:-}}"

echo "=== Quick LibreTime v2 API Test ==="
echo "URL: $LT_URL"
echo "API Key: ${LT_API_KEY:0:8}..." # Show first 8 chars only
echo "File ID: ${LT_FILE_ID:-'auto-discover'}"
echo ""

# Export for the main test script
export LT_URL LT_API_KEY LT_FILE_ID

# Run the main test script
exec /srv/payload/libretime-v2-api-test.sh
