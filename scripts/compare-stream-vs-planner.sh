#!/bin/bash
# Comprehensive comparison: What's streaming vs what's planned in Payload planner

set -euo pipefail

ICECAST_URL="http://localhost:8000/admin/stats.xml"
ICECAST_USER="admin"
ICECAST_PASS="269e61fe1a5f06f15ccf7b526dacdfdb"

echo "=========================================="
echo "STREAM vs PLANNER COMPARISON"
echo "=========================================="
echo ""

# Get what's currently playing in LibreTime
echo "=== 1. CURRENTLY STREAMING (LibreTime) ==="
LT_INFO=$(docker exec -i libretime-postgres-1 psql -U libretime -d libretime -At -F '|' -c \
    "SELECT COALESCE(s.instance_id::text, s.id::text), COALESCE(f.track_title,''), s.file_id::text, s.starts, s.ends FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id WHERE s.starts <= NOW() AND s.ends > NOW() LIMIT 1;" 2>/dev/null | tr -d '\r')

if [ -n "$LT_INFO" ]; then
    IFS='|' read -r INSTANCE_ID TRACK_TITLE FILE_ID START_TIME END_TIME <<< "$LT_INFO"
    echo "  Instance ID: $INSTANCE_ID"
    echo "  Track Title: $TRACK_TITLE"
    echo "  File/Track ID: $FILE_ID"
    echo "  Scheduled: $START_TIME - $END_TIME"
    
    # Get file details
    FILE_INFO=$(docker exec -i libretime-postgres-1 psql -U libretime -d libretime -At -F '|' -c \
        "SELECT f.filepath FROM cc_files f WHERE f.id = $FILE_ID LIMIT 1;" 2>/dev/null | tr -d '\r')
    if [ -n "$FILE_INFO" ]; then
        echo "  Filepath: $FILE_INFO"
        EPISODE_ID=$(echo "$FILE_INFO" | grep -oP '[a-f0-9]{24}(?=__)' | head -1 || echo "")
        if [ -n "$EPISODE_ID" ]; then
            echo "  Episode ID: $EPISODE_ID"
        fi
    fi
else
    echo "  ❌ No show currently scheduled in LibreTime"
    FILE_ID=""
    EPISODE_ID=""
fi

echo ""
echo "=== 2. DETERMINISTIC FEED (What LibreTime should play) ==="

if [ -f "/srv/payload/.env" ]; then
    PAYLOAD_API_KEY=$(grep -E '^PAYLOAD_API_KEY=' /srv/payload/.env | tail -1 | cut -d'=' -f2-)
    if [ -n "$PAYLOAD_API_KEY" ]; then
        FEED_RESPONSE=$(curl -s -H "Authorization: users API-Key $PAYLOAD_API_KEY" \
            "http://localhost:3000/api/schedule/deterministic?lookahead=120&maxItems=8" 2>&1)
        
        if echo "$FEED_RESPONSE" | python3 -c "import sys, json; json.load(sys.stdin)" >/dev/null 2>&1; then
            FEED_ID=$(echo "$FEED_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('items', [{}])[0].get('id', ''))" 2>/dev/null || echo "")
            FEED_TITLE=$(echo "$FEED_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('items', [{}])[0].get('track_title', d.get('items', [{}])[0].get('title', '')))" 2>/dev/null || echo "")
            FEED_START=$(echo "$FEED_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('items', [{}])[0].get('start_utc', ''))" 2>/dev/null || echo "")
            FEED_END=$(echo "$FEED_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('items', [{}])[0].get('end_utc', ''))" 2>/dev/null || echo "")
            
            echo "  Feed Track ID: $FEED_ID"
            echo "  Feed Title: $FEED_TITLE"
            echo "  Feed Scheduled: $FEED_START - $FEED_END"
        else
            echo "  ❌ Failed to parse deterministic feed"
        fi
    fi
fi

echo ""
echo "=== 3. PAYLOAD PLANNER (What's scheduled in CMS) ==="

if [ -n "$EPISODE_ID" ] && [ -f "/srv/payload/.env" ]; then
    PAYLOAD_API_KEY=$(grep -E '^PAYLOAD_API_KEY=' /srv/payload/.env | tail -1 | cut -d'=' -f2-)
    if [ -n "$PAYLOAD_API_KEY" ]; then
        EPISODE_RESPONSE=$(curl -s -H "Authorization: users API-Key $PAYLOAD_API_KEY" \
            "http://localhost:3000/api/episodes/$EPISODE_ID?depth=1" 2>&1)
        
        if echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; json.load(sys.stdin)" >/dev/null 2>&1; then
            PLANNER_ID=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('id', ''))" 2>/dev/null || echo "")
            PLANNER_TITLE=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('title', ''))" 2>/dev/null || echo "")
            PLANNER_SHOW=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); s=d.get('show', {}); print(s.get('title', '') if isinstance(s, dict) else str(s))" 2>/dev/null || echo "")
            PLANNER_SCHEDULED_AT=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('scheduledAt', ''))" 2>/dev/null || echo "")
            PLANNER_SCHEDULED_END=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('scheduledEnd', ''))" 2>/dev/null || echo "")
            PLANNER_TRACK_ID=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('libretimeTrackId', ''))" 2>/dev/null || echo "")
            PLANNER_AIR_STATUS=$(echo "$EPISODE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('airStatus', ''))" 2>/dev/null || echo "")
            
            echo "  Episode ID: $PLANNER_ID"
            echo "  Title: $PLANNER_TITLE"
            echo "  Show: $PLANNER_SHOW"
            echo "  Scheduled: $PLANNER_SCHEDULED_AT - $PLANNER_SCHEDULED_END"
            echo "  Track ID: $PLANNER_TRACK_ID"
            echo "  Air Status: $PLANNER_AIR_STATUS"
        else
            echo "  ❌ Failed to fetch episode from Payload"
        fi
    fi
fi

echo ""
echo "=== 4. COMPARISON SUMMARY ==="

if [ -n "$FILE_ID" ] && [ -n "$FEED_ID" ]; then
    if [ "$FILE_ID" = "$FEED_ID" ]; then
        echo "  ✅ Track IDs MATCH: $FILE_ID"
    else
        echo "  ❌ Track IDs MISMATCH:"
        echo "     LibreTime playing: $FILE_ID"
        echo "     Feed expects: $FEED_ID"
    fi
else
    echo "  ⚠️  Cannot compare track IDs"
fi

if [ -n "$PLANNER_TRACK_ID" ] && [ -n "$FILE_ID" ]; then
    if [ "$PLANNER_TRACK_ID" = "$FILE_ID" ]; then
        echo "  ✅ Planner Track ID matches stream: $PLANNER_TRACK_ID"
    else
        echo "  ❌ Planner Track ID MISMATCH:"
        echo "     Planner expects: $PLANNER_TRACK_ID"
        echo "     LibreTime playing: $FILE_ID"
    fi
fi

echo ""
echo "=== 5. ICECAST STATUS ==="
ICECAST_TITLE=$(curl -s -u "$ICECAST_USER:$ICECAST_PASS" "$ICECAST_URL" 2>&1 | \
    grep -oP "(?<=<title>)[^<]+" | head -1 || echo "OFFLINE")
echo "  Icecast Title: $ICECAST_TITLE"

echo ""
echo "=========================================="
















