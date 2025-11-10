# Stream Health Monitoring & Playout Desync Analysis

## Problem Summary

LibreTime playout service has a timing detection bug where it fails to recognize that "now" falls within a scheduled show window, particularly at hourly boundaries. This causes the stream to go silent even though LibreTime UI shows "ON AIR".

## Root Cause Analysis

### Bug #1: Hourly Boundary Timing (Original Discovery)

**Symptom**: At 10:00 show transition, playout got stuck:
```
10:00:00 | Playout: "waiting 3599.995474s until next scheduled item"
         | Translation: Waiting for 11:00 instead of playing 10:00-11:00 show!
10:01:08 | Fetches schedule, receives it, but STILL thinks next item is at 11:00
10:02:02 | After restart: "Need to add items to Liquidsoap *now*: {208}"
         | Immediately starts playing correctly
```

**Root Cause**: LibreTime playout's schedule window detection logic has a bug where it:
1. Fails to detect that current time falls within a scheduled show window
2. Calculates "next show" incorrectly at hourly boundaries
3. Gets stuck waiting for the wrong time
4. Requires restart to re-evaluate the schedule correctly

### Bug #2: Long Track Cascade (Nov 4, 2025 Discovery) 🆕

**Symptom**: 26 restarts in one hour (Nov 4, 16:00-17:00)

**Root Cause**: Known LibreTime bug + Health check interaction
- **LibreTime Bug**: [Issue #1275](https://github.com/libretime/libretime/issues/1275) - Tracks >55 minutes cause 3-4 minute "offline" delay at start
- **Cascade**: Health check detects offline → restarts playout → track still >55 min → offline again → restart loop
- **Trigger**: Nov 4 at 16:00, a 61-minute track was scheduled

**Evidence**:
```sql
-- Tracks scheduled Nov 4, 15:00-18:00
15:00 | Gros Volume Sur La Molle #25   | 59.8 min  ⚠️
16:00 | Les Fonds d'Tiroirs #03        | 61.3 min  🚨 TRIGGER
17:00 | Cosmo Polite - Demlar          | 60.0 min  ⚠️

-- Library analysis
Total tracks >55 min: 1,617 files
Longest: 1,427 minutes (~24 hours)
```

**Impact**: With 1,617 long tracks in library, this bug could trigger frequently

**Mitigation** (Implemented 2025-11-06):
- Health check now detects long tracks (>55 min)
- Increases restart threshold from 60s to 360s (6 minutes)
- Allows LibreTime's delayed start to complete without triggering restart loop
- Still provides recovery if genuine failure occurs

### Configuration Audit Results

✅ **Cue Policy** - GOOD
- No auto-cue enabled in config
- All files have `silan_check=false` (no auto silence detection)
- Database has `cue_in='00:00:00'` for all files
- **Note**: The 122-second cue_in was calculated at runtime by liquidsoap (not stored)

✅ **Transition Timing** - GOOD
- All fade_in/fade_out set to `00:00:00` (hard cuts)
- Correct for back-to-back show format

✅ **Cron Timing** - ACCEPTABLE
- Pre-air: Every 15 minutes (xx:00, xx:15, xx:30, xx:45)
- Post-air: Every 10 minutes (xx:00, xx:10, xx:20, xx:30, xx:40, xx:50)
- Both hit hourly boundaries but don't directly affect LibreTime playout
- No evidence of reload interference

⚠️ **Liquidsoap Blank Handling** - UNKNOWN
- LibreTime generates liquidsoap config at runtime
- Cannot easily inspect or modify without patching LibreTime
- Default behavior appears to be: hard cut with no blank detection

## Solution: Automated Health Check

### Implementation

Created `/srv/payload/scripts/stream-health-check.sh` which runs every 60 seconds via cron.

**Logic**:
1. Query Icecast: Get current stream title
2. Query LibreTime DB: Get expected show title (what should be playing now)
3. Compare titles (fuzzy match, first 20 chars)
4. Check if stream bytes are increasing
5. If mismatch OR frozen for ≥120 seconds → Auto-restart playout

**Restart Action**:
```bash
cd /srv/libretime && docker compose restart playout liquidsoap
```

**State Tracking**:
- Maintains state in `/tmp/stream-health-state.json`
- Tracks when mismatch started
- Only restarts after sustained desync (avoids false positives)

**Logging**:
- All actions logged to `/var/log/dia-cron/stream-health.log`
- Includes timestamps, titles compared, bytes transferred
- Critical events marked with 🚨

### Cron Configuration

```bash
# Stream health check (every minute)
* * * * * /usr/bin/flock -n /tmp/dia-health.lock /srv/payload/scripts/stream-health-check.sh
```

Uses `flock` to prevent overlapping runs.

## Testing & Verification

### Manual Test
```bash
# Run health check manually
/srv/payload/scripts/stream-health-check.sh

# Expected output (healthy):
[2025-10-22T10:17:03+00:00] Icecast: 'Vibrespace #05' | Scheduled: 'Vibrespace #05' | Bytes: 23172800
```

### Simulate Desync
```bash
# Stop playout (simulates stuck state)
docker compose -f /srv/libretime/docker-compose.yml stop playout

# Wait 2+ minutes, health check should detect and restart
tail -f /var/log/dia-cron/stream-health.log
```

## Additional Issues Found & Fixed

### 1. Drag-and-Drop Bug
**Issue**: Episode cards in planner stopped being draggable after a few drags  
**Cause**: React cleanup function destroying Draggable on every re-render  
**Fix**: Separated cleanup into mount-only effect  
**File**: `src/admin/components/EventPalette.tsx`

### 2. Shows Cutting Off at 15 Minutes
**Issue**: All shows stopped playing after 15 minutes regardless of length  
**Cause**: `cue_out` hardcoded to `00:15:00` in planner code  
**Fix**: Fetch actual file length from LibreTime API and use as `cue_out`  
**File**: `src/integrations/libretimeClient.ts` - `ensurePlayout()` method

### 3. Double Stream
**Issue**: Audio playing overlapped with itself  
**Cause**: Missing files marked as `file_exists=true` → 404 errors → schedule reload → track restart  
**Fix**: Daily file existence check + mark missing files as `file_exists=false`  
**Script**: `/srv/payload/scripts/fix-libretime-file-exists.sh`

## Recommendations

### Short Term (Implemented ✅)
1. **Health check with auto-restart** - Detects and fixes desync within 2 minutes
2. **Long track detection** - Increases timeout for tracks >55 min to avoid restart loops 🆕
3. **Daily file existence check** - Prevents 404 errors
4. **Fixed cue_out values** - Shows play full length

### Medium Term (Consider)
1. **Content Policy for Long Tracks** 🆕
   - Implement 55-minute maximum episode length guideline
   - Split longer content into Part 1 / Part 2
   - Add validation warning in planner UI when scheduling >55 min tracks
   - Affects 1,617 existing files in library

2. **Fallback/Interlude in Liquidsoap**
   - Add offline.mp3 or tone that plays during handoff failures
   - Easier to detect issues (hear tone instead of silence)
   - Requires LibreTime liquidsoap config modification

3. **Alert on Restart**
   - Send webhook/email when health check triggers restart
   - Track frequency to identify patterns
   - Could use existing logging + external monitor

4. **Metrics Dashboard**
   - Track uptime, restart frequency, desync duration
   - Graph bytes transferred over time
   - Alert on anomalies

### Long Term (Upstream Fix Needed)
1. **Report Bugs to LibreTime** 🆕
   - **Bug #1**: Timing detection issue at hourly boundaries
   - **Bug #2**: Long track delay ([#1275](https://github.com/libretime/libretime/issues/1275) - reported 2021, still open)
   - Provide our logs and restart pattern analysis
   - Link to community discussions of similar issues

2. **Consider LibreTime Alternatives**
   - If bugs persist across versions
   - Azuracast, Icecast + custom scheduler, etc.
   - Significant migration effort

3. **Contribute Upstream Fix**
   - Deep dive into LibreTime playout/liquidsoap code
   - Fix long track timeout handling
   - Timeline: Months (PR review + release cycle)

## Monitoring Commands

```bash
# View health check log
tail -f /var/log/dia-cron/stream-health.log

# Check health check state
cat /tmp/stream-health-state.json | jq

# Manually trigger health check
/srv/payload/scripts/stream-health-check.sh

# View recent restarts
grep "RESTARTING PLAYOUT" /var/log/dia-cron/stream-health.log

# Check for long track warnings
grep "Long track detected" /var/log/dia-cron/stream-health.log | tail -20

# Current stream status
curl -s -u admin:269e61fe1a5f06f15ccf7b526dacdfdb http://localhost:8000/admin/stats.xml | grep -E "title|listeners"

# Find upcoming long tracks (>55 min)
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT starts, track_title, EXTRACT(EPOCH FROM length)/60 as minutes 
   FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id 
   WHERE starts > NOW() AND EXTRACT(EPOCH FROM length) > 3300 
   ORDER BY starts LIMIT 10;"

# Count long tracks in library
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT COUNT(*) FROM cc_files WHERE EXTRACT(EPOCH FROM length) > 3300;"
```

## References

- LibreTime Docs: https://libretime.org/
- Community: https://discourse.libretime.org/
- Liquidsoap Docs: https://www.liquidsoap.info/
- Long Track Bug: https://github.com/libretime/libretime/issues/1275
- Original issue logs: 2025-10-22 09:58-10:02 transition
- Nov 4 cascade logs: 2025-11-04 16:00-17:00 (26 restarts)

---

**Last Updated**: 2025-11-06  
**Status**: Health check deployed with long track detection

