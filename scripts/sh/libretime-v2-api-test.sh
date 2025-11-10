#!/bin/bash
# LibreTime v2 API Test Script
# Tests: Show + Instance + Schedule creation via LibreTime v2 API
# Auth: Api-Key header
# Safety: Creates test entities with unique timestamp prefix

set -euo pipefail

# Configuration
LT_URL="${LT_URL:-http://libretime-nginx-1:8080}"
LT_API_KEY="${LT_API_KEY:-}"
LT_FILE_ID="${LT_FILE_ID:-}"

# Generate unique test identifiers
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="dia-test-$TS"
START=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u -d '+25 minutes' +%Y-%m-%dT%H:%M:%SZ)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== LibreTime v2 API Test Suite ===${NC}"
echo "Test Name: $NAME"
echo "Start Time: $START"
echo "End Time: $END"
echo "LibreTime URL: $LT_URL"
echo ""

# Check prerequisites
if [[ -z "$LT_API_KEY" ]]; then
    echo -e "${RED}ERROR: LT_API_KEY environment variable not set${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}ERROR: jq command not found. Please install jq for JSON parsing${NC}"
    exit 1
fi

# Helper function for API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local description="$4"
    
    echo -e "${YELLOW}→ $description${NC}"
    
    if [[ "$method" == "GET" ]]; then
        response=$(curl -s -w "\n%{http_code}" -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Api-Key $LT_API_KEY" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$LT_URL$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    
    echo "HTTP Status: $http_code"
    if [[ "$http_code" =~ ^[23][0-9][0-9]$ ]]; then
        echo -e "${GREEN}✓ Success${NC}"
        if [[ -n "$body" ]]; then
            echo "$body" | jq . 2>/dev/null || echo "$body"
        fi
    else
        echo -e "${RED}✗ Failed${NC}"
        echo "Response: $body"
        return 1
    fi
    echo ""
}

# A) Preflight checks
echo -e "${BLUE}=== A) Preflight Checks ===${NC}"

api_call "GET" "/api/v2/" "" "Check v2 API root"

api_call "OPTIONS" "/api/v2/shows" "" "Check shows endpoint capabilities"
api_call "OPTIONS" "/api/v2/show-instances" "" "Check show-instances endpoint capabilities"  
api_call "OPTIONS" "/api/v2/schedule" "" "Check schedule endpoint capabilities"

# B) Create Show
echo -e "${BLUE}=== B) Create Show ===${NC}"

show_data=$(cat <<EOF
{
  "name": "$NAME",
  "description": "LibreTime v2 API test show",
  "live_enabled": true,
  "linked": false,
  "linkable": true,
  "auto_playlist_enabled": false,
  "auto_playlist_repeat": false,
  "override_intro_playlist": false,
  "override_outro_playlist": false
}
EOF
)

api_call "POST" "/api/v2/shows" "$show_data" "Create test show"

# Extract show ID from response
SHOW_ID=$(echo "$body" | jq -r '.id // empty')
if [[ -z "$SHOW_ID" ]]; then
    echo -e "${RED}ERROR: Could not extract show ID from response${NC}"
    exit 1
fi
echo "Created Show ID: $SHOW_ID"

# C) Create Show Instance
echo -e "${BLUE}=== C) Create Show Instance ===${NC}"

instance_data=$(cat <<EOF
{
  "show": $SHOW_ID,
  "starts_at": "$START",
  "ends_at": "$END",
  "created_at": "$START",
  "record_enabled": 0,
  "modified": false,
  "auto_playlist_built": false
}
EOF
)

api_call "POST" "/api/v2/show-instances" "$instance_data" "Create show instance"

# Extract instance ID from response
INSTANCE_ID=$(echo "$body" | jq -r '.id // empty')
if [[ -z "$INSTANCE_ID" ]]; then
    echo -e "${RED}ERROR: Could not extract instance ID from response${NC}"
    exit 1
fi
echo "Created Instance ID: $INSTANCE_ID"

# D) Pick a File
echo -e "${BLUE}=== D) Pick a File ===${NC}"

if [[ -n "$LT_FILE_ID" ]]; then
    FILE_ID="$LT_FILE_ID"
    echo "Using provided file ID: $FILE_ID"
else
    echo "Searching for files..."
    api_call "GET" "/api/v2/files?limit=10" "" "List available files"
    
    # Try to find a file ID from the response
    FILE_ID=$(echo "$body" | jq -r '.[0].id // empty')
    if [[ -z "$FILE_ID" ]]; then
        echo -e "${YELLOW}WARNING: No files found. You may need to upload a file first.${NC}"
        echo "Skipping schedule creation..."
        FILE_ID=""
    else
        echo "Using first available file ID: $FILE_ID"
    fi
fi

# E) Schedule the File (if we have a file)
if [[ -n "$FILE_ID" ]]; then
    echo -e "${BLUE}=== E) Schedule the File ===${NC}"
    
    schedule_data=$(cat <<EOF
{
  "instance": $INSTANCE_ID,
  "file": $FILE_ID,
  "starts_at": "$START",
  "ends_at": "$END",
  "position": 0,
  "cue_in": "00:00:00",
  "cue_out": "00:15:00",
  "broadcasted": 0
}
EOF
)
    
    api_call "POST" "/api/v2/schedule" "$schedule_data" "Schedule file in instance"
    
    # Extract schedule ID from response
    SCHED_ID=$(echo "$body" | jq -r '.id // empty')
    if [[ -n "$SCHED_ID" ]]; then
        echo "Created Schedule ID: $SCHED_ID"
    fi
else
    echo -e "${YELLOW}Skipping schedule creation (no file available)${NC}"
    SCHED_ID=""
fi

# F) Verify
echo -e "${BLUE}=== F) Verify Created Resources ===${NC}"

api_call "GET" "/api/v2/shows/$SHOW_ID" "" "Verify show creation"
api_call "GET" "/api/v2/show-instances?show=$SHOW_ID" "" "Verify show instance creation"

if [[ -n "$SCHED_ID" ]]; then
    api_call "GET" "/api/v2/schedule?instance=$INSTANCE_ID" "" "Verify schedule creation"
fi

# G) Cleanup commands (manual)
echo -e "${BLUE}=== G) Cleanup Commands (Manual) ===${NC}"
echo -e "${YELLOW}Run these commands manually to clean up test data:${NC}"
echo ""

if [[ -n "$SCHED_ID" ]]; then
    echo "# Delete schedule item"
    echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/schedule/$SCHED_ID\""
    echo ""
fi

echo "# Delete show instance"
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/show-instances/$INSTANCE_ID\""
echo ""

echo "# Delete show"
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/shows/$SHOW_ID\""
echo ""

echo -e "${GREEN}=== Test Complete ===${NC}"
echo "Created resources:"
echo "  Show ID: $SHOW_ID"
echo "  Instance ID: $INSTANCE_ID"
if [[ -n "$SCHED_ID" ]]; then
    echo "  Schedule ID: $SCHED_ID"
fi
echo ""
echo -e "${YELLOW}Remember to clean up test data using the commands above!${NC}"
