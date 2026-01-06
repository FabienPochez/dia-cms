# Deterministic Feed Features Verification

**Date**: 2026-01-03  
**Purpose**: Verify all documented features from `DETERMINISTIC_FEED_REVIEWER_PACK.md` are actually active and working

## Verification Results

### ✅ Track ID Verification (Issue #7, Nov 26, 2025)
- **Status**: ✅ ACTIVE
- **Evidence**: 
  - Code present: `TRACK_ID_MISMATCH` check in `stream-health-check.sh` (lines 277-283)
  - State file contains: `feed_first_id`, `currently_playing_track_id`, `track_id_mismatch`
  - Logic: Compares `CURRENTLY_PLAYING_TRACK_ID` from LibreTime schedule with `FEED_FIRST_ID` from deterministic feed
  - Triggers: Sets `MISMATCH=true` when IDs don't match (line 408-409)

### ✅ Schedule Change Detection (Issue #6, Nov 25, 2025)
- **Status**: ✅ ACTIVE
- **Evidence**:
  - Code present: `FEED_SCHEDULE_CHANGED` and `SCHEDULE_CHANGE_ACTIVE` logic (lines 285-305)
  - State file contains: `feed_first_start`, `prev_feed_first_start`
  - Logic: Compares current `FEED_FIRST_START` and `FEED_FIRST_ID` with previous values
  - Grace period: 45 seconds before triggering restart
  - Triggers: `schedule-changed` restart reason (line 577)

### ✅ End Time Violation Detection (Issue #2, Nov 21, 2025)
- **Status**: ✅ ACTIVE
- **Evidence**:
  - Code present: `SHOW_EXCEEDED_END_TIME` check (lines 478-492)
  - Logic: Compares `NOW_TS` with `FEED_FIRST_END_TS` from deterministic feed
  - Threshold: `END_TIME_VIOLATION_THRESHOLD` (default 60 seconds)
  - Triggers: `show-exceeded-end-time` restart reason (line 572)
  - Override: If exceeded by >60s, overrides ALL suppressions (line 487)

### ✅ Skip Logic in fetch.py (Issue #5, Nov 25, 2025)
- **Status**: ✅ ACTIVE
- **Evidence**:
  - Code present: Skip logic in `/srv/libretime/patches/player/fetch.py` (lines 327-373)
  - Patches mounted: `docker-compose.yml` shows patches are mounted (lines 37-38)
  - Logs show: "Skipping schedule application: correct show already playing" messages
  - Logic: Checks `row_id` match, start time match, time window, and end time

### ✅ Queue Filter (Issue #3 mitigation, Nov 7, 2025)
- **Status**: ✅ ACTIVE
- **Evidence**:
  - Code present: Queue filter in `/srv/libretime/patches/queue.py` (line 120)
  - Patches mounted: `docker-compose.yml` shows queue.py is mounted (line 38)
  - Filter: `event.end > now` to include future and currently playing shows

### ✅ Critical Title Detection
- **Status**: ✅ ACTIVE
- **Evidence**:
  - Code present: `CRITICAL_TITLE` check (lines 495-502)
  - Detects: "UNKNOWN", "OFFLINE", empty titles
  - Triggers: `critical-title` restart reason (line 566)

### ✅ Stable Longtrack Suppression
- **Status**: ✅ ACTIVE
- **Evidence**:
  - Code present: `STABLE_LONGTRACK` logic (lines 468-476)
  - Suppression: Prevents restarts when same show playing, bytes increasing, within skew
  - Exceptions: Overridden by end time violations, schedule changes, critical titles

## Potential Issues Found

### 1. Queue Filter May Be Too Restrictive
- **Issue**: Queue shows `first_start_utc=16:00:00` even though feed has `first_start=15:00:00`
- **Possible Cause**: Queue filter `event.end > now` should include 15:00 show (ends at 16:00), but it's not appearing
- **Investigation Needed**: Check if events are being filtered out incorrectly or if schedule_data isn't being sent to queue

### 2. Schedule Fetch Timing
- **Issue**: Schedule only fetched on queue timeout (~6-7 minutes), missing transitions
- **Status**: Documented in Issue #3 as "MITIGATED" but still causing 18+ minute delays
- **Recommendation**: Implement proactive fetching before show boundaries

### 3. Cue-In Calculation
- **Issue**: Feed always sets `cue_in_sec=0` (to prevent restarts), but this breaks late-start handling
- **Status**: Fix implemented in code (2026-01-03) but not yet deployed
- **Recommendation**: Deploy fix and test

## Conclusion

All documented features from the reviewer pack are **present in code and active**. However, the current issue (18+ minute delays) suggests:

1. The features are working as designed, but there's a new or more severe manifestation of the underlying LibreTime bugs
2. The queue filter or schedule application logic may have a bug that's preventing shows from being added to the queue
3. The reactive nature of the fixes (restart-based) means issues are detected after they occur, not prevented proactively

**Next Steps**:
1. Investigate why queue shows `first_start_utc=16:00:00` when feed has `first_start=15:00:00`
2. Implement proactive schedule fetching before boundaries
3. Deploy and test cue-in calculation fix
4. Consider track splitting for long tracks (>55 minutes) to avoid LibreTime bug entirely




