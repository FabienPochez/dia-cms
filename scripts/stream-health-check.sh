#!/bin/bash
# Stream Health Check – detects playout desync and restarts playout/liquidsoap when required.

set -euo pipefail

ICECAST_URL="http://localhost:8000/admin/stats.xml"
ICECAST_USER="admin"
# Try to get password from environment, fallback to old value
ICECAST_PASS="${ICECAST_ADMIN_PASSWORD:-Wclzap2entCrO3elozblw6SOT}"
STATE_FILE="/tmp/stream-health-state.json"
LOG_FILE="/var/log/dia-cron/stream-health.log"
RESTART_THRESHOLD=60
DETERMINISTIC_FEED_URL_DEFAULT="https://content.diaradio.live/api/schedule/deterministic?lookahead=120&maxItems=8"
FEED_URL="${DETERMINISTIC_FEED_URL:-$DETERMINISTIC_FEED_URL_DEFAULT}"
DETERMINISTIC_FEED_AUTHORIZATION=${DETERMINISTIC_FEED_AUTHORIZATION:-}
DETERMINISTIC_FEED_TOKEN=${DETERMINISTIC_FEED_TOKEN:-}
PAYLOAD_API_KEY=${PAYLOAD_API_KEY:-}
FEED_STALE_THRESHOLD=${FEED_STALE_THRESHOLD:-600}
LONGTRACK_SKEW_PCT=${LONGTRACK_SKEW_PCT:-0.10}
LONGTRACK_SKEW_MIN=${LONGTRACK_SKEW_MIN:-600}
LONGTRACK_SKEW_MAX=${LONGTRACK_SKEW_MAX:-1200}
END_TIME_VIOLATION_THRESHOLD=${END_TIME_VIOLATION_THRESHOLD:-60}
RESTART_COOLDOWN_MIN=${RESTART_COOLDOWN_MIN:-10}
RESTART_COOLDOWN_SEC=$((RESTART_COOLDOWN_MIN * 60))
WATCHDOG_STRICT=${WATCHDOG_STRICT:-false}
RESTARTS_ENABLED=${RESTARTS_ENABLED:-true}
FEED_RECENT_WINDOW=${FEED_RECENT_WINDOW:-600}
FEED_ERROR_ESCALATE_THRESHOLD=${FEED_ERROR_ESCALATE_THRESHOLD:-600}

if [ -z "$PAYLOAD_API_KEY" ] && [ -f "/srv/payload/.env" ]; then
    PAYLOAD_API_KEY=$(grep -E '^PAYLOAD_API_KEY=' /srv/payload/.env | tail -1 | cut -d'=' -f2-)
fi

if [ -z "$DETERMINISTIC_FEED_TOKEN" ]; then
    DETERMINISTIC_FEED_TOKEN="$PAYLOAD_API_KEY"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"
}

normalize_title() {
    local title="$1"
    echo "$title" | python3 -c "import sys, html; print(html.unescape(sys.stdin.read().strip()))" 2>/dev/null || echo "$title"
}

get_icecast_title() {
    curl -s -u "$ICECAST_USER:$ICECAST_PASS" "$ICECAST_URL" 2>&1 | \
        grep -oP "(?<=<title>)[^<]+" | head -1 || echo "OFFLINE"
}

get_icecast_bytes() {
    curl -s -u "$ICECAST_USER:$ICECAST_PASS" "$ICECAST_URL" 2>&1 | \
        grep -oP "(?<=<total_bytes_read>)[^<]+" || echo "0"
}

get_icecast_stats() {
    local stats_xml
    stats_xml=$(curl -s -u "$ICECAST_USER:$ICECAST_PASS" "$ICECAST_URL" 2>&1)
    local listeners=0
    local bytes_in=0
    local bytes_out=0
    
    if [ -n "$stats_xml" ]; then
        listeners=$(echo "$stats_xml" | grep -oP "(?<=<listeners>)[^<]+" | head -1 || echo "0")
        bytes_in=$(echo "$stats_xml" | grep -oP "(?<=<total_bytes_sent>)[^<]+" | head -1 || echo "0")
        bytes_out=$(echo "$stats_xml" | grep -oP "(?<=<total_bytes_read>)[^<]+" | head -1 || echo "0")
    fi
    
    echo "$listeners|$bytes_in|$bytes_out"
}

get_liquidsoap_now_playing() {
    docker exec libretime-playout-1 python3 << 'PYEOF' 2>/dev/null || echo "error|error|error"
import sys
import os
sys.path.insert(0, '/src')
try:
    from libretime_playout.player.liquidsoap import TelnetLiquidsoap
    
    class MinimalClient:
        def __init__(self):
            self.host = os.getenv('LIQUIDSOAP_HOST', 'liquidsoap')
            self.port = int(os.getenv('LIQUIDSOAP_PORT', '1234'))
            self.socket_path = os.getenv('LIQUIDSOAP_SOCKET', '')
    
    client = MinimalClient()
    telnet = TelnetLiquidsoap(client, [0, 1, 2, 3, 4])
    result = telnet.get_now_playing()
    
    row_id = str(result.get('actual_row_id', 'none'))
    title = result.get('actual_title', 'none') or 'none'
    ok = 'true' if result.get('ok', False) else 'false'
    
    print(f"{row_id}|{title}|{ok}")
except Exception as e:
    print(f"error|error|error")
PYEOF
}

get_current_track_duration() {
    docker exec -i libretime-postgres-1 psql -U libretime -d libretime -t -c \
        "SELECT EXTRACT(EPOCH FROM f.length) FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id WHERE s.starts <= NOW() AND s.ends > NOW() LIMIT 1;" 2>/dev/null | \
        tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || echo "0"
}

FEED_STATUS_HEADER="unknown"
FEED_STATUS_BODY="unknown"
FEED_MISSING_COUNT=0
FEED_TOTAL_COUNT=0
FEED_GENERATED_AT=""
FEED_AGE_SEC=""
FEED_VERSION_DELTA=""
FEED_LAST_OK_VERSION=""
FEED_FIRST_START=""
FEED_FIRST_ID=""
FEED_FIRST_TITLE=""
FEED_FIRST_DURATION=""
FEED_DELTA_SEC=""
FEED_EXPECTED_POS=""

check_deterministic_feed() {
    if [ -z "$FEED_URL" ]; then
        return
    fi

    local auth="$DETERMINISTIC_FEED_AUTHORIZATION"
    if [ -z "$auth" ] && [ -n "$DETERMINISTIC_FEED_TOKEN" ]; then
        auth="Bearer $DETERMINISTIC_FEED_TOKEN"
    fi
    if [ -z "$auth" ] && [ -n "$PAYLOAD_API_KEY" ]; then
        auth="users API-Key $PAYLOAD_API_KEY"
    fi
    if [ -z "$auth" ]; then
        return
    fi

    local header_file
    header_file=$(mktemp)

    local feed_response
    if ! feed_response=$(curl -sS --compressed --fail --max-time 4 \
        -D "$header_file" \
        -H "Accept: application/json" \
        -H "Authorization: $auth" \
        "$FEED_URL" 2>/dev/null); then
        log "${YELLOW}⚠️  Deterministic feed fetch failed (monitor)${NC}"
        rm -f "$header_file"
        return
    fi

    FEED_STATUS_HEADER=$(grep -i '^[[:space:]]*X-Feed-Status:' "$header_file" | tail -1 | cut -d':' -f2- | tr -d '\r' | xargs || echo "unknown")
    [ -z "$FEED_STATUS_HEADER" ] && FEED_STATUS_HEADER="unknown"
    local header_version
    header_version=$(grep -i '^[[:space:]]*X-Feed-Version:' "$header_file" | tail -1 | cut -d':' -f2- | tr -d '\r' | xargs || echo "")
    rm -f "$header_file"

    local version
    version=$(echo "$feed_response" | jq -r '.scheduleVersion // empty')
    if [ -z "$version" ]; then
        log "${YELLOW}⚠️  Deterministic feed response missing scheduleVersion${NC}"
        return
    fi

    FEED_STATUS_BODY=$(echo "$feed_response" | jq -r '.feed_status // empty')
    [ -z "$FEED_STATUS_BODY" ] && FEED_STATUS_BODY="unknown"
    FEED_MISSING_COUNT=$(echo "$feed_response" | jq -r '.missing_count // 0')
    FEED_TOTAL_COUNT=$(echo "$feed_response" | jq -r '.total_count // 0')
    FEED_LAST_OK_VERSION=$(echo "$feed_response" | jq -r '.last_ok_version // empty')
    FEED_GENERATED_AT=$(echo "$feed_response" | jq -r '.generatedAt_utc // empty')
    FEED_FIRST_START=$(echo "$feed_response" | jq -r '.items[0].start_utc // empty')
    FEED_FIRST_END=$(echo "$feed_response" | jq -r '.items[0].end_utc // empty')
    FEED_FIRST_ID=$(echo "$feed_response" | jq -r '.items[0].id // .items[0].instance_id // empty')
    FEED_FIRST_TITLE=$(echo "$feed_response" | jq -r '.items[0].title // .items[0].show_title // .items[0].show_name // .items[0].show_slug // empty')
    FEED_FIRST_DURATION=$(echo "$feed_response" | jq -r '.items[0].duration_sec // 0')

    local now_ts=$(date -u +%s)
    local now_utc=$(date -u +"%Y-%m-%dT%H:%M:%S")

    FEED_VERSION="$version"
    if [ -n "$header_version" ] && [ "$header_version" != "$version" ]; then
        log "${YELLOW}⚠️  Header/version mismatch: header=${header_version} body=${version}${NC}"
    fi

    if [ "$PREV_FEED_VERSION" != "$version" ]; then
        FEED_VERSION_TS=$now_ts
        FEED_STALE_LOGGED="false"
        log "${GREEN}📡 Feed update: version=$version status=${FEED_STATUS_HEADER}/${FEED_STATUS_BODY} missing=${FEED_MISSING_COUNT}/${FEED_TOTAL_COUNT}${NC}"
    else
        FEED_VERSION_TS="$PREV_FEED_VERSION_TS"
    fi

    if [ -n "$FEED_FIRST_START" ]; then
        local first_start_ts
        first_start_ts=$(date -u -d "${FEED_FIRST_START}Z" +%s 2>/dev/null || echo "")
        if [ -n "$first_start_ts" ]; then
            FEED_DELTA_SEC=$(( first_start_ts - now_ts ))
            FEED_EXPECTED_POS=$(( now_ts - first_start_ts ))
            log "Feed check: version=$version now_utc=$now_utc first_start=$FEED_FIRST_START |Δ|=${FEED_DELTA_SEC#-}s"
        fi
    fi

    FEED_FIRST_END_TS=""
    if [ -n "$FEED_FIRST_END" ]; then
        FEED_FIRST_END_TS=$(date -u -d "${FEED_FIRST_END}Z" +%s 2>/dev/null || echo "")
    fi

    if [ -n "$FEED_GENERATED_AT" ]; then
        local generated_ts
        generated_ts=$(date -u -d "${FEED_GENERATED_AT}Z" +%s 2>/dev/null || echo "")
        if [[ "$generated_ts" =~ ^[0-9]+$ ]]; then
            FEED_AGE_SEC=$(( now_ts - generated_ts ))
        fi
    fi

    if [[ "$FEED_VERSION_TS" =~ ^[0-9]+$ ]] && [ "$FEED_VERSION" != "null" ]; then
        local elapsed=$(( now_ts - FEED_VERSION_TS ))
        FEED_VERSION_DELTA=$elapsed
        if [ "$elapsed" -ge "$FEED_STALE_THRESHOLD" ]; then
            if [ "$FEED_STALE_LOGGED" != "true" ]; then
                log "${YELLOW}⚠️  feed_stale: scheduleVersion $FEED_VERSION unchanged for ${elapsed}s${NC}"
                FEED_STALE_LOGGED="true"
            fi
        else
            FEED_STALE_LOGGED="false"
        fi
    fi
}

BOOT_SENTINEL="/tmp/stream-health-bootinfo.logged"
if [ ! -f "$BOOT_SENTINEL" ]; then
    SERVER_TZ=$(date +%Z%z)
    PY_TZ=$(python3 -c "import datetime; print(datetime.datetime.now().astimezone().tzinfo)")
    log "${YELLOW}🪵 Boot info: server_tz=${SERVER_TZ}, python_tz=${PY_TZ}${NC}"
    touch "$BOOT_SENTINEL"
fi

PREV_MISMATCH_START="null"
PREV_BYTES="0"
PREV_FEED_VERSION="null"
PREV_FEED_VERSION_TS="0"
PREV_FEED_STALE_LOGGED="false"
PREV_FEED_FIRST_START=""
PREV_FEED_FIRST_END=""
PREV_FEED_FIRST_END_TS=""
PREV_SCHEDULE_KEY=""
PREV_FEED_FIRST_ID=""
PREV_LAST_RESTART_TS="0"
PREV_FEED_STATUS_HEADER="unknown"
PREV_FEED_STATUS_BODY="unknown"
PREV_FEED_AGE_SEC=""
PREV_FEED_VERSION_DELTA=""
PREV_FEED_MISSING_COUNT=0
PREV_FEED_TOTAL_COUNT=0
PREV_FEED_LAST_OK_VERSION=""
PREV_ICECAST_TITLE=""
PREV_UNKNOWN_START_TS="0"
PREV_UNKNOWN_CONSECUTIVE_COUNT=0

if [ -f "$STATE_FILE" ]; then
    PREV_MISMATCH_START=$(jq -r '.mismatch_start // "null"' "$STATE_FILE")
    PREV_BYTES=$(jq -r '.bytes // "0"' "$STATE_FILE")
    PREV_FEED_VERSION=$(jq -r '.feed_version // "null"' "$STATE_FILE")
    PREV_FEED_VERSION_TS=$(jq -r '.feed_version_seen_at // "0"' "$STATE_FILE")
    PREV_FEED_STALE_LOGGED=$(jq -r '.feed_stale_logged // "false"' "$STATE_FILE")
    PREV_FEED_FIRST_START=$(jq -r '.feed_first_start // ""' "$STATE_FILE")
    PREV_FEED_FIRST_END=$(jq -r '.feed_first_end // ""' "$STATE_FILE")
    PREV_FEED_FIRST_END_TS=$(jq -r '.feed_first_end_ts // ""' "$STATE_FILE")
    PREV_SCHEDULE_KEY=$(jq -r '.schedule_key // ""' "$STATE_FILE")
    PREV_FEED_FIRST_ID=$(jq -r '.feed_first_id // ""' "$STATE_FILE")
    PREV_LAST_RESTART_TS=$(jq -r '.last_restart_ts // "0"' "$STATE_FILE")
    PREV_FEED_STATUS_HEADER=$(jq -r '.feed_status_header // "unknown"' "$STATE_FILE")
    PREV_FEED_STATUS_BODY=$(jq -r '.feed_status_body // "unknown"' "$STATE_FILE")
    PREV_FEED_AGE_SEC=$(jq -r '.feed_age_sec // ""' "$STATE_FILE")
    PREV_FEED_VERSION_DELTA=$(jq -r '.feed_version_delta // ""' "$STATE_FILE")
    PREV_FEED_MISSING_COUNT=$(jq -r '.feed_missing_count // 0' "$STATE_FILE")
    PREV_FEED_TOTAL_COUNT=$(jq -r '.feed_total_count // 0' "$STATE_FILE")
    PREV_FEED_LAST_OK_VERSION=$(jq -r '.feed_last_ok_version // ""' "$STATE_FILE")
    PREV_ICECAST_TITLE=$(jq -r '.icecast_title // ""' "$STATE_FILE")
    PREV_UNKNOWN_START_TS=$(jq -r '.unknown_start_ts // "0"' "$STATE_FILE")
    PREV_UNKNOWN_CONSECUTIVE_COUNT=$(jq -r '.unknown_consecutive_count // 0' "$STATE_FILE")
fi

FEED_VERSION="$PREV_FEED_VERSION"
FEED_VERSION_TS="$PREV_FEED_VERSION_TS"
FEED_STALE_LOGGED="$PREV_FEED_STALE_LOGGED"
FEED_FIRST_START="$PREV_FEED_FIRST_START"
FEED_FIRST_END="$PREV_FEED_FIRST_END"
FEED_FIRST_END_TS="$PREV_FEED_FIRST_END_TS"
FEED_FIRST_ID="$PREV_FEED_FIRST_ID"
FEED_FIRST_TITLE=""
FEED_FIRST_DURATION=""
FEED_EXPECTED_POS=""
FEED_STATUS_HEADER="$PREV_FEED_STATUS_HEADER"
FEED_STATUS_BODY="$PREV_FEED_STATUS_BODY"
FEED_AGE_SEC="$PREV_FEED_AGE_SEC"
FEED_VERSION_DELTA="$PREV_FEED_VERSION_DELTA"
FEED_MISSING_COUNT="$PREV_FEED_MISSING_COUNT"
FEED_TOTAL_COUNT="$PREV_FEED_TOTAL_COUNT"
FEED_LAST_OK_VERSION="$PREV_FEED_LAST_OK_VERSION"

ICECAST_TITLE=$(get_icecast_title)
ICECAST_BYTES=$(get_icecast_bytes)
[ -z "$ICECAST_BYTES" ] && ICECAST_BYTES="0"

SCHEDULE_INSTANCE_ID=""
SCHEDULED_TITLE="NONE"
TRACK_DURATION=0
TRACK_ELAPSED=0
CURRENTLY_PLAYING_TRACK_ID=""
info=$(docker exec -i libretime-postgres-1 psql -U libretime -d libretime -At -F '|' -c \
    "SELECT COALESCE(s.instance_id::text, s.id::text), COALESCE(f.track_title,''), EXTRACT(EPOCH FROM f.length), EXTRACT(EPOCH FROM (NOW() - s.starts)), s.file_id::text FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id WHERE s.starts <= NOW() AND s.ends > NOW() LIMIT 1;" 2>/dev/null | tr -d '\r')
if [ -n "$info" ]; then
    IFS='|' read -r SCHEDULE_INSTANCE_ID SCHEDULED_TITLE TRACK_DURATION TRACK_ELAPSED CURRENTLY_PLAYING_TRACK_ID <<< "$info"
fi

check_deterministic_feed || true

# Track ID verification - detect schedule slipping
TRACK_ID_MISMATCH=false
if [ -n "$CURRENTLY_PLAYING_TRACK_ID" ] && [ -n "$FEED_FIRST_ID" ]; then
    if [ "$CURRENTLY_PLAYING_TRACK_ID" != "$FEED_FIRST_ID" ]; then
        TRACK_ID_MISMATCH=true
        log "⚠️  Track ID mismatch: playing=${CURRENTLY_PLAYING_TRACK_ID} expected=${FEED_FIRST_ID}"
    fi
fi

# Detect schedule changes (A2)
FEED_SCHEDULE_CHANGED=false
SCHEDULE_CHANGE_ACTIVE=false
SCHEDULE_CHANGE_GRACE_SEC=45

# Get current timestamp for schedule change detection
NOW_TS=$(date +%s)

if [ -n "$FEED_FIRST_START" ] && [ -n "$PREV_FEED_FIRST_START" ]; then
    if [ "$FEED_FIRST_START" != "$PREV_FEED_FIRST_START" ] || [ "$FEED_FIRST_ID" != "$PREV_FEED_FIRST_ID" ]; then
        FEED_SCHEDULE_CHANGED=true
        log "Feed schedule changed: first_start=${PREV_FEED_FIRST_START}→${FEED_FIRST_START} first_id=${PREV_FEED_FIRST_ID}→${FEED_FIRST_ID}"
        
        # Check if grace period has passed
        if [ -n "$FEED_FIRST_START" ]; then
            new_first_start_ts=$(date -u -d "${FEED_FIRST_START}Z" +%s 2>/dev/null || echo "")
            if [ -n "$new_first_start_ts" ] && [[ "$new_first_start_ts" =~ ^[0-9]+$ ]]; then
                grace_threshold=$(( new_first_start_ts + SCHEDULE_CHANGE_GRACE_SEC ))
                if [ "$NOW_TS" -ge "$grace_threshold" ]; then
                    SCHEDULE_CHANGE_ACTIVE=true
                fi
            fi
        fi
    fi
fi

FEED_STATUS_EFFECTIVE="$FEED_STATUS_HEADER"
[ -z "$FEED_STATUS_EFFECTIVE" ] || [ "$FEED_STATUS_EFFECTIVE" = "unknown" ] && FEED_STATUS_EFFECTIVE="$FEED_STATUS_BODY"
FEED_STATUS_EFFECTIVE=$(echo "$FEED_STATUS_EFFECTIVE" | tr '[:upper:]' '[:lower:]')
[ -z "$FEED_STATUS_EFFECTIVE" ] && FEED_STATUS_EFFECTIVE="unknown"

if [ "$FEED_STATUS_EFFECTIVE" != "$(echo "$PREV_FEED_STATUS_HEADER" | tr '[:upper:]' '[:lower:]')" ]; then
    log "${YELLOW}ℹ️  feed_status=${FEED_STATUS_EFFECTIVE} missing=${FEED_MISSING_COUNT}/${FEED_TOTAL_COUNT}${NC}"
fi

ALLOWED_SKEW=$RESTART_THRESHOLD
TRACK_DURATION_SEC=${TRACK_DURATION%.*}
TRACK_DURATION_SEC=${TRACK_DURATION_SEC:-0}

FEED_DURATION_SEC=""
if [ -n "$FEED_FIRST_DURATION" ] && [ "$FEED_FIRST_DURATION" != "null" ]; then
    FEED_DURATION_SEC=$(python3 - "$FEED_FIRST_DURATION" <<'PY'
import sys
try:
    val = float(sys.argv[1])
except Exception:
    sys.exit()
if val > 0:
    print(int(round(val)))
PY
    )
    FEED_DURATION_SEC=$(echo "$FEED_DURATION_SEC" | tr -d '\r')
fi
[ -n "$FEED_DURATION_SEC" ] && FEED_DURATION_SEC=$(echo "$FEED_DURATION_SEC" | tr -d '[:space:]')

DURATION_MISMATCH=false
DURATION_RATIO="n/a"
if [ "$TRACK_DURATION_SEC" -gt 0 ] && [ -n "$FEED_DURATION_SEC" ] && [ "$FEED_DURATION_SEC" -gt 0 ] 2>/dev/null; then
    if [ "$TRACK_DURATION_SEC" -gt $(( FEED_DURATION_SEC * 2 )) ] || [ "$FEED_DURATION_SEC" -gt $(( TRACK_DURATION_SEC * 2 )) ]; then
        DURATION_MISMATCH=true
    fi
    ratio_out=$(python3 - "$TRACK_DURATION_SEC" "$FEED_DURATION_SEC" <<'PY'
import sys
try:
    a = float(sys.argv[1])
    b = float(sys.argv[2])
except Exception:
    sys.exit()
if a > 0 and b > 0:
    ratio = max(a, b) / min(a, b)
    print(f"{ratio:.2f}")
PY
    )
    [ -n "$ratio_out" ] && DURATION_RATIO=$(echo "$ratio_out" | tr -d '\r')
fi

REFERENCE_DURATION_SEC=0
SKEW_SOURCE="base"
if [ -n "$FEED_DURATION_SEC" ] && [ "$FEED_DURATION_SEC" -gt 0 ] 2>/dev/null; then
    REFERENCE_DURATION_SEC=$FEED_DURATION_SEC
    SKEW_SOURCE="feed"
elif [ "$TRACK_DURATION_SEC" -gt 0 ]; then
    REFERENCE_DURATION_SEC=$TRACK_DURATION_SEC
    SKEW_SOURCE="libretime"
fi

if [ "$WATCHDOG_STRICT" != "true" ] && [ "$REFERENCE_DURATION_SEC" -gt 0 ] && [ "$DURATION_MISMATCH" = false ]; then
    ALLOWED_SKEW=$(python3 - "$REFERENCE_DURATION_SEC" "$LONGTRACK_SKEW_PCT" "$LONGTRACK_SKEW_MIN" "$LONGTRACK_SKEW_MAX" <<'PY'
import math, sys
length = float(sys.argv[1])
pct = float(sys.argv[2])
min_allowed = int(float(sys.argv[3]))
max_allowed = int(float(sys.argv[4]))
value = math.ceil(length * pct)
value = max(min_allowed, min(value, max_allowed))
print(int(value))
PY
    )
fi

if [ "$WATCHDOG_STRICT" = "true" ] || [ "$DURATION_MISMATCH" = true ] || [ -z "$ALLOWED_SKEW" ] || ! [[ "$ALLOWED_SKEW" =~ ^[0-9]+$ ]]; then
    ALLOWED_SKEW=$RESTART_THRESHOLD
fi

log "Duration check: feed=${FEED_DURATION_SEC:-n/a}s libre=${TRACK_DURATION_SEC:-n/a}s ratio=${DURATION_RATIO} skew=${ALLOWED_SKEW}s source=${SKEW_SOURCE}"
log "Icecast: '$ICECAST_TITLE' | Scheduled: '$SCHEDULED_TITLE' | Bytes: $ICECAST_BYTES"

ICECAST_NORMALIZED=$(normalize_title "$ICECAST_TITLE")
SCHEDULED_NORMALIZED=$(normalize_title "$SCHEDULED_TITLE")
ICECAST_SHORT=$(echo "$ICECAST_NORMALIZED" | cut -c1-20)
SCHEDULED_SHORT=$(echo "$SCHEDULED_NORMALIZED" | cut -c1-20)

MISMATCH=false
FROZEN=false
OFFLINE_CARRIER=false

if [ "$SCHEDULED_TITLE" != "NONE" ] && [ "$SCHEDULED_TITLE" != "ERROR" ]; then
    if [[ ! "$ICECAST_SHORT" =~ "$SCHEDULED_SHORT" ]]; then
        MISMATCH=true
    fi
fi

# Add track ID mismatch check - triggers restarts via existing mechanism
if [ "$TRACK_ID_MISMATCH" = true ]; then
    MISMATCH=true
fi

if [ "$ICECAST_BYTES" -le "$PREV_BYTES" ] && [ "$ICECAST_BYTES" != "0" ]; then
    FROZEN=true
fi
if [ "$ICECAST_BYTES" = "0" ]; then
    OFFLINE_CARRIER=true
    FROZEN=true
    MISMATCH=true
    log "${YELLOW}⚠️  Icecast reports bytes=0 (carrier offline)${NC}"
fi

NOW_TS=$(date +%s)
COOLDOWN_ACTIVE=false
if [[ "$PREV_LAST_RESTART_TS" =~ ^[0-9]+$ ]] && [ "$PREV_LAST_RESTART_TS" -gt 0 ]; then
    local_elapsed=$(( NOW_TS - PREV_LAST_RESTART_TS ))
    if [ "$local_elapsed" -lt "$RESTART_COOLDOWN_SEC" ]; then
        COOLDOWN_ACTIVE=true
    fi
fi

TRACK_ELAPSED_SEC=${TRACK_ELAPSED%.*}
TRACK_ELAPSED_SEC=${TRACK_ELAPSED_SEC:-0}

FEED_EXPECTED_POS_SEC=""
if [ -n "$FEED_EXPECTED_POS" ]; then
    FEED_EXPECTED_POS_SEC=${FEED_EXPECTED_POS#-}
    if [ "$FEED_EXPECTED_POS" -lt 0 ]; then
        FEED_EXPECTED_POS_SEC=0
    else
        FEED_EXPECTED_POS_SEC=$FEED_EXPECTED_POS
    fi
fi

PLAYER_SKEW=""
PLAYER_SKEW_ABS=""
WITHIN_ALLOWED_SKEW=false
if [ -n "$FEED_EXPECTED_POS_SEC" ] && [ "$TRACK_ELAPSED_SEC" -ge 0 ]; then
    PLAYER_SKEW=$(( TRACK_ELAPSED_SEC - FEED_EXPECTED_POS_SEC ))
    PLAYER_SKEW_ABS=${PLAYER_SKEW#-}
    if [ "$PLAYER_SKEW_ABS" -le "$ALLOWED_SKEW" ]; then
        WITHIN_ALLOWED_SKEW=true
    fi
fi

VERSION_AGE=""
if [[ "$FEED_VERSION_TS" =~ ^[0-9]+$ ]] && [ "$FEED_VERSION_TS" -gt 0 ]; then
    VERSION_AGE=$(( NOW_TS - FEED_VERSION_TS ))
fi
[ -n "$VERSION_AGE" ] && FEED_VERSION_DELTA=$VERSION_AGE
FEED_FRESH=false
if [ -n "$VERSION_AGE" ] && [ "$VERSION_AGE" -le "$FEED_RECENT_WINDOW" ]; then
    FEED_FRESH=true
fi

SCHEDULE_KEY="$SCHEDULE_INSTANCE_ID"
[ -z "$SCHEDULE_KEY" ] && SCHEDULE_KEY=$(echo "$SCHEDULED_SHORT" | tr '[:upper:]' '[:lower:]')

STABLE_LONGTRACK=false
if [ "$ICECAST_BYTES" -gt "$PREV_BYTES" ]; then
    if [ -n "$SCHEDULE_KEY" ] && [ "$SCHEDULE_KEY" = "$PREV_SCHEDULE_KEY" ]; then
        STABLE_LONGTRACK=true
    fi
    if [ -n "$FEED_FIRST_ID" ] && [ "$FEED_FIRST_ID" = "$PREV_FEED_FIRST_ID" ]; then
        STABLE_LONGTRACK=true
    fi
fi

# Check if current show has exceeded its scheduled end time
SHOW_EXCEEDED_END_TIME=false
SHOW_EXCEEDED_SEC=0
SHOW_BOUNDARY_CROSSED=false
if [ -n "$FEED_FIRST_END_TS" ] && [[ "$FEED_FIRST_END_TS" =~ ^[0-9]+$ ]] && [ "$NOW_TS" -gt "$FEED_FIRST_END_TS" ]; then
    SHOW_EXCEEDED_END_TIME=true
    SHOW_EXCEEDED_SEC=$(( NOW_TS - FEED_FIRST_END_TS ))
    # End time override: if show exceeded end by more than 60s, override all suppressions
    if [ "$SHOW_EXCEEDED_SEC" -gt 60 ]; then
        SHOW_BOUNDARY_CROSSED=true
        log "${YELLOW}⚠️  Show boundary crossed: end=$FEED_FIRST_END exceeded_by=${SHOW_EXCEEDED_SEC}s (overriding suppressions)${NC}"
    elif [ "$SHOW_EXCEEDED_SEC" -gt 0 ]; then
        log "${YELLOW}⚠️  Show exceeded end time: end=$FEED_FIRST_END exceeded_by=${SHOW_EXCEEDED_SEC}s${NC}"
    fi
fi

# Critical title states - with debouncing and audio health check
ICECAST_TITLE_UPPER=$(echo "$ICECAST_TITLE" | tr '[:lower:]' '[:upper:]')
CRITICAL_TITLE=false
UNKNOWN_TITLE=false
UNKNOWN_START_TS="$PREV_UNKNOWN_START_TS"
UNKNOWN_CONSECUTIVE_COUNT="$PREV_UNKNOWN_CONSECUTIVE_COUNT"
AUDIO_HEALTHY=true

# Detect Unknown/Offline/empty title
if [ "$ICECAST_TITLE_UPPER" = "UNKNOWN" ] || [ "$ICECAST_TITLE_UPPER" = "OFFLINE" ] || [ -z "$ICECAST_TITLE" ] || [ "$ICECAST_TITLE" = "" ]; then
    UNKNOWN_TITLE=true
    
    # Track consecutive Unknown checks
    if [ "$ICECAST_TITLE" != "$PREV_ICECAST_TITLE" ] || [ "$PREV_UNKNOWN_START_TS" = "0" ]; then
        # Unknown just started or changed
        UNKNOWN_START_TS=$NOW_TS
        UNKNOWN_CONSECUTIVE_COUNT=1
    else
        # Unknown continues
        UNKNOWN_CONSECUTIVE_COUNT=$((PREV_UNKNOWN_CONSECUTIVE_COUNT + 1))
    fi
    
    # Check audio health: bytes must be increasing
    if [ "$ICECAST_BYTES" -le "$PREV_BYTES" ] && [ "$ICECAST_BYTES" != "0" ]; then
        AUDIO_HEALTHY=false
    fi
    
    # Get context for logging
    LIQ_NOW_PLAYING=$(get_liquidsoap_now_playing)
    IFS='|' read -r LIQ_ROW_ID LIQ_TITLE LIQ_OK <<< "$LIQ_NOW_PLAYING"
    
    ICE_STATS=$(get_icecast_stats)
    IFS='|' read -r ICE_LISTENERS ICE_BYTES_IN ICE_BYTES_OUT <<< "$ICE_STATS"
    
    UNKNOWN_DURATION=0
    if [ "$UNKNOWN_START_TS" != "0" ]; then
        UNKNOWN_DURATION=$((NOW_TS - UNKNOWN_START_TS))
    fi
    
    # Log context when Unknown is detected
    log "${YELLOW}⚠️  Unknown title detected: consecutive=${UNKNOWN_CONSECUTIVE_COUNT} duration=${UNKNOWN_DURATION}s audio_healthy=${AUDIO_HEALTHY}${NC}"
    log "  Context: expected_row_id=${FEED_FIRST_ID} expected_title='${FEED_FIRST_TITLE}'"
    log "  Liquidsoap: row_id=${LIQ_ROW_ID} title='${LIQ_TITLE}' ok=${LIQ_OK}"
    log "  Icecast: listeners=${ICE_LISTENERS} bytes_in=${ICE_BYTES_IN} bytes_out=${ICE_BYTES_OUT} prev_bytes=${PREV_BYTES} curr_bytes=${ICECAST_BYTES}"
    
    # Only treat as CRITICAL if:
    # 1. Unknown persists for >2 minutes (120s) AND
    # 2. Audio is not healthy (bytes not increasing)
    if [ "$UNKNOWN_DURATION" -ge 120 ] && [ "$AUDIO_HEALTHY" = false ]; then
        CRITICAL_TITLE=true
        log "${RED}🚨 CRITICAL: Unknown title + no audio for ${UNKNOWN_DURATION}s (triggering restart)${NC}"
    fi
else
    # Title is normal - reset Unknown tracking
    if [ "$PREV_UNKNOWN_START_TS" != "0" ]; then
        log "${GREEN}✅ Title recovered: was Unknown for ${PREV_UNKNOWN_CONSECUTIVE_COUNT} checks${NC}"
    fi
    UNKNOWN_START_TS="0"
    UNKNOWN_CONSECUTIVE_COUNT=0
fi
PREV_ICECAST_TITLE="$ICECAST_TITLE"

SUPPRESS_RESTART=false
SUPPRESS_REASON=""
# Don't suppress if:
# - Show has exceeded its scheduled end time (even if it's a stable long track)
# - Show boundary crossed (end + 60s) - override all suppressions
# - Schedule change is active (new show should have started)
if [ "$SHOW_BOUNDARY_CROSSED" != true ] && [ "$SCHEDULE_CHANGE_ACTIVE" != true ]; then
    if [ "$MISMATCH" = true ] && [ "$WITHIN_ALLOWED_SKEW" = true ] && [ "$FEED_FRESH" = true ] && [ "$STABLE_LONGTRACK" = true ] && [ "$CRITICAL_TITLE" = false ] && [ "$SHOW_EXCEEDED_END_TIME" = false ]; then
        SUPPRESS_RESTART=true
        SUPPRESS_REASON="stable-longtrack"
    fi
fi
if [ "$COOLDOWN_ACTIVE" = true ] && [ "$SHOW_BOUNDARY_CROSSED" != true ]; then
    SUPPRESS_RESTART=true
    SUPPRESS_REASON=${SUPPRESS_REASON:+$SUPPRESS_REASON,}"cooldown"
fi

MISMATCH_START="null"
if [ "$MISMATCH" = true ] || [ "$FROZEN" = true ]; then
    if [ "$PREV_MISMATCH_START" = "null" ]; then
        log "${YELLOW}⚠️  Desync detected - starting timer${NC}"
        MISMATCH_START=$NOW_TS
    else
        MISMATCH_START=$PREV_MISMATCH_START
        MISMATCH_DURATION=$((NOW_TS - MISMATCH_START))
        log "${YELLOW}⚠️  Desync ongoing: ${MISMATCH_DURATION}s (allowed: ${ALLOWED_SKEW}s)${NC}"

        FEED_IS_PARTIAL=false
        FEED_IS_ERROR=false
        case "$FEED_STATUS_EFFECTIVE" in
            partial) FEED_IS_PARTIAL=true ;;
            error|error+fallback|degraded-cb) FEED_IS_ERROR=true ;;
        esac

        FEED_ERROR_ESCALATE=false
        if [ "$FEED_IS_ERROR" = true ] && [ -n "$VERSION_AGE" ] && [ "$VERSION_AGE" -ge "$FEED_ERROR_ESCALATE_THRESHOLD" ]; then
            FEED_ERROR_ESCALATE=true
        fi

        # Hard-skew: EXTREMELY constrained - only trigger if ALL conditions are met:
        # - PLAYER_SKEW_ABS > 900 (15 minutes)
        # - STABLE_LONGTRACK == false (not a long-track case)
        # - now_utc > first_end_utc + 300 (5 minutes after show end)
        HARD_SKEW=false
        if [ -n "$PLAYER_SKEW_ABS" ] && [ "$PLAYER_SKEW_ABS" -gt 900 ] && [ "$STABLE_LONGTRACK" = false ]; then
            if [ -n "$FEED_FIRST_END_TS" ] && [[ "$FEED_FIRST_END_TS" =~ ^[0-9]+$ ]] && [ "$NOW_TS" -gt $((FEED_FIRST_END_TS + 300)) ]; then
                HARD_SKEW=true
            fi
        fi

        SHOULD_RESTART=false
        RESTART_REASON_LIST=()
        if [ "$FROZEN" = true ]; then
            SHOULD_RESTART=true
            RESTART_REASON_LIST+=("bytes-stalled")
        fi
        # feed-error removed as restart reason (kept as monitoring-only)
        # Feed errors are logged but don't trigger restarts to simplify watchdog logic
        # Critical titles (Unknown/Offline) require immediate action after cooldown
        if [ "$CRITICAL_TITLE" = true ] && [ "$MISMATCH_DURATION" -ge "$ALLOWED_SKEW" ]; then
            SHOULD_RESTART=true
            RESTART_REASON_LIST+=("critical-title")
        fi
        # Show exceeded scheduled end time - force restart to switch to next show
        # Use a much shorter threshold (END_TIME_VIOLATION_THRESHOLD) since deterministic feed must keep schedule on time
        if [ "$SHOW_EXCEEDED_END_TIME" = true ] && [ "$MISMATCH" = true ] && [ "$SHOW_EXCEEDED_SEC" -ge "$END_TIME_VIOLATION_THRESHOLD" ]; then
            SHOULD_RESTART=true
            RESTART_REASON_LIST+=("show-exceeded-end-time")
        fi
        # Schedule changed - new show should have started
        if [ "$FEED_SCHEDULE_CHANGED" = true ] && [ "$SCHEDULE_CHANGE_ACTIVE" = true ] && [ "$MISMATCH" = true ]; then
            SHOULD_RESTART=true
            RESTART_REASON_LIST+=("schedule-changed")
        fi
        if [ "$HARD_SKEW" = true ] && [ "$SUPPRESS_RESTART" = false ]; then
            SHOULD_RESTART=true
            RESTART_REASON_LIST+=("hard-skew")
        fi

        if [ "$FEED_IS_PARTIAL" = true ] && [ "$FEED_ERROR_ESCALATE" = false ] && [ "$FEED_STATUS_EFFECTIVE" != "$PREV_FEED_STATUS_BODY" ]; then
            log "${YELLOW}⚠️  feed_status=partial missing=${FEED_MISSING_COUNT}/${FEED_TOTAL_COUNT} (monitor only)${NC}"
        fi
        if [ "$FEED_IS_ERROR" = true ] && [ "$FEED_ERROR_ESCALATE" = false ] && [ "$FEED_STATUS_EFFECTIVE" != "$PREV_FEED_STATUS_BODY" ]; then
            log "${YELLOW}⚠️  feed_status=${FEED_STATUS_EFFECTIVE} version_delta=${VERSION_AGE:-n/a}s (below threshold)${NC}"
        fi

        if [ "$SHOULD_RESTART" = true ] && [ "$RESTARTS_ENABLED" = "true" ]; then
            if [ "$SUPPRESS_RESTART" = true ]; then
                log "${YELLOW}⚠️  Restart suppressed (${SUPPRESS_REASON}); reasons=${RESTART_REASON_LIST[*]}${NC}"
            elif [ "$COOLDOWN_ACTIVE" = true ]; then
                log "${YELLOW}⚠️  Restart skipped (cooldown ${RESTART_COOLDOWN_MIN}m active) reasons=${RESTART_REASON_LIST[*]}${NC}"
            else
                RESTART_REASON=$(IFS=','; echo "${RESTART_REASON_LIST[*]}")
                log "${RED}🚨 CRITICAL: Triggering restart (reason=${RESTART_REASON})${NC}"
                
                # Graceful shutdown: stop playback before restart to avoid screeching
                log "Stopping Liquidsoap playback gracefully..."
                docker exec libretime-playout-1 python3 << 'PYEOF' 2>/dev/null || true
import sys
sys.path.insert(0, '/src')
from libretime_playout.liquidsoap.client._connection import LiquidsoapConnection
import os

host = os.getenv("LIQUIDSOAP_HOST", "liquidsoap")
port = int(os.getenv("LIQUIDSOAP_PORT", "1234"))

try:
    conn = LiquidsoapConnection(host=host, port=port, path=None, timeout=2)
    conn.connect()
    
    # Clear all queues gracefully
    for queue_id in range(5):
        conn.write(f"dummy.{queue_id}.stop")
        conn.read()
    
    # Stop main output
    conn.write("dummy.stop")
    conn.read()
    
    conn.close()
except Exception:
    pass  # Ignore errors during shutdown
PYEOF
                
                # Wait for fade-out (2 seconds should be enough for fade)
                sleep 2
                
                # Now restart containers
                cd /srv/libretime && docker compose restart playout liquidsoap >> "$LOG_FILE" 2>&1
                log "${GREEN}✅ Restart completed (reason=${RESTART_REASON})${NC}"
                MISMATCH_START="null"
                PREV_LAST_RESTART_TS=$NOW_TS
                # Reset Unknown tracking after restart
                UNKNOWN_START_TS="0"
                UNKNOWN_CONSECUTIVE_COUNT=0
            fi
        elif [ "$SHOULD_RESTART" = true ] && [ "$RESTARTS_ENABLED" != "true" ]; then
            log "${YELLOW}⚠️  Restart conditions met (restarts disabled) reasons=${RESTART_REASON_LIST[*]}${NC}"
        elif [ "$SUPPRESS_RESTART" = true ]; then
            log "${YELLOW}⚠️  SUPPRESS (${SUPPRESS_REASON}) skew=${PLAYER_SKEW_ABS:-n/a}s allowed=${ALLOWED_SKEW}s${NC}"
        fi
    fi
else
    if [ "$PREV_MISMATCH_START" != "null" ]; then
        log "${GREEN}✅ Desync resolved${NC}"
    fi
    MISMATCH_START="null"
fi

SUMMARY_STATE="OK"
SUMMARY_REASON="none"
if [ "$MISMATCH" = true ] || [ "$FROZEN" = true ]; then
    SUMMARY_STATE="WARN"
    SUMMARY_REASON="mismatch=$MISMATCH frozen=$FROZEN"
fi
if [ "$SUPPRESS_RESTART" = true ]; then
    SUMMARY_STATE="SUPPRESS"
    SUMMARY_REASON=$SUPPRESS_REASON
fi
if [ "$COOLDOWN_ACTIVE" = true ]; then
    SUMMARY_REASON="${SUMMARY_REASON},cooldown"
fi
if [ "$FEED_STATUS_EFFECTIVE" = "partial" ]; then
    SUMMARY_STATE="WARN"
    SUMMARY_REASON=${SUMMARY_REASON:+$SUMMARY_REASON,}"feed-partial"
fi
if [ "$FEED_STATUS_EFFECTIVE" = "error" ] || [ "$FEED_STATUS_EFFECTIVE" = "error+fallback" ]; then
    SUMMARY_STATE="WARN"
    SUMMARY_REASON=${SUMMARY_REASON:+$SUMMARY_REASON,}"feed-${FEED_STATUS_EFFECTIVE}"
fi

PLAYER_SKEW_LOG=${PLAYER_SKEW_ABS:-n/a}
FEED_AGE_LOG=${FEED_AGE_SEC:-n/a}
VERSION_DELTA_LOG=${FEED_VERSION_DELTA:-${VERSION_AGE:-n/a}}

log "State: state=${SUMMARY_STATE} reason=${SUMMARY_REASON} feed_status=${FEED_STATUS_EFFECTIVE} allowed_skew=${ALLOWED_SKEW}s player_skew=${PLAYER_SKEW_LOG}s feed_age_sec=${FEED_AGE_LOG} version_delta=${VERSION_DELTA_LOG} feed_version=${FEED_VERSION:-n/a}"

NOW_ISO=$(date -Iseconds)
if [[ "$FEED_VERSION" =~ ^[0-9]+$ ]]; then
    FEED_VERSION_JSON=$FEED_VERSION
else
    FEED_VERSION_JSON=null
fi

if [[ "$FEED_VERSION_TS" =~ ^[0-9]+$ ]]; then
    FEED_VERSION_TS_JSON=$FEED_VERSION_TS
else
    FEED_VERSION_TS_JSON=null
fi

if [ "$FEED_STALE_LOGGED" = "true" ]; then
    FEED_STALE_LOGGED_JSON=true
else
    FEED_STALE_LOGGED_JSON=false
fi

if [ -n "$FEED_FIRST_START" ]; then
    FEED_FIRST_START_JSON="\"$FEED_FIRST_START\""
else
    FEED_FIRST_START_JSON=null
fi

if [ -n "$FEED_FIRST_END" ]; then
    FEED_FIRST_END_JSON="\"$FEED_FIRST_END\""
else
    FEED_FIRST_END_JSON=null
fi

if [ -n "$FEED_FIRST_END_TS" ] && [[ "$FEED_FIRST_END_TS" =~ ^[0-9]+$ ]]; then
    FEED_FIRST_END_TS_JSON=$FEED_FIRST_END_TS
else
    FEED_FIRST_END_TS_JSON=null
fi

if [ -n "$FEED_DELTA_SEC" ]; then
    FEED_DELTA_JSON=$FEED_DELTA_SEC
else
    FEED_DELTA_JSON=null
fi

if [ -n "$FEED_FIRST_ID" ]; then
    FEED_FIRST_ID_JSON="\"$FEED_FIRST_ID\""
else
    FEED_FIRST_ID_JSON="\"\""
fi

if [ -n "$SCHEDULE_KEY" ]; then
    SCHEDULE_KEY_JSON="\"$SCHEDULE_KEY\""
else
    SCHEDULE_KEY_JSON="\"\""
fi

if [ -n "$FEED_STATUS_HEADER" ]; then
    FEED_STATUS_HEADER_JSON="\"$FEED_STATUS_HEADER\""
else
    FEED_STATUS_HEADER_JSON="\"unknown\""
fi

if [ -n "$FEED_STATUS_BODY" ]; then
    FEED_STATUS_BODY_JSON="\"$FEED_STATUS_BODY\""
else
    FEED_STATUS_BODY_JSON="\"unknown\""
fi

if [ -n "$FEED_AGE_SEC" ]; then
    FEED_AGE_JSON=$FEED_AGE_SEC
else
    FEED_AGE_JSON=null
fi

if [ -n "$FEED_VERSION_DELTA" ]; then
    FEED_VERSION_DELTA_JSON=$FEED_VERSION_DELTA
else
    FEED_VERSION_DELTA_JSON=null
fi

FEED_MISSING_COUNT_JSON=${FEED_MISSING_COUNT:-0}
FEED_TOTAL_COUNT_JSON=${FEED_TOTAL_COUNT:-0}

if [ -n "$FEED_LAST_OK_VERSION" ]; then
    FEED_LAST_OK_VERSION_JSON=$FEED_LAST_OK_VERSION
else
    FEED_LAST_OK_VERSION_JSON=null
fi

if [[ "$PREV_LAST_RESTART_TS" =~ ^[0-9]+$ ]]; then
    LAST_RESTART_JSON=$PREV_LAST_RESTART_TS
else
    LAST_RESTART_JSON=0
fi

if [ -n "$ICECAST_TITLE" ]; then
    ICECAST_TITLE_JSON="\"$ICECAST_TITLE\""
else
    ICECAST_TITLE_JSON="\"\""
fi

if [ -n "$CURRENTLY_PLAYING_TRACK_ID" ]; then
    CURRENTLY_PLAYING_TRACK_ID_JSON="\"$CURRENTLY_PLAYING_TRACK_ID\""
else
    CURRENTLY_PLAYING_TRACK_ID_JSON="\"\""
fi

TRACK_ID_MISMATCH_JSON=$([ "$TRACK_ID_MISMATCH" = true ] && echo "true" || echo "false")

cat <<EOF > "$STATE_FILE"
{
  "mismatch_start": "$MISMATCH_START",
  "bytes": "$ICECAST_BYTES",
  "last_check": "$NOW_ISO",
  "feed_version": $FEED_VERSION_JSON,
  "feed_version_seen_at": $FEED_VERSION_TS_JSON,
  "feed_stale_logged": $FEED_STALE_LOGGED_JSON,
  "feed_first_start": $FEED_FIRST_START_JSON,
  "feed_first_end": $FEED_FIRST_END_JSON,
  "feed_first_end_ts": $FEED_FIRST_END_TS_JSON,
  "feed_delta_sec": $FEED_DELTA_JSON,
  "feed_first_id": $FEED_FIRST_ID_JSON,
  "schedule_key": $SCHEDULE_KEY_JSON,
  "last_restart_ts": $LAST_RESTART_JSON,
  "icecast_title": $ICECAST_TITLE_JSON,
  "feed_status_header": $FEED_STATUS_HEADER_JSON,
  "feed_status_body": $FEED_STATUS_BODY_JSON,
  "feed_age_sec": $FEED_AGE_JSON,
  "feed_version_delta": $FEED_VERSION_DELTA_JSON,
  "feed_missing_count": $FEED_MISSING_COUNT_JSON,
  "feed_total_count": $FEED_TOTAL_COUNT_JSON,
  "feed_last_ok_version": $FEED_LAST_OK_VERSION_JSON,
  "currently_playing_track_id": $CURRENTLY_PLAYING_TRACK_ID_JSON,
  "track_id_mismatch": $TRACK_ID_MISMATCH_JSON,
  "unknown_start_ts": "$UNKNOWN_START_TS",
  "unknown_consecutive_count": $UNKNOWN_CONSECUTIVE_COUNT
}
EOF
