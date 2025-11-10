#!/bin/bash
# Minimal LibreTime Schedule Test
# Focus: Create instance + schedule file with proper track duration

set -euo pipefail

# Configuration
LT_URL="${LT_URL:-https://schedule.diaradio.live}"
LT_API_KEY="${LT_API_KEY:-}"
FILE_ID="${FILE_ID:-114}"

# Generate time windows
START=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
END_INST=$(date -u -d '+40 minutes' +%Y-%m-%dT%H:%M:%SZ)   # generous 30-min window

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Minimal LibreTime Schedule Test ===${NC}"
echo "LT_URL: $LT_URL"
echo "FILE_ID: $FILE_ID"
echo "START: $START"
echo "END_INST: $END_INST"
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

# Step 1: Fetch track length
echo -e "${YELLOW}→ Fetching track length for file $FILE_ID${NC}"
LEN=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" \
  "$LT_URL/api/v2/files/$FILE_ID" | jq -r .length)

if [[ "$LEN" == "null" || -z "$LEN" ]]; then
    echo -e "${YELLOW}WARNING: Could not get track length, using default 15 minutes${NC}"
    LEN="00:15:00"
else
    echo "Track length: $LEN"
fi

# Step 2: Create show
echo -e "${YELLOW}→ Creating show${NC}"
SHOW_ID=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dia-test-schedule",
    "description": "Minimal schedule test",
    "live_enabled": true,
    "linked": false,
    "linkable": true,
    "auto_playlist_enabled": false,
    "auto_playlist_repeat": false,
    "override_intro_playlist": false,
    "override_outro_playlist": false
  }' \
  "$LT_URL/api/v2/shows" | jq -r .id)

if [[ "$SHOW_ID" == "null" || -z "$SHOW_ID" ]]; then
    echo -e "${RED}ERROR: Failed to create show${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Created show ID: $SHOW_ID${NC}"

# Step 3: Create instance
echo -e "${YELLOW}→ Creating show instance${NC}"
INST_ID=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"show\": $SHOW_ID,
    \"starts_at\": \"$START\",
    \"ends_at\": \"$END_INST\",
    \"created_at\": \"$START\",
    \"record_enabled\": 0,
    \"modified\": false,
    \"auto_playlist_built\": false
  }" \
  "$LT_URL/api/v2/show-instances" | jq -r .id)

if [[ "$INST_ID" == "null" || -z "$INST_ID" ]]; then
    echo -e "${RED}ERROR: Failed to create show instance${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Created instance ID: $INST_ID${NC}"

# Step 4: Calculate track end time
# Parse track length and add to start time (handle decimal seconds)
LEN_CLEAN=$(echo $LEN | sed 's/\.[0-9]*$//')  # Remove decimal seconds
TRACK_END=$(date -u -d "$START + $(echo $LEN_CLEAN | sed 's/:/ hours /; s/:/ minutes /; s/$/ seconds/')" +%Y-%m-%dT%H:%M:%SZ)
echo "Track will end at: $TRACK_END"

# Step 5: Schedule item
echo -e "${YELLOW}→ Scheduling file in instance${NC}"
SCHEDULE_RESPONSE=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"instance\": $INST_ID,
    \"file\": $FILE_ID,
    \"starts_at\": \"$START\",
    \"ends_at\": \"$TRACK_END\",
    \"position\": 0,
    \"cue_in\": \"00:00:00\",
    \"cue_out\": \"$LEN\",
    \"broadcasted\": 0
  }" \
  "$LT_URL/api/v2/schedule")

SCHED_ID=$(echo "$SCHEDULE_RESPONSE" | jq -r .id)

if [[ "$SCHED_ID" == "null" || -z "$SCHED_ID" ]]; then
    echo -e "${RED}ERROR: Failed to create schedule item${NC}"
    echo "Response: $SCHEDULE_RESPONSE"
    exit 1
fi
echo -e "${GREEN}✓ Created schedule ID: $SCHED_ID${NC}"

# Step 6: Verify
echo -e "${YELLOW}→ Verifying schedule creation${NC}"
VERIFY_RESPONSE=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" \
  "$LT_URL/api/v2/schedule?instance=$INST_ID")

echo "Schedule verification:"
echo "$VERIFY_RESPONSE" | jq .

# Check if our schedule item is in the response
FOUND=$(echo "$VERIFY_RESPONSE" | jq -r ".[] | select(.id == $SCHED_ID) | .id")
if [[ "$FOUND" == "$SCHED_ID" ]]; then
    echo -e "${GREEN}✓ Schedule item verified successfully${NC}"
else
    echo -e "${RED}✗ Schedule item not found in verification${NC}"
fi

echo ""
echo -e "${BLUE}=== Test Complete ===${NC}"
echo "Created resources:"
echo "  Show ID: $SHOW_ID"
echo "  Instance ID: $INST_ID"
echo "  Schedule ID: $SCHED_ID"
echo "  Track length: $LEN"
echo "  Track end time: $TRACK_END"
echo ""

echo -e "${YELLOW}Cleanup commands:${NC}"
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/schedule/$SCHED_ID\""
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/show-instances/$INST_ID\""
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/shows/$SHOW_ID\""
