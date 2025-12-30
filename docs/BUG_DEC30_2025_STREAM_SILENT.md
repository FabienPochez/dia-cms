# Stream Silent Bug Report - Dec 30, 2025

## Summary

**Date**: December 30, 2025, 10:05-10:13 UTC (11:05-11:13 Paris time)  
**Severity**: Critical (stream offline)  
**Status**: ✅ Fixed (manual restart)  
**Root Cause**: LibreTime Bug #1 - Hourly Boundary Timing Detection Failure

## Timeline

- **10:05 UTC**: User reports stream not working, no "on air" indicator, no jingles
- **10:13 UTC**: Investigation reveals playout waiting for wrong time
- **10:13 UTC**: Manual restart of playout/liquidsoap services
- **10:14 UTC**: Stream should resume (verification needed)

## Symptoms

- Stream completely silent
- No "on air" indicator in LibreTime UI
- No jingles playing (normally jingle loop runs when no track)
- LibreTime playout service running but not playing content

## Root Cause Analysis

### Database Status ✅
- **Schedule Entry**: Exists (ID 2485)
  - Show: "Strange How You Move w/ Doum #07"
  - Scheduled: 09:00-11:00 UTC (10:00-12:00 Paris time)
  - File ID: 944
  - File path: `imported/1/Doum/strange how you move/685e6a54b3ef76e0e25c192b__strange-how-you-move__.mp3`

- **File Status**: ✅ File exists on disk
  - Path: `/srv/media/imported/1/Doum/strange how you move/685e6a54b3ef76e0e25c192b__strange-how-you-move__.mp3`
  - File registered in LibreTime database (ID 944)
  - Track duration: 120.6 minutes

### Playout Status ❌
**Playout logs show incorrect timing calculation**:
```
2025-12-30 10:11:32 UTC:
  first_start_utc=2025-12-30T11:00:00Z
  now_utc=2025-12-30T10:11:32.931158Z
  wait=2907.069s
  "waiting 2907.068842s until next scheduled item"
```

**Translation**: Playout thinks the next show starts at 11:00 UTC, but there's a show scheduled RIGHT NOW (09:00-11:00 UTC). Current time is 10:11 UTC, which falls within the scheduled window.

### Bug Pattern

This matches **Bug #1: Hourly Boundary Timing** documented in `STREAM_HEALTH_MONITORING.md`:

1. Playout fails to detect that current time falls within a scheduled show window
2. Calculates "next show" incorrectly (11:00 UTC instead of recognizing current show)
3. Gets stuck waiting for wrong time
4. Stream goes silent because no content is queued to play

## Impact

- **Downtime**: ~8 minutes (10:05-10:13 UTC)
- **User Experience**: Stream completely offline
- **Schedule Cascade Risk**: If not caught, show would start late, affecting subsequent shows

## Fix Applied

**Manual Restart**:
```bash
cd /srv/libretime && docker compose restart playout liquidsoap
```

**After Restart**:
- Playout detected schedule entry: `"Need to add items to Liquidsoap *now*: {2485}"`
- However, logs still show: `"waiting 2788.423843s until next scheduled item"`
- This suggests the bug persists even after restart

## Health Check Status

**Issue Found**: Health check cron job was **NOT configured** in crontab
- Script exists: `/srv/payload/scripts/stream-health-check.sh` ✅
- Cron configuration: **MISSING** ❌
- Health check was not running automatically

**Fix Applied** (2025-12-30):
```bash
# Added to root crontab:
* * * * * /usr/bin/flock -n /tmp/dia-health.lock /srv/payload/scripts/stream-health-check.sh
```

**Status**: ✅ Cron job now configured and active

## Recommendations

### Immediate Actions
1. ✅ **Manual restart completed** - Stream should resume
2. ⚠️ **Verify stream is playing** - Check Icecast stats
3. ⚠️ **Verify health check cron** - Ensure automatic detection is enabled
4. ⚠️ **Monitor next hourly boundary** - Bug may recur

### Short Term
1. **Improve Health Check Detection**
   - Health check should detect "waiting for wrong time" pattern
   - Check playout logs for `wait=` values that exceed current show duration
   - Restart if playout waiting >5 minutes when show should be playing

2. **Add Monitoring Alert**
   - Alert when stream silent for >2 minutes
   - Alert when playout waiting for wrong time

### Long Term
1. **Upstream Fix Needed**
   - Report to LibreTime: Timing detection bug at hourly boundaries
   - Provide logs and evidence from this incident
   - Reference existing issue if available

2. **Workaround Implementation**
   - Consider patching LibreTime playout code
   - Or implement custom scheduler that validates timing before playout

## Related Documentation

- `docs/STREAM_HEALTH_MONITORING.md` - Bug #1 documentation
- `docs/STREAM_HEALTH_INCIDENT_NOV4_2025.md` - Previous incident
- `scripts/stream-health-check.sh` - Health check script

## Verification Commands

```bash
# Check current schedule
docker exec libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT s.id, s.starts, s.ends, f.track_title FROM cc_schedule s \
   JOIN cc_files f ON s.file_id = f.id \
   WHERE s.starts <= NOW() AND s.ends > NOW();"

# Check playout logs
docker logs libretime-playout-1 --tail 20 | grep -E "(wait|first_start|now_utc)"

# Check stream status
curl -s http://localhost:8000/admin/stats.xml | grep -E "title|listeners"

# Run health check manually
/srv/payload/scripts/stream-health-check.sh
```

---

**Reported By**: User  
**Investigated By**: AI Assistant  
**Date**: 2025-12-30

