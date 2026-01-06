#!/bin/bash
# Monitor Payload logs for episode validation
echo "🔍 Monitoring Payload logs for episode validation..."
echo "Press Ctrl+C to stop"
echo ""
docker compose logs -f payload 2>&1 | grep --line-buffered -E "\[EPISODE_VALIDATION\]|\[MediaTracks\].*episode|PATCH.*episodes|POST.*episodes"







