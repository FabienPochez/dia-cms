# Deterministic Feed Implementation - Reviewer Pack

**Date**: November 21, 2025  
**Purpose**: Comprehensive review of issues encountered since deterministic feed implementation  
**Timeline**: November 7-21, 2025

---

## Executive Summary

The deterministic feed was implemented on **November 7, 2025** to provide LibreTime with a UTC-normalized schedule feed, ensuring hour-boundary transitions occur on time. Since implementation, we've encountered several issues related to timing, transitions, and LibreTime playout behavior that required multiple fixes and mitigations.

**Current Status**: System is stable with workarounds in place, but underlying LibreTime timing bugs remain.

---

## Implementation Timeline

- **Nov 7, 2025**: Deterministic feed implemented (`/api/schedule/deterministic`)
- **Nov 7, 2025**: LibreTime playout patched to consume deterministic feed
- **Nov 7, 2025**: Stream health check updated to monitor feed
- **Nov 8, 2025**: Feed resilience improvements (circuit breaker, rate limiting)
- **Nov 18, 2025**: Cue-in calculation fix for long-running shows
- **Nov 20, 2025**: Early cue-out bug fix
- **Nov 21, 2025**: End time violation detection added
- **Nov 21, 2025**: Large schedule delta interruption identified (needs fix)
- **Nov 23, 2025**: Shows not starting on time due to suppression logic (needs fix)
- **Nov 25, 2025**: Large schedule delta fix implemented (skip schedule application when correct show playing)
- **Nov 25, 2025**: Schedule change detection and suppression logic fix implemented
- **Nov 25, 2025**: Watchdog restart triggers simplified and hard-skew constrained

---

## Issues Encountered

### 1. Early Show Cue-Out (Nov 20, 2025) ✅ FIXED

**Problem**: Shows restarting 3 minutes early, interrupting playback.

**Root Cause**:
- Deterministic feed was recalculating `cue_in_sec` for currently playing shows based on elapsed time
- When feed updated mid-playback, Liquidsoap received a new `scheduleVersion` with changed `cue_in_sec` (e.g., 0 → 180 seconds)
- Liquidsoap interpreted the changed `cue_in_sec` as a new cue-in position and restarted the file
- This triggered an early cue-out before the scheduled end time

**Example**:
- Show scheduled 14:00-15:00 UTC
- At 14:56:45 UTC (56m 45s into show), file restarts
- Show ends 3 minutes early instead of at 15:00 UTC

**Fix Applied**:
- Always set `cue_in_sec` to 0 to prevent Liquidsoap from restarting files when feed updates during playback
- The `start_utc`/`end_utc` timestamps are sufficient for playout to identify which show should be playing
- Location: `src/lib/schedule/deterministicFeed.ts` (lines 419-425)

**Status**: ✅ Fixed - Nov 20, 2025

---

### 2. Shows Exceeding Scheduled End Time (Nov 21, 2025) ✅ FIXED

**Problem**: Shows continuing to play past their scheduled end time, preventing next show from starting.

**Root Cause**:
- Long shows (especially 4-hour shows scheduled at midnight) caused timing confusion in LibreTime
- LibreTime playout failed to recognize that a show's scheduled end time had passed
- Health check was suppressing restarts due to "stable-longtrack" logic, even when shows exceeded their end time
- Shows could continue playing 10+ minutes past their scheduled end

**Example**:
- "Les Argonautes" scheduled 07:00-09:00 Paris time
- Show continued playing until 09:13 (13 minutes past scheduled end)
- "Gros Volume sur la Molle" scheduled 08:00-10:00 should have started at 08:00
- Stream was playing wrong show for 5+ hours

**Fix Applied**:
- Added end time detection: parse `end_utc` from deterministic feed
- Compare current time with scheduled end time
- Use short threshold (`END_TIME_VIOLATION_THRESHOLD`, default 60 seconds) instead of long-track skew period
- Prevent suppression of restarts when show exceeds end time
- Add specific restart reason `show-exceeded-end-time` to logs
- Location: `scripts/stream-health-check.sh`

**Status**: ✅ Fixed - Nov 21, 2025

---

### 3. Hourly Boundary Timing Issues (Ongoing) ⚠️ MITIGATED

**Problem**: Shows not transitioning at scheduled hour boundaries, causing 2-3 minute delays.

**Root Cause**:
- LibreTime playout has a timing detection bug where it fails to recognize that "now" falls within a scheduled show window
- Particularly problematic at hourly boundaries (00:00 of each hour)
- Playout incorrectly calculates "next show" time and gets stuck waiting
- Logs show: `"waiting 3599.995474s until next scheduled item"` (waiting for next hour instead of playing current show)

**Example**:
- 10:00:00 - Show should start
- 10:00:02 - Still playing previous show
- 10:02:01 - Still playing previous show (2 minutes late)
- 10:03:02 - Finally switches to correct show

**Mitigation Applied**:
- LibreTime queue patch (`/srv/libretime/patches/queue.py`) filters stale events before they enter playout deque
- Health check detects desync and triggers restart after 2 minutes
- Self-recovers within 2-3 minutes (no restart needed in most cases)

**Status**: ⚠️ Mitigated - Underlying LibreTime bug remains, but system recovers automatically

---

### 4. Long Track Delay Issues (Nov 4, 2025) ⚠️ MITIGATED

**Problem**: Tracks longer than 55 minutes cause 3-4 minute "offline" delay at start, triggering restart loops.

**Root Cause**:
- Known LibreTime bug ([Issue #1275](https://github.com/libretime/libretime/issues/1275)) - tracks >55 minutes cause offline state
- Health check detects offline → restarts playout → track still >55 min → offline again → restart loop
- 1,617 files in library are >55 minutes (longest: 1,427 minutes / ~24 hours)

**Example**:
- Nov 4, 16:00 - "Les Fonds d'Tiroirs #03" (61.3 minutes) scheduled
- 26 restarts in one hour (16:00-17:00)
- Stream offline for ~52 minutes

**Mitigation Applied**:
- Health check detects long tracks (>55 min) and uses extended timeout (360 seconds / 6 minutes)
- Allows LibreTime's delayed start to complete without triggering restart loop
- Still provides recovery if genuine failure occurs
- Location: `scripts/stream-health-check.sh`

**Status**: ⚠️ Mitigated - Long tracks still cause 3-4 minute delays, but no restart loops

---

### 5. Large Schedule Delta During Long Shows (Nov 21, 2025) ✅ FIXED

**Problem**: LibreTime applies schedule updates during long shows, causing audible interruptions.

**Root Cause**:
- LibreTime calculates delta as `abs((first_start - now_utc).total_seconds())` where `first_start` is the start time of the first show in the feed
- For long shows (2+ hours), when LibreTime fetches the schedule mid-show, the delta naturally becomes large (hours)
- Example: 2-hour show starts at 08:00 UTC, fetched at 09:12 UTC → delta = 72 minutes (4348 seconds)
- LibreTime applies the new schedule anyway, triggering queue rebuild during active playback
- Queue rebuild causes brief audible interruption even though the show is playing correctly

**Example**:
- Nov 21, 09:12:28 UTC: LibreTime fetches schedule
- Feed returns 2-hour show that started at 08:00 UTC (still playing correctly)
- Delta calculated: 4348.775 seconds (72 minutes since show started)
- Warning logged: "Deterministic feed delta exceeds threshold (delta=4348.775s)"
- LibreTime applies schedule anyway: "New schedule received"
- Queue rebuilt mid-playback, causing audible interruption

**Additional Issue - Cue Mismatch After Schedule Update**:
- When schedule is applied mid-show (09:12:28), if Liquidsoap restarts the file, it resets `cue_in` to 0 (beginning of file)
- But `cue_out` remains at 7200 seconds (full 2-hour scheduled duration from file start)
- File is shorter than 2 hours, so it ends at 09:39:55 before reaching the cue-out point
- Error: "End of track before cue-out point" - track ends early, causing interruption
- **Evidence**: 
  - Bootstrap at 08:17:32: `cue_in=1052.0, cue_out=7200.0` (file already 17 minutes in)
  - After restart at 08:19:07: `cue_in=2286.8, cue_out=7200.0` (dynamically calculated)
  - At 09:12:28: Schedule applied with `cue_in_sec=0` (from deterministic feed)
  - At 09:39:55: "End of track before cue-out point" (file ended 27 minutes after restart)

**Analysis**:
- The large delta is **expected behavior** for long shows - it's the time since the show started, not an error
- The warning threshold (2 seconds) is too strict for long shows
- When schedule updates mid-show, restarting the file with `cue_in=0` but keeping `cue_out` at full duration causes cue mismatch
- LibreTime should skip applying schedule updates when:
  - Delta is large (> threshold) AND
  - Current show is still playing (matches first_start from feed) AND
  - No actual schedule change detected
- OR: If schedule must be applied, ensure `cue_in` is calculated based on elapsed time, not reset to 0

**Fix Applied**:
- Modified LibreTime `fetch.py` to skip schedule application when correct show is already playing
- Uses strict `row_id` comparison (not titles/durations) to identify if same show is playing
- Checks time window: `first_start <= now_utc <= first_end`
- If `row_id` matches AND time window is valid → skip schedule application completely
- Added per-show logging cooldown (logs once per show or every 60 seconds) to prevent log spam
- Location: `/srv/libretime/patches/player/fetch.py` (lines 313-360)

**Status**: ✅ Fixed - Nov 25, 2025

---

### 6. Shows Not Starting On Time Due to Suppression Logic (Nov 23, 2025) ✅ FIXED

**Problem**: Shows not starting at their scheduled time because health check suppresses restarts when feed schedule changes.

**Root Cause**:
- When a new show should start, the deterministic feed updates to show the new show as `first_start`
- Previous show may still be playing (wrong show or previous show exceeded its end time)
- Health check detects mismatch but suppresses restart due to "stable-longtrack" logic
- The suppression logic doesn't account for feed schedule changes (when `first_start` changes)
- End-time detection doesn't help because when feed updates, `FEED_FIRST_END_TS` becomes the new show's end time, losing track of when the previous show should have ended

**Example**:
- Nov 23, 10:00 UTC (11:00 Paris): Mut'ammar scheduled to start
- 10:00 UTC: Previous show "Itsasaldi" (scheduled 09:00-10:00 UTC) was still playing
- 10:01-10:08 UTC: Health check detected desync but suppressed restart: `SUPPRESS (stable-longtrack)`
- 10:09 UTC: Feed updated to show Mut'ammar (`first_start` changed from `09:00:00` to `10:00:00`)
- 10:09 UTC: "Itsasaldi" still playing instead of Mut'ammar
- 12:00 UTC: Mut'ammar finally started (1 hour late)

**Analysis**:
- The "stable-longtrack" suppression is too aggressive
- It prevents restarts even when:
  1. Wrong show is playing
  2. Feed schedule has changed (new show should have started)
  3. Previous show exceeded its end time
- End-time detection only works for the current show in the feed
- When feed updates to show new show, we lose track of previous show's end time
- Need to detect when `FEED_FIRST_START` changes and not suppress restarts in that case

**Fix Applied**:
- Added schedule change detection: compares `FEED_FIRST_START` and `FEED_FIRST_ID` with previous values
- Added 45-second grace period: schedule change only triggers restart after grace period passes
- Updated suppression logic: does not suppress restarts when schedule change is active
- Added end-time override: if show exceeded end time by >60s, overrides ALL suppressions
- Added new restart reason: `schedule-changed` triggers when feed schedule changed, grace period passed, and mismatch detected
- Location: `scripts/stream-health-check.sh` (lines 272-281, 436-445, 458-468, 519-523)

**Status**: ✅ Fixed - Nov 25, 2025

---

### 7. Stream Interruptions & Delays (General)

**Problem**: Various interruptions and delays affecting listener experience.

**Causes**:
1. **Hourly boundary delays**: 2-3 minute delays at every :00:00 transition
2. **Long track delays**: 3-4 minute delays when tracks >55 minutes start
3. **Show transitions**: Previous show playing into next show's timeslot
4. **Restart cascades**: Multiple restarts in short periods
5. **Large delta during long shows**: Schedule updates applied mid-show causing interruptions (see issue #5 above)

**Impact**:
- Listener experience: Previous show plays 2-3 minutes into next show's timeslot
- Predictable: Happens at every hourly boundary
- Audible interruptions: Queue rebuilds during active playback cause brief interruptions

**Current State**:
- Health check auto-recovers within 2-3 minutes
- Restarts only when necessary (desync persists beyond threshold)
- Logs provide full audit trail

---

## Fixes & Mitigations Applied

### 1. Deterministic Feed Fixes

| Issue | Fix | Location | Date |
|-------|-----|----------|------|
| Early cue-out | Always set `cue_in_sec` to 0 | `src/lib/schedule/deterministicFeed.ts` | Nov 20 |
| Cue-in calculation | Removed dynamic cue-in for currently playing shows | `src/lib/schedule/deterministicFeed.ts` | Nov 18 |
| Feed resilience | Circuit breaker, rate limiting, partial status | `src/app/api/schedule/deterministic/route.ts` | Nov 8 |

### 2. Health Check Enhancements

| Issue | Fix | Location | Date |
|-------|-----|----------|------|
| End time violations | Detect and restart when shows exceed end time | `scripts/stream-health-check.sh` | Nov 21 |
| Long track loops | Extended timeout for tracks >55 min | `scripts/stream-health-check.sh` | Nov 7 |
| Suppression logic | Prevent suppression when show exceeds end time | `scripts/stream-health-check.sh` | Nov 21 |
| Restart reasons | Specific reason codes for different scenarios | `scripts/stream-health-check.sh` | Nov 21 |
| Schedule change detection | Detect when feed schedule changes (new show should start) | `scripts/stream-health-check.sh` | Nov 25 |

### 3. LibreTime Patches

| Issue | Fix | Location | Date |
|-------|-----|----------|------|
| Hourly boundaries | Queue patch filters stale events | `/srv/libretime/patches/queue.py` | Nov 7 |
| Schedule detection | Patched playout to consume deterministic feed | `/srv/libretime/patches/player/fetch.py` | Nov 7 |

---

## Current System Behavior

### Normal Operation
- Health check runs every 60 seconds
- Compares Icecast stream title with scheduled show
- Monitors deterministic feed status and version
- Detects end time violations with 60-second threshold
- Auto-recovers from desync within 2-3 minutes

### Restart Triggers
1. **Show exceeded end time** (`show-exceeded-end-time`): Show playing past scheduled end + 60 seconds
2. **Hard skew** (`hard-skew`): Mismatch persists beyond allowed skew period
3. **Bytes stalled** (`bytes-stalled`): Stream frozen (bytes not increasing)
4. **Critical title** (`critical-title`): Stream shows "Unknown" or "OFFLINE"
5. **Feed error** (`feed-error`): Deterministic feed in error state for extended period
6. **Schedule changed** (`schedule-changed`): Feed schedule changed (new show should have started) - ✅ Implemented Nov 25, 2025

### Suppression Logic
- Suppresses restarts for "stable-longtrack" scenarios (same show, bytes increasing, within skew)
- **Exception**: Never suppresses when show exceeds scheduled end time
- **Exception**: Should not suppress when feed schedule changes (new show should start) - ✅ Implemented Nov 25, 2025
- Cooldown period: 10 minutes between restarts (configurable)

---

## Known Limitations

### LibreTime Bugs (Upstream)
1. **Hourly boundary timing bug**: LibreTime fails to recognize current show at hourly boundaries
   - Status: Open (not reported upstream yet)
   - Impact: 2-3 minute delays at every hour transition
   - Workaround: Health check auto-recovers

2. **Long track delay bug** ([Issue #1275](https://github.com/libretime/libretime/issues/1275))
   - Status: Open since July 2021
   - Impact: 3-4 minute delays for tracks >55 minutes
   - Workaround: Extended timeout in health check

### System Limitations
1. **Restart-based recovery**: All fixes require restarting playout/liquidsoap services
   - No graceful transition mechanism
   - Causes brief interruption (1-2 seconds)
   - Not ideal for listener experience

2. **Reactive monitoring**: Health check detects issues after they occur
   - Cannot prevent issues proactively
   - Relies on LibreTime to trigger problems first

3. **Threshold-based detection**: Uses time-based thresholds (60s, 120s, 360s)
   - May miss very short issues
   - May trigger false positives in edge cases

---

## Recommendations for Future Improvements

### Short Term (1-2 weeks)
1. **Graceful transition mechanism**: Instead of restarting services, trigger schedule reload via LibreTime API
   - Investigate LibreTime API endpoints for schedule refresh
   - Test if reload is sufficient without full restart
   - Reduce interruption time from 1-2 seconds to <100ms

2. **Proactive end time checking**: Check end time before show starts, not just during playback
   - Validate schedule transitions in advance
   - Alert on potential timing issues before they occur

3. **Enhanced logging**: Add more context to restart reasons
   - Include show titles, scheduled times, actual times
   - Track transition success/failure rates
   - Build metrics dashboard

### Medium Term (1-2 months)
1. **LibreTime bug reporting**: Document and report upstream bugs
   - Hourly boundary timing bug
   - Provide logs, evidence, reproduction steps
   - Engage with LibreTime community

2. **Alternative playout evaluation**: Research alternatives if bugs persist
   - Azuracast
   - Custom liquidsoap + scheduler
   - Other open-source radio automation

3. **Content policy**: Implement 55-minute maximum guideline
   - Document in creator guidelines
   - Add UI validation in planner
   - Recommend splitting longer content

### Long Term (3-6 months)
1. **Upstream contribution**: Contribute fixes to LibreTime
   - Fix hourly boundary timing bug
   - Fix long track delay bug
   - Timeline: Months (PR review + release cycle)

2. **Custom playout solution**: Build custom playout if LibreTime bugs persist
   - Direct liquidsoap control
   - Custom scheduler
   - Full control over timing logic

---

## Key Files & Locations

### Deterministic Feed
- **Implementation**: `src/lib/schedule/deterministicFeed.ts`
- **API Endpoint**: `src/app/api/schedule/deterministic/route.ts`
- **Specification**: `docs/DETERMINISTIC_SCHEDULE_FEED.md`

### Health Check
- **Script**: `scripts/stream-health-check.sh`
- **Logs**: `/var/log/dia-cron/stream-health.log`
- **State**: `/tmp/stream-health-state.json`

### LibreTime Patches
- **Queue patch**: `/srv/libretime/patches/queue.py`
- **Playout fetcher**: `/srv/libretime/patches/player/fetch.py`

### Documentation
- **Stream health monitoring**: `docs/STREAM_HEALTH_MONITORING.md`
- **Incident reports**: `docs/STREAM_HEALTH_INCIDENT_NOV4_2025.md`
- **Bug log**: `docs/BUGLOG.md`
- **Changelog**: `CHANGELOG.md`

---

## Testing & Validation

### Manual Testing
```bash
# Run health check manually
/srv/payload/scripts/stream-health-check.sh

# View health check logs
tail -f /var/log/dia-cron/stream-health.log

# Check health check state
cat /tmp/stream-health-state.json | jq

# Test deterministic feed
curl -H "Authorization: Bearer $PAYLOAD_API_KEY" \
  https://content.diaradio.live/api/schedule/deterministic | jq
```

### Monitoring Commands
```bash
# View recent restarts
grep "CRITICAL: Triggering restart" /var/log/dia-cron/stream-health.log | tail -20

# Check for end time violations
grep "Show exceeded end time" /var/log/dia-cron/stream-health.log | tail -20

# Monitor feed status
grep "Feed update" /var/log/dia-cron/stream-health.log | tail -20

# Check current stream status
curl -s -u admin:269e61fe1a5f06f15ccf7b526dacdfdb \
  http://localhost:8000/admin/stats.xml | grep -E "title|listeners"
```

---

## Conclusion

The deterministic feed implementation has significantly improved schedule reliability, but revealed underlying LibreTime timing bugs that require workarounds. Current system is stable with automatic recovery, but all fixes are reactive (restart-based) rather than proactive (preventive).

**Key Takeaways**:
1. Deterministic feed works as intended for schedule delivery
2. LibreTime playout has timing bugs that cause delays and transitions issues
3. Health check provides reliable auto-recovery but requires service restarts
4. Need for more graceful transition mechanism (without restarts)
5. Upstream bug fixes or alternative solutions needed for long-term stability

**Next Steps**: Investigate graceful transition mechanisms and evaluate alternatives to restart-based recovery.

---

**Document Version**: 1.3  
**Last Updated**: November 25, 2025  
**Author**: AI Assistant  
**Status**: Updated with fixes

