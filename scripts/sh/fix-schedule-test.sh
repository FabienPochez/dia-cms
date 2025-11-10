#!/bin/bash
# Fix Schedule Test - Create proper schedule with all required fields

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

echo -e "${BLUE}=== Fix Schedule Test ===${NC}"

# Delete the existing schedule item first
echo -e "${YELLOW}→ Deleting existing schedule item 18${NC}"
curl -s -X DELETE -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule/18"

# Get track info
echo -e "${YELLOW}→ Getting track information${NC}"
TRACK_INFO=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/files/$FILE_ID")
TRACK_LENGTH=$(echo "$TRACK_INFO" | jq -r .length)
TRACK_NAME=$(echo "$TRACK_INFO" | jq -r '.track_title // .name // "Unknown Track"')

echo "Track: $TRACK_NAME"
echo "Length: $TRACK_LENGTH"

# Create new schedule item with all proper fields
echo -e "${YELLOW}→ Creating new schedule item with all fields${NC}"
SHOW_START="2025-09-24T17:00:00Z"
LEN_CLEAN=$(echo $TRACK_LENGTH | sed 's/\.[0-9]*$//')
TRACK_END=$(date -u -d "$SHOW_START + $(echo $LEN_CLEAN | sed 's/:/ hours /; s/:/ minutes /; s/$/ seconds/')" +%Y-%m-%dT%H:%M:%SZ)

NEW_SCHEDULE=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"instance\": 12,
    \"file\": $FILE_ID,
    \"starts_at\": \"$SHOW_START\",
    \"ends_at\": \"$TRACK_END\",
    \"length\": \"$TRACK_LENGTH\",
    \"position\": 0,
    \"cue_in\": \"00:00:00\",
    \"cue_out\": \"$TRACK_LENGTH\",
    \"broadcasted\": 0
  }" \
  "$LT_URL/api/v2/schedule")

NEW_SCHEDULE_ID=$(echo "$NEW_SCHEDULE" | jq -r .id)
echo -e "${GREEN}✓ Created new schedule ID: $NEW_SCHEDULE_ID${NC}"

# Check the schedule
echo -e "${YELLOW}→ Checking new schedule item${NC}"
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule/$NEW_SCHEDULE_ID" | jq .

# Check if show instance is now properly filled
echo -e "${YELLOW}→ Checking if show instance is now filled${NC}"
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/show-instances/12" | jq .

# Check all schedules for this instance
echo -e "${YELLOW}→ Checking all schedules for instance 12${NC}"
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule?instance=12" | jq .

echo -e "${GREEN}=== Fix Complete ===${NC}"
