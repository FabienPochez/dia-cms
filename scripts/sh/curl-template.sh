#!/bin/bash
# Curl Template for LibreTime Schedule Test
# Usage: LT_URL="https://schedule.diaradio.live" LT_API_KEY="your-key" FILE_ID="114" ./curl-template.sh

set -euo pipefail

# Environment variables
LT_URL="${LT_URL:-https://schedule.diaradio.live}"
LT_API_KEY="${LT_API_KEY:-}"
FILE_ID="${FILE_ID:-114}"

# Time windows
START=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
END_INST=$(date -u -d '+40 minutes' +%Y-%m-%dT%H:%M:%SZ)   # generous window

echo "=== LibreTime Schedule Test (Curl Template) ==="
echo "LT_URL: $LT_URL"
echo "FILE_ID: $FILE_ID"
echo "START: $START"
echo "END_INST: $END_INST"
echo ""

# Check prerequisites
if [[ -z "$LT_API_KEY" ]]; then
    echo "ERROR: LT_API_KEY environment variable not set"
    exit 1
fi

# Fetch track length
echo "→ Fetching track length..."
LEN=$(curl -s -H "Authorization: Api-Key $LT_API_KEY" \
  "$LT_URL/api/v2/files/$FILE_ID" | jq -r .length)

if [[ "$LEN" == "null" || -z "$LEN" ]]; then
    echo "WARNING: Could not get track length, using default 15 minutes"
    LEN="00:15:00"
else
    echo "Track length: $LEN"
fi

# Create show
echo "→ Creating show..."
SHOW_ID=$(curl -s -X POST -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dia-test-schedule",
    "description": "Curl template test",
    "live_enabled": true,
    "linked": false,
    "linkable": true,
    "auto_playlist_enabled": false,
    "auto_playlist_repeat": false,
    "override_intro_playlist": false,
    "override_outro_playlist": false
  }' \
  "$LT_URL/api/v2/shows" | jq -r .id)

echo "Created show ID: $SHOW_ID"

# Create instance
echo "→ Creating show instance..."
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

echo "Created instance ID: $INST_ID"

# Calculate track end time (handle decimal seconds)
LEN_CLEAN=$(echo $LEN | sed 's/\.[0-9]*$//')  # Remove decimal seconds
TRACK_END=$(date -u -d "$START + $(echo $LEN_CLEAN | sed 's/:/ hours /; s/:/ minutes /; s/$/ seconds/')" +%Y-%m-%dT%H:%M:%SZ)

# Schedule item
echo "→ Scheduling file..."
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
echo "Created schedule ID: $SCHED_ID"

# Verify
echo "→ Verifying schedule..."
curl -s -H "Authorization: Api-Key $LT_API_KEY" \
  "$LT_URL/api/v2/schedule?instance=$INST_ID" | jq .

echo ""
echo "=== Test Complete ==="
echo "Created resources:"
echo "  Show ID: $SHOW_ID"
echo "  Instance ID: $INST_ID"
echo "  Schedule ID: $SCHED_ID"
echo "  Track length: $LEN"
echo "  Track end time: $TRACK_END"
echo ""
echo "Cleanup commands:"
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/schedule/$SCHED_ID\""
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/show-instances/$INST_ID\""
echo "curl -X DELETE -H \"Authorization: Api-Key $LT_API_KEY\" \"$LT_URL/api/v2/shows/$SHOW_ID\""
