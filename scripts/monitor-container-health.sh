#!/bin/bash
# Monitor Payload container health and API availability
# Run this script to monitor for 1 hour

LOG_FILE="/var/log/payload-health-monitor.log"
ALERT_FILE="/var/log/payload-health-alerts.log"
DURATION=3600  # 1 hour in seconds
INTERVAL=30    # Check every 30 seconds

echo "[$(date -u +"%Y-%m-%d %H:%M:%S")] Starting Payload container health monitor for ${DURATION}s" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
    TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S")
    
    # Check container status
    CONTAINER_STATUS=$(docker inspect payload-payload-1 --format='{{.State.Status}}' 2>&1)
    CONTAINER_RUNNING=$(docker ps --filter "name=payload-payload-1" --format "{{.Names}}" 2>&1)
    
    # Check API availability
    API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/episodes?limit=1 2>&1)
    
    # Check admin panel
    ADMIN_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/admin 2>&1)
    
    # Check container memory
    MEM_USAGE=$(docker stats --no-stream --format "{{.MemUsage}}" payload-payload-1 2>&1 | head -1)
    
    # Log status
    echo "[$TIMESTAMP] Container: $CONTAINER_STATUS | API: $API_RESPONSE | Admin: $ADMIN_RESPONSE | Memory: $MEM_USAGE" >> "$LOG_FILE"
    
    # Alert on issues
    if [ "$CONTAINER_STATUS" != "running" ] || [ -z "$CONTAINER_RUNNING" ]; then
        echo "[$TIMESTAMP] 🚨 ALERT: Container not running! Status: $CONTAINER_STATUS" | tee -a "$ALERT_FILE"
    fi
    
    if [ "$API_RESPONSE" != "200" ] && [ "$API_RESPONSE" != "401" ] && [ "$API_RESPONSE" != "403" ]; then
        echo "[$TIMESTAMP] 🚨 ALERT: API returned $API_RESPONSE (expected 200/401/403)" | tee -a "$ALERT_FILE"
    fi
    
    if [ "$ADMIN_RESPONSE" == "502" ] || [ "$ADMIN_RESPONSE" == "000" ]; then
        echo "[$TIMESTAMP] 🚨 ALERT: Admin panel returned $ADMIN_RESPONSE" | tee -a "$ALERT_FILE"
    fi
    
    # Show current status every 5 minutes
    if [ $(($(date +%s) % 300)) -lt $INTERVAL ]; then
        echo "[$TIMESTAMP] Status check: Container=$CONTAINER_STATUS, API=$API_RESPONSE, Admin=$ADMIN_RESPONSE"
    fi
    
    sleep $INTERVAL
done

echo "[$(date -u +"%Y-%m-%d %H:%M:%S")] Monitoring complete" | tee -a "$LOG_FILE"
echo "Logs: $LOG_FILE"
echo "Alerts: $ALERT_FILE"



