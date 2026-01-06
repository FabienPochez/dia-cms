# Deterministic Feed Audit - Schedule Update Latency Issue

**Date**: 2026-01-03  
**Issue**: Shows starting late (18+ minutes) despite deterministic feed knowing exact schedule  
**Severity**: High - Schedule slipping, cascading delays  
**Related**: See `DETERMINISTIC_FEED_REVIEWER_PACK.md` for historical context and previous fixes

## Problem Summary

Despite having a deterministic feed that knows the exact schedule, shows are starting 18+ minutes late. The schedule update is being fetched 2-3 minutes after the show should have started, and even when applied, the show doesn't start until much later.

## Relationship to Previous Issues

This issue is related to issues documented in `DETERMINISTIC_FEED_REVIEWER_PACK.md`:

- **Issue #3 (Hourly Boundary Timing)**: Documented 2-3 minute delays, marked as "MITIGATED"
- **Issue #5 (Large Schedule Delta)**: Skip logic fix prevents restarts during long shows
- **Current Issue**: More severe manifestation - 18+ minute delays, schedule not being applied correctly

The skip logic from Issue #5 may be preventing necessary schedule updates, or there's a regression in the queue filter logic.

## Root Cause Analysis

### 1. Schedule Fetch Timing Issue

**Observation from logs:**
- At 15:00:00 UTC: Queue says "waiting 3599.994578s until next scheduled item" (waiting for 16:00)
- At 15:02:28 UTC: Schedule fetched and applied, `first_start=15:00:00`, `delta=148.627s`
- Queue shows `first_start_utc=2026-01-03T16:00:00Z` (still waiting for 16:00, not playing 15:00)

**Root Cause:**
- LibreTime only fetches the deterministic feed when the queue times out
- Queue timeout happens every `POLL_INTERVAL` (~6-7 minutes based on logs)
- This means schedule updates can be delayed by up to 6-7 minutes
- At show boundaries, if the timeout happens AFTER the show should start, the show is missed

**Example Timeline:**
```
14:55:47 - Last schedule fetch (queue timeout)
15:00:00 - Show should start (15:00-16:00 show)
15:02:27 - Queue timeout, schedule fetched
15:02:28 - Schedule applied (2.5 minutes late)
15:02:28 - Queue still shows waiting for 16:00 (15:00 show not in queue)
```

### 2. Queue Filter Issue

**Observation:**
- Queue filter: `event.end > now` (line 120 in queue.py)
- At 15:00:00, if 15:00 show has `end=16:00:00`, then `16:00:00 > 15:00:00` = true, so it should be included
- But queue shows `first_start_utc=16:00:00`, meaning 15:00 show isn't in the queue

**Possible Causes:**
1. Schedule wasn't fetched before 15:00, so 15:00 show wasn't in the schedule_data
2. Queue was built from old schedule_data that didn't include 15:00 show
3. Queue filter is removing the 15:00 show for some other reason

### 3. Cue-In Calculation Issue

**Observation:**
- Deterministic feed always sets `cue_in_sec = 0` (to prevent restarts)
- When show starts late, it starts from beginning instead of correct position
- LibreTime calculates `cue_in` when applying schedule (e.g., `cue_in=973.770947` at 17:02:37)
- But show doesn't actually start until 18 minutes later, so cue_in is wrong

**Root Cause:**
- Feed sets `cue_in_sec = 0` for all shows
- LibreTime calculates cue_in based on `delta` (time since show should have started)
- But if schedule is applied late, the calculated cue_in is based on when schedule was applied, not when show actually starts
- If show starts even later (18 minutes), it starts from beginning (cue_in=0)

## Current Behavior

1. **Schedule Fetch**: Only happens on queue timeout (~6-7 minute intervals)
2. **Queue Update**: Applied 2-3 minutes after show should start
3. **Show Start**: Actually starts 18+ minutes late
4. **Cue-In**: Starts from beginning (cue_in=0) instead of correct position
5. **Cascade**: Next show also starts late, compounding the delay

## Expected Behavior (Per Specification)

From `DETERMINISTIC_SCHEDULE_FEED.md`:
- "Feed always contains **current item** plus at least one upcoming item"
- "Consumer should fetch feed with short timeouts, honouring `ETag`"
- "Atomically replace queue when validation succeeds and version is newer (optionally defer if within ±2s of first start)"

**What should happen:**
1. Schedule should be fetched proactively before show boundaries (not just on timeout)
2. Queue should include currently playing show + next show
3. When schedule is applied, show should start immediately (not 18 minutes later)
4. Cue-in should be calculated correctly for late starts

## Potential Solutions

### Option 1: Proactive Schedule Fetching (Recommended)

**Approach**: Modify LibreTime fetch logic to proactively fetch schedule before show boundaries

**Implementation:**
- Calculate time until next show start
- If next show starts within next 2 minutes, fetch schedule immediately
- Don't wait for queue timeout

**Pros:**
- Ensures schedule is always up-to-date before transitions
- Minimal changes to existing code
- Works with current deterministic feed

**Cons:**
- Requires LibreTime patch modification
- May increase API calls (but should be minimal with ETag)

### Option 2: Split Long Tracks (>55 minutes)

**Approach**: Split tracks longer than 55 minutes into multiple segments

**Rationale:**
- LibreTime has known bug with tracks >55 minutes (Issue #1275)
- Long tracks cause 3-4 minute delays at start
- Splitting tracks would avoid this bug entirely

**Implementation:**
- Detect tracks >55 minutes during import/hydration
- Split into segments (e.g., 50-minute segments with 5-minute overlap)
- Schedule segments sequentially

**Pros:**
- Avoids LibreTime long-track bug
- More reliable playback
- Better for schedule accuracy

**Cons:**
- Requires track splitting logic
- More schedule entries per show
- Potential for gaps if splitting fails

### Option 3: Fix Cue-In Calculation in Feed

**Approach**: Calculate `cue_in_sec` in deterministic feed for late starts

**Implementation:**
- In `deterministicFeed.ts`, calculate `cue_in_sec` for first item if it has already started
- Only apply to first item (currently playing/next show)
- Use skip logic to prevent restarts of shows already playing

**Status**: ✅ Already implemented (2026-01-03)

**Pros:**
- Keeps schedule on track for late starts
- No LibreTime changes needed

**Cons:**
- Doesn't fix the root cause (late schedule updates)
- Still relies on schedule being fetched/applied

### Option 4: Hybrid Approach

**Approach**: Combine proactive fetching + cue-in calculation + track splitting

**Implementation:**
1. Proactive schedule fetching before boundaries
2. Cue-in calculation for late starts (already done)
3. Track splitting for long tracks (>55 minutes)

**Pros:**
- Addresses all root causes
- Most reliable solution

**Cons:**
- Most complex implementation
- Requires multiple changes

## Recommendations

1. **Immediate**: Implement proactive schedule fetching (Option 1)
   - Highest impact, minimal changes
   - Fixes the root cause of late schedule updates

2. **Short-term**: Verify cue-in calculation fix (Option 3)
   - Already implemented, needs testing
   - Should help with late starts once schedule is fetched

3. **Long-term**: Consider track splitting (Option 2)
   - If LibreTime long-track bug continues to cause issues
   - Would require more significant changes

## Testing Plan

1. **Proactive Fetching Test**:
   - Monitor logs for schedule fetches before show boundaries
   - Verify shows start within 2 seconds of scheduled time
   - Check that queue includes current show + next show

2. **Cue-In Calculation Test**:
   - Intentionally delay a show start
   - Verify cue_in is calculated correctly
   - Verify show doesn't start from beginning

3. **Long Track Test**:
   - Schedule a show with track >55 minutes
   - Monitor for delays at start
   - Compare with split track approach

## Questions to Investigate

1. Why does the queue show `first_start_utc=16:00:00` when schedule has `first_start=15:00:00`?
2. Why does the show start 18 minutes late even after schedule is applied?
3. Is the queue filter removing the current show incorrectly?
4. What is the actual `POLL_INTERVAL` value?
5. Can we add proactive fetching without breaking existing logic?

## Next Steps

1. ✅ Fix cue-in calculation (done)
2. ⏳ Implement proactive schedule fetching
3. ⏳ Test with real schedule
4. ⏳ Monitor for improvements
5. ⏳ Consider track splitting if issues persist

