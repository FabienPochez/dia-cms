#!/bin/bash
# Quick status check for active threat monitoring

echo "=== Active Threat Monitoring Status ==="
echo ""

# Check if monitoring process is running
MONITOR_PID=$(pgrep -f "monitor-active-threats.sh" | head -1)

if [ -n "$MONITOR_PID" ]; then
    echo "✅ Monitoring is RUNNING (PID: $MONITOR_PID)"
    ps -p "$MONITOR_PID" -o pid,etime,pcpu,pmem,cmd --no-headers | awk '{print "   Started: "$2", CPU: "$3"%, MEM: "$4"%"}'
else
    echo "❌ Monitoring is NOT running"
fi

echo ""

# Show recent log entries
if [ -f "/var/log/active-threat-monitor.log" ]; then
    echo "📋 Recent log entries (last 10):"
    tail -10 /var/log/active-threat-monitor.log | sed 's/^/   /'
else
    echo "⚠️  Log file not found yet"
fi

echo ""

# Show alerts if any
if [ -f "/var/log/active-threat-alerts.log" ]; then
    ALERT_COUNT=$(wc -l < /var/log/active-threat-alerts.log)
    if [ "$ALERT_COUNT" -gt 0 ]; then
        echo "🚨 ALERTS FOUND: $ALERT_COUNT alert(s)"
        echo "   Recent alerts:"
        tail -5 /var/log/active-threat-alerts.log | sed 's/^/   /'
    else
        echo "✅ No alerts detected"
    fi
else
    echo "ℹ️  No alerts file yet (no threats detected)"
fi

echo ""
echo "To view live monitoring:"
echo "  tail -f /var/log/active-threat-monitor.log"
echo ""
echo "To view only alerts:"
echo "  tail -f /var/log/active-threat-alerts.log"

