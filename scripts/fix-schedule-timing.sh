#!/bin/bash
# Force current show to end at scheduled time to get back on schedule
# This fixes cases where shows start late due to playout bugs

set -euo pipefail

TARGET_END_TIME="${1:-}"
if [ -z "$TARGET_END_TIME" ]; then
    echo "Usage: $0 <target_end_time_utc>"
    echo "Example: $0 '2025-12-22T11:00:00Z'"
    exit 1
fi

# Convert target time to seconds since epoch
TARGET_TS=$(date -u -d "$TARGET_END_TIME" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$TARGET_END_TIME" +%s 2>/dev/null || echo "")
if [ -z "$TARGET_TS" ]; then
    echo "Error: Could not parse target time: $TARGET_END_TIME"
    exit 1
fi

NOW_TS=$(date -u +%s)
WAIT_SEC=$((TARGET_TS - NOW_TS))

if [ $WAIT_SEC -le 0 ]; then
    echo "Target time has already passed. Forcing skip now..."
    WAIT_SEC=0
else
    echo "Waiting ${WAIT_SEC} seconds until $TARGET_END_TIME UTC..."
    sleep $WAIT_SEC
fi

echo "Forcing transition at $(date -u -Iseconds)..."
echo "Skipping current track in liquidsoap..."

# Skip current track in liquidsoap to force transition
docker exec libretime-playout-1 python3 << 'PYEOF'
import socket
import sys
import time

def send_command(cmd):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect(('liquidsoap', 1234))
        s.send((cmd + '\n').encode())
        time.sleep(0.5)
        response = b''
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            response += chunk
            if b'\n' in response:
                break
        s.close()
        return response.decode().strip()
    except Exception as e:
        return f'Error: {e}'

import time

# Skip all queues to force transition
for queue in ['s0', 's1', 's2', 's3']:
    result = send_command(f'queues.{queue}_skip')
    print(f'Queue {queue}: {result}')

PYEOF

echo "Done. Playout should detect the transition and start the next show."

