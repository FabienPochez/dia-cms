# Step 4D: Range Diff/Apply Endpoints - Quick Summary

## ✅ IMPLEMENTATION COMPLETE

### Files Created
1. **`/src/app/api/schedule/diff-range/route.ts`** (356 lines)
   - POST endpoint for computing scheduling plan
   - Reconciles client changes with server state
   - Detects conflicts (overlaps, NOT_LT_READY, invalid episodes)
   - Returns minimal unplan→plan operations

2. **`/src/app/api/schedule/apply-range/route.ts`** (428 lines)
   - POST endpoint for executing scheduling plan
   - Optimistic locking via serverHash
   - Batch unplan→plan with per-op idempotency
   - Partial success support (207 status)
   - Comprehensive rollback on failures

3. **`/docs/STEP_4D_RANGE_DIFF_APPLY_REVIEWER_PACK.md`** (Full documentation)

---

## Quick Test Commands

### 1. Diff Request
```bash
curl -X POST "http://payload-payload-1:3000/api/schedule/diff-range" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "startISO": "2025-10-15T00:00:00Z",
    "endISO": "2025-10-22T00:00:00Z",
    "clientChanges": [
      {
        "episodeId": "EPISODE_ID",
        "showId": "SHOW_ID",
        "scheduledAt": "2025-10-16T14:00:00Z",
        "scheduledEnd": "2025-10-16T15:00:00Z"
      }
    ]
  }'
```

### 2. Apply Request
```bash
curl -X POST "http://payload-payload-1:3000/api/schedule/apply-range" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "startISO": "2025-10-15T00:00:00Z",
    "endISO": "2025-10-22T00:00:00Z",
    "confirm": true,
    "serverHash": "HASH_FROM_DIFF_RESPONSE",
    "plan": { ... }
  }'
```

---

## Key Features

### ✅ Safety Features
- **Optimistic Locking**: Server hash prevents concurrent modifications
- **Idempotency**: Safe retries with `${episodeId}:${scheduledAt}` keys
- **Collision Detection**: Validates overlaps before execution
- **Rollback**: Deletes empty instances on playout failure

### ✅ Validation
- **Auth**: Staff/admin only (placeholder - needs proper implementation)
- **LT-Ready**: Checks `libretimeTrackId` + `libretimeFilepathRelative`
- **Time Validation**: End must be after start
- **Show Validation**: Episode must belong to specified show

### ✅ Error Handling
- **400**: Bad request (missing fields, invalid times)
- **401**: Unauthorized
- **409**: Hash mismatch (state changed)
- **207**: Partial success (some ops failed)
- **500**: Internal server error

### ✅ Logging
All operations logged with structured format:
```
[DIFF-RANGE] schedule.diff_range.requested/produced
[APPLY-RANGE] schedule.apply_range.unplan/plan/confirmed/error
```

---

## Operation Statuses

### Unplan Operations
- `unscheduled` - Successfully removed from schedule
- `error` - Failed to remove

### Plan Operations
- `scheduled` - Successfully scheduled in LibreTime
- `rehydrate_queued` - Needs LibreTime track data (logged, not enqueued)
- `waiting_lt_ready` - Track not ready in LibreTime
- `error` - Failed to schedule

---

## Known Limitations & TODOs

### ⚠️ Before Production
1. **Auth**: Replace placeholder with proper Payload auth integration
2. **Rehydration Queue**: Implement background job processing
3. **Rate Limiting**: Add per-user/session limits
4. **Load Testing**: Test with 100+ operations

### 📊 Monitoring Needed
- Hash mismatch rate (indicates concurrency issues)
- Partial success rate (indicates data quality issues)
- Operation latency (track performance)

---

## Log Patterns to Monitor

```bash
# Successful operations
grep "schedule.diff_range.produced" logs
grep "schedule.apply_range.completed" logs

# Hash mismatches (concurrency)
grep "hash_mismatch" logs

# Rehydration needed
grep "rehydrate.queued" logs

# Track not ready
grep "waiting_lt_ready" logs

# Errors
grep "schedule.apply_range.*error" logs
```

---

## Next Steps

1. ✅ Endpoints implemented
2. ✅ Documentation complete
3. ⚠️ **Manual testing needed**
4. ⚠️ **Auth integration needed**
5. ⚠️ **Integration tests needed**
6. ⚠️ **Load testing needed**

**See full reviewer pack for detailed implementation notes, API examples, and deployment guide.**

