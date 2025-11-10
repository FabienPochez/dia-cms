#!/bin/bash
# Schedule Show Test - Create show with specific time and track
# Creates "schedule show test 1" for today at 5pm with 1-hour duration

set -euo pipefail

# Configuration
LT_URL="${LT_URL:-https://schedule.diaradio.live}"
LT_API_KEY="${LT_API_KEY:-}"
FILE_ID="${FILE_ID:-114}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Schedule Show Test ===${NC}"
echo "LT_URL: $LT_URL"
echo "FILE_ID: $FILE_ID"
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

# Set specific time: today at 5pm UTC
TODAY=$(date -u +%Y-%m-%d)
SHOW_START="${TODAY}T17:00:00Z"
SHOW_END="${TODAY}T18:00:00Z"  # 1 hour duration

echo "Show time: $SHOW_START to $SHOW_END"

# Step 1: Fetch track length
echo -e "${YELLOW}→ Fetching track length for file $FILE_ID${NC}"
TRACK_INFO=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/files/$FILE_ID")
TRACK_LENGTH=$(echo "$TRACK_INFO" | jq -r .length)
TRACK_NAME=$(echo "$TRACK_INFO" | jq -r '.track_title // .name // "Unknown Track"')

if [[ "$TRACK_LENGTH" == "null" || -z "$TRACK_LENGTH" ]]; then
    echo -e "${YELLOW}WARNING: Could not get track length, using default 15 minutes${NC}"
    TRACK_LENGTH="00:15:00"
else
    echo "Track: $TRACK_NAME"
    echo "Length: $TRACK_LENGTH"
fi

# Step 2: Create show with specific name
echo -e "${YELLOW}→ Creating show 'schedule show test 1'${NC}"
SHOW_RESPONSE=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "schedule show test 1",
    "description": "Test show scheduled for today at 5pm with track content",
    "live_enabled": true,
    "linked": false,
    "linkable": true,
    "auto_playlist_enabled": false,
    "auto_playlist_repeat": false,
    "override_intro_playlist": false,
    "override_outro_playlist": false
  }' \
  "$LT_URL/api/v2/shows")

SHOW_ID=$(echo "$SHOW_RESPONSE" | jq -r .id)

if [[ "$SHOW_ID" == "null" || -z "$SHOW_ID" ]]; then
    echo -e "${RED}ERROR: Failed to create show${NC}"
    echo "Response: $SHOW_RESPONSE"
    exit 1
fi
echo -e "${GREEN}✓ Created show ID: $SHOW_ID${NC}"

# Step 3: Create show instance for today at 5pm
echo -e "${YELLOW}→ Creating show instance for today at 5pm${NC}"
INSTANCE_RESPONSE=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"show\": $SHOW_ID,
    \"starts_at\": \"$SHOW_START\",
    \"ends_at\": \"$SHOW_END\",
    \"created_at\": \"$SHOW_START\",
    \"record_enabled\": 0,
    \"modified\": false,
    \"auto_playlist_built\": false
  }" \
  "$LT_URL/api/v2/show-instances")

INSTANCE_ID=$(echo "$INSTANCE_RESPONSE" | jq -r .id)

if [[ "$INSTANCE_ID" == "null" || -z "$INSTANCE_ID" ]]; then
    echo -e "${RED}ERROR: Failed to create show instance${NC}"
    echo "Response: $INSTANCE_RESPONSE"
    exit 1
fi
echo -e "${GREEN}✓ Created instance ID: $INSTANCE_ID${NC}"

# Step 4: Calculate track end time
LEN_CLEAN=$(echo $TRACK_LENGTH | sed 's/\.[0-9]*$//')  # Remove decimal seconds
TRACK_END=$(date -u -d "$SHOW_START + $(echo $LEN_CLEAN | sed 's/:/ hours /; s/:/ minutes /; s/$/ seconds/')" +%Y-%m-%dT%H:%M:%SZ)
echo "Track will end at: $TRACK_END"

# Step 5: Schedule the track
echo -e "${YELLOW}→ Scheduling track in the show${NC}"
SCHEDULE_RESPONSE=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"instance\": $INSTANCE_ID,
    \"file\": $FILE_ID,
    \"starts_at\": \"$SHOW_START\",
    \"ends_at\": \"$TRACK_END\",
    \"position\": 0,
    \"cue_in\": \"00:00:00\",
    \"cue_out\": \"$TRACK_LENGTH\",
    \"broadcasted\": 0
  }" \
  "$LT_URL/api/v2/schedule")

SCHEDULE_ID=$(echo "$SCHEDULE_RESPONSE" | jq -r .id)

if [[ "$SCHEDULE_ID" == "null" || -z "$SCHEDULE_ID" ]]; then
    echo -e "${RED}ERROR: Failed to create schedule item${NC}"
    echo "Response: $SCHEDULE_RESPONSE"
    exit 1
fi
echo -e "${GREEN}✓ Created schedule ID: $SCHEDULE_ID${NC}"

# Step 6: Verify the show and schedule
echo -e "${YELLOW}→ Verifying show creation${NC}"
SHOW_VERIFY=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/shows/$SHOW_ID")
echo "Show details:"
echo "$SHOW_VERIFY" | jq .

echo -e "${YELLOW}→ Verifying show instance${NC}"
INSTANCE_VERIFY=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/show-instances?show=$SHOW_ID")
echo "Instance details:"
echo "$INSTANCE_VERIFY" | jq .

echo -e "${YELLOW}→ Verifying schedule with track content${NC}"
SCHEDULE_VERIFY=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule?instance=$INSTANCE_ID")
echo "Schedule details:"
echo "$SCHEDULE_VERIFY" | jq .

# Check if track is properly scheduled
TRACK_SCHEDULED=$(echo "$SCHEDULE_VERIFY" | jq -r ".[] | select(.file == $FILE_ID) | .file")
if [[ "$TRACK_SCHEDULED" == "$FILE_ID" ]]; then
    echo -e "${GREEN}✓ Track successfully scheduled in the show!${NC}"
else
    echo -e "${RED}✗ Track not found in schedule${NC}"
fi

echo ""
echo -e "${BLUE}=== Test Complete ===${NC}"
echo "Created resources:"
echo "  Show: 'schedule show test 1' (ID: $SHOW_ID)"
echo "  Instance: Today at 5pm-6pm UTC (ID: $INSTANCE_ID)"
echo "  Schedule: Track '$TRACK_NAME' (ID: $SCHEDULE_ID)"
echo "  Track length: $TRACK_LENGTH"
echo "  Track end time: $TRACK_END"
echo ""

echo -e "${YELLOW}Cleanup commands:${NC}"
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/schedule/$SCHEDULE_ID\""
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/show-instances/$INSTANCE_ID\""
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/shows/$SHOW_ID\""
