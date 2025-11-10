# Stream Health Incident Report - Nov 4, 2025

## Executive Summary

**Date**: November 4, 2025, 16:00-17:00 CET  
**Severity**: Critical (26 restarts in one hour)  
**Status**: ✅ Resolved with mitigation implemented  
**Root Cause**: LibreTime Bug [#1275](https://github.com/libretime/libretime/issues/1275) + Health monitoring interaction

## Timeline

- **Nov 4, 16:00:00** - Long track scheduled (61.3 minutes)
- **Nov 4, 16:00:11** - LibreTime enters "offline" state (bug triggered)
- **Nov 4, 16:02-17:00** - 26 automatic restarts (restart loop)
- **Nov 5** - Reduced activity (7 restarts at hourly boundaries)
- **Nov 6, 10:54 UTC** - Fix implemented and tested
- **Nov 6, ongoing** - Zero restarts, system stable

## Root Cause Analysis

### LibreTime Bug #1275

**Issue**: Tracks longer than 55 minutes cause LibreTime to display "offline" status for 3-4 minutes before starting playback.

**GitHub**: https://github.com/libretime/libretime/issues/1275  
**Reported**: July 2021  
**Status**: Still open in LibreTime 3.x

### Cascade Failure Mechanism

```
1. Long track (>55 min) scheduled
2. LibreTime bug triggers → "offline" state
3. Health check detects desync after 60s
4. Health check restarts playout
5. Playout restarts but track is still >55 min
6. Bug triggers again → "offline" 
7. Loop continues until track ends
```

### Specific Trigger

**Nov 4, 16:00** - "Les Fonds d'Tiroirs #03" (61.3 minutes)

Also affected:
- **15:00** - "Gros Volume Sur La Molle #25" (59.8 min)
- **17:00** - "Cosmo Polite - Demlar" (60.0 min)

## Impact Assessment

### Immediate Impact
- **Downtime**: ~52 minutes of degraded service
- **Restarts**: 26 in one hour
- **User Experience**: Severe (repeated interruptions)

### Library-Wide Impact
- **Total affected tracks**: 1,617 files (>55 minutes)
- **Duration range**: 55 to 1,427 minutes (~24 hours)
- **Frequency risk**: Medium (long tracks scheduled regularly)

## Solution Implemented

### Code Changes

**File**: `/srv/payload/scripts/stream-health-check.sh`

**Changes**:
1. Added track duration detection from LibreTime database
2. Dynamic restart threshold based on track length:
   - Normal tracks: 60 seconds (existing behavior)
   - Long tracks (>55 min): 360 seconds (6 minutes)
3. Logging of long track detection events

**Testing**: ✅ Confirmed working with 120-minute track

### Documentation Updates

- `/srv/payload/docs/STREAM_HEALTH_MONITORING.md` - Added Bug #2 section
- `/srv/payload/docs/STREAM_HEALTH_INCIDENT_NOV4_2025.md` - This incident report

## Verification

```bash
# Test the health check
/srv/payload/scripts/stream-health-check.sh

# Expected output for long tracks:
# ⏱️  Long track detected (XXX min) - using extended timeout (360s)

# Monitor for long track events
grep "Long track detected" /var/log/dia-cron/stream-health.log

# Check upcoming long tracks
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT starts, track_title, EXTRACT(EPOCH FROM length)/60 as minutes 
   FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id 
   WHERE starts > NOW() AND EXTRACT(EPOCH FROM length) > 3300 
   ORDER BY starts LIMIT 10;"
```

## Recommendations

### Short Term (This Week)

1. **Content Policy** - Implement 55-minute maximum guideline
   - Document in creator guidelines
   - Recommend splitting longer content into parts
   - Add to onboarding materials

2. **UI Validation** - Add warning in planner
   - Alert when scheduling tracks >55 minutes
   - Display expected 3-4 minute delay warning
   - Suggest alternatives (split episodes)

3. **Communication** - Notify content creators
   - Explain the 55-minute limitation
   - Provide guidance on splitting content
   - Share best practices

### Medium Term (This Month)

1. **Library Audit** - Review 1,617 affected files
   - Identify most frequently scheduled long tracks
   - Prioritize for splitting/re-encoding
   - Track conversion progress

2. **Monitoring Enhancement** - Add alerting
   - Webhook/email on restart events
   - Dashboard for long track schedule
   - Trend analysis

3. **User Communication** - Transparency
   - Status page showing known issues
   - Explanation of brief delays for long tracks
   - Expected behavior documentation

### Long Term

1. **Upstream Contribution** - LibreTime fix
   - Investigate playout timeout logic
   - Develop and test patch
   - Submit PR to LibreTime project

2. **Alternative Evaluation** - If bug persists
   - Azuracast
   - Custom liquidsoap + scheduler
   - Other open-source radio automation
   - Migration cost/benefit analysis

## Monitoring & Alerting

### Key Metrics

- Restart frequency per day (target: <2)
- Long track delay events (expect 3-4 min each)
- Stream uptime percentage (target: >99%)
- User-reported incidents

### Log Analysis

```bash
# Daily restart summary
grep "RESTARTING PLAYOUT" /var/log/dia-cron/stream-health.log | \
  grep "$(date '+%Y-%m-%d')" | wc -l

# Long track events today
grep "Long track detected" /var/log/dia-cron/stream-health.log | \
  grep "$(date '+%Y-%m-%d')" | wc -l

# Weekly trend
for day in {0..6}; do
  date=$(date -d "$day days ago" '+%Y-%m-%d')
  count=$(grep "RESTARTING PLAYOUT" /var/log/dia-cron/stream-health.log | grep "$date" | wc -l)
  echo "$date: $count restarts"
done
```

## Lessons Learned

### What Went Well
- ✅ Automated health monitoring detected issues
- ✅ Auto-recovery prevented extended outages
- ✅ Comprehensive logging enabled root cause analysis
- ✅ Quick identification and fix implementation

### What Went Wrong
- ❌ Restart loop amplified the issue
- ❌ Long track bug not previously documented
- ❌ No pre-scheduling validation for long tracks
- ❌ 1,617 affected files in library

### Improvements Made
- ✅ Smart timeout based on track duration
- ✅ Documentation of known LibreTime limitations
- ✅ Monitoring commands for long track detection
- ✅ Incident response playbook updated

## Appendix A: Data

### Nov 4-6 Restart Summary

| Date | Restarts | Status | Notes |
|------|----------|--------|-------|
| Nov 4 | 27 | 🔴 Critical | 26 in hour 16:00-17:00 |
| Nov 5 | 7 | 🟡 Elevated | Hourly boundaries |
| Nov 6 | 0 | 🟢 Healthy | Fix implemented |

### Upcoming Long Tracks (Nov 6-8)

| Date/Time | Track | Duration |
|-----------|-------|----------|
| Nov 06 14:00 | Too Much of Nothing w/ Mikel Toyos #05 | 61.6 min |
| Nov 06 15:00 | Ghetto Disco #01 - Zabriskie | 123.0 min |
| Nov 06 17:00 | Nuage Blanc #08 - Citron Bleu | 59.6 min |
| Nov 06 18:00 | Gros Volume sur La Molle - Lucien James | 120.1 min |
| Nov 06 20:00 | Ceyda Yagiz #19 | 121.6 min |
| Nov 07 06:00 | Mut'ammar #20 - Kalmos | 62.7 min |
| Nov 07 13:00 | Gros Volume sur la Molle #23 | 59.5 min |
| Nov 08 15:00 | Gros Volume Sur La Molle #12 | 118.7 min |

## Appendix B: References

- [LibreTime Issue #1275](https://github.com/libretime/libretime/issues/1275) - Long track bug report
- [Health Check Script](/srv/payload/scripts/stream-health-check.sh) - Monitoring implementation
- [Stream Health Monitoring Docs](/srv/payload/docs/STREAM_HEALTH_MONITORING.md) - Complete documentation
- [Health Check Logs](/var/log/dia-cron/stream-health.log) - Operational logs

---

**Report Author**: AI Assistant  
**Report Date**: November 6, 2025  
**Last Updated**: November 6, 2025  
**Status**: Incident Resolved ✅

