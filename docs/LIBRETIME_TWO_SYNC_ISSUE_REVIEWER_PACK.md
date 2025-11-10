# LibreTime Two-Sync Issue - Technical Reviewer Pack

**Date**: October 14, 2025  
**Status**: 🟡 FUNCTIONAL WITH LIMITATION  
**Severity**: Medium (UX Impact)  
**Context**: Planner "Sync This Week" feature requires two syncs to fully remove deleted episodes from LibreTime

---

## 1. Executive Summary

The Planner sync feature is **fully functional** for adding/moving episodes but requires **two consecutive syncs** to completely remove deleted episodes from LibreTime. This is caused by LibreTime API's eventual consistency behavior where deleted playouts don't immediately disappear from list queries.

### Current Behavior
```
User Action: Delete episode from Payload Planner → Click "Sync This Week"
├─ Sync #1: ✅ Removes playout from LibreTime instance
│            ❌ Instance remains (appears empty in UI but API still returns playouts)
└─ Sync #2: ✅ Detects truly empty instance → Deletes instance
```

### Desired Behavior
```
User Action: Delete episode from Payload Planner → Click "Sync This Week"
└─ Sync #1: ✅ Removes playout AND instance in single operation
```

---

## 2. Technical Root Cause Analysis

### 2.1 LibreTime API Eventual Consistency

**Problem**: LibreTime's `/show-instances/{id}/files` endpoint exhibits caching behavior:

```typescript
// In apply-range/route.ts - After deleting playout 147
await ltClient.deletePlayout(147)  // DELETE /show-instances/98/files/147 → 204 No Content

// Immediately after (200ms delay)
const playouts = await ltClient.listPlayouts(98)  // GET /show-instances/98/files
console.log(playouts.length)  // Returns: 1 (STALE DATA!)

// On next sync (minutes later)
const playouts = await ltClient.listPlayouts(98)  // GET /show-instances/98/files  
console.log(playouts.length)  // Returns: 0 (CORRECT!)
```

**Evidence from Logs** (`lines 996-998`):
```
[APPLY-RANGE] schedule.apply_range.cleanup.playout episodeId=orphaned_147 playoutId=147
[APPLY-RANGE] Checking instance 98 after playout deletion: 1 playouts remaining
[APPLY-RANGE] Instance 98 still has 1 playouts - will be cleaned up on next sync
```

**Second Sync** (`lines 1004-1013`):
```
[DIFF-RANGE] Instance 98: 0 total playouts
[DIFF-RANGE] Found empty instance 98 - will clean up
[LT] Force deleting instance 98
[LT] Successfully force deleted instance 98
```

### 2.2 Current Workaround Logic

**File**: `/srv/payload/src/app/api/schedule/apply-range/route.ts` (Lines 196-230)

```typescript
// After deleting an orphaned playout
if (unplanOp.instanceId) {
  // Add delay to allow LibreTime API to update (eventual consistency)
  await sleep(200) // ⚠️ Not sufficient for API cache refresh
  
  const instancePlayouts = await ltClient.listPlayouts(unplanOp.instanceId)
  console.log(
    `[APPLY-RANGE] Checking instance ${unplanOp.instanceId} after playout deletion: ${instancePlayouts.length} playouts remaining`,
  )
  
  if (instancePlayouts.length === 0) {
    await ltClient.deleteInstance(unplanOp.instanceId)
  } else {
    // ❌ API still returns stale playouts - instance not deleted
    console.log(
      `[APPLY-RANGE] Instance ${unplanOp.instanceId} still has ${instancePlayouts.length} playouts - will be cleaned up on next sync`,
    )
  }
}
```

### 2.3 Failed Attempts to Fix

#### Attempt #1: Increased Delay (200ms → 500ms → 1000ms)
- **Result**: ❌ No improvement
- **Reason**: LibreTime cache timeout is longer than reasonable request delay

#### Attempt #2: Aggressive "Valid Playouts" Logic
```typescript
// Count playouts that correspond to currently scheduled Payload episodes
const validPlayouts = instancePlayouts.filter((playout) => {
  return Array.from(serverState.values()).some(
    (ep) =>
      Number(ep.libretimeTrackId) === playout.file &&
      ep.scheduledAt === playout.starts_at &&
      ep.scheduledEnd === playout.ends_at,
  )
})

if (validPlayouts.length === 0) {
  // Delete instance even if total playouts > 0
  await ltClient.forceDeleteInstance(instance.id)
}
```
- **Result**: ❌ Caused infinite loop (sync → delete → re-add → delete → ...)
- **Reason**: Matching logic had edge cases; deleted instances with valid content

#### Attempt #3: Current Safe Approach
```typescript
// Only delete instances with 0 total playouts
if (instancePlayouts.length === 0) {
  await ltClient.forceDeleteInstance(instance.id)
}
```
- **Result**: ✅ Safe but requires two syncs
- **Reason**: Waits for LibreTime API to confirm instance is empty

---

## 3. System Architecture Overview

### 3.1 Sync Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ USER: Clicks "Sync This Week" Button                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: POST /api/schedule/diff-range                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch Payload scheduled episodes (DB query)                  │
│ 2. Fetch LibreTime playouts for date range (GET /schedules)     │
│ 3. Reconcile differences:                                       │
│    ├─ Episodes in Payload but not in LT → plan[]               │
│    ├─ Playouts in LT but not in Payload → unplan[]             │
│    └─ Empty LT instances (0 playouts) → unplan[]               │
│ 4. Return: { plan, unplan, serverHash }                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: POST /api/schedule/apply-range                          │
├─────────────────────────────────────────────────────────────────┤
│ FOR EACH unplan operation:                                      │
│   ├─ orphaned_playout_cleanup:                                 │
│   │   ├─ DELETE playout from LT (DELETE /files/{id})           │
│   │   ├─ sleep(200ms) ⚠️ Wait for API                          │
│   │   ├─ Check if instance empty (GET /files)                  │
│   │   └─ If empty → DELETE instance ⚠️ FAILS DUE TO CACHE      │
│   └─ empty_instance_cleanup:                                   │
│       └─ Force DELETE instance (DELETE /show-instances/{id})    │
│                                                                  │
│ FOR EACH plan operation:                                        │
│   ├─ Ensure LT show exists (GET/POST /shows)                   │
│   ├─ Ensure LT instance exists (GET/POST /show-instances)      │
│   ├─ Create playout (POST /show-instances/{id}/files)          │
│   └─ Update Payload episode with LT IDs                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Files & Methods

| File | Method | Purpose | Issue |
|------|--------|---------|-------|
| `diff-range/route.ts` | `POST` | Detects empty instances | ✅ Works correctly |
| `apply-range/route.ts` | `POST` | Executes cleanup | ⚠️ Instance check fails |
| `libretimeClient.ts` | `listPlayouts()` | Lists instance files | ❌ Returns stale data |
| `libretimeClient.ts` | `deletePlayout()` | Deletes playout | ✅ Deletion succeeds |
| `libretimeClient.ts` | `forceDeleteInstance()` | Force deletes instance | ✅ Works when called |

---

## 4. Code Deep Dive

### 4.1 LibreTime Client - Relevant Methods

**File**: `/srv/payload/src/integrations/libretimeClient.ts`

```typescript
// Method that exhibits caching issue
async listPlayouts(instanceId: number): Promise<LTPlayout[]> {
  try {
    const data = await this.request(`/show-instances/${instanceId}/files`, {
      method: 'GET',
    })
    
    // ⚠️ This returns cached data immediately after DELETE
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error('[LT] Failed to list playouts:', error)
    return []
  }
}

// Playout deletion (works correctly)
async deletePlayout(playoutId: number): Promise<boolean> {
  try {
    await this.request(`/show-instances/files/${playoutId}`, {
      method: 'DELETE',
    })
    console.log(`[LT] Successfully deleted playout ${playoutId}`)
    return true
  } catch (error) {
    console.error('[LT] Failed to delete playout:', error)
    return false
  }
}

// Instance deletion (works when called)
async forceDeleteInstance(instanceId: number): Promise<boolean> {
  try {
    console.log(`[LT] Force deleting instance ${instanceId}`)
    await this.request(`/show-instances/${instanceId}`, {
      method: 'DELETE',
    })
    console.log(`[LT] Successfully force deleted instance ${instanceId}`)
    return true
  } catch (error) {
    console.error('[LT] Failed to force delete instance:', error)
    return false
  }
}
```

### 4.2 Apply-Range - Auto Cleanup Logic

**File**: `/srv/payload/src/app/api/schedule/apply-range/route.ts` (Lines 196-230)

```typescript
} else if (unplanOp.reason === 'orphaned_playout_cleanup') {
  // Orphaned playout removal
  if (!dryRun && unplanOp.playoutId) {
    const deleted = await ltClient.deletePlayout(unplanOp.playoutId)
    if (deleted) {
      results.push({
        episodeId: unplanOp.episodeId,
        status: 'unscheduled',
        idempotencyKey,
      })
      successCount++
      console.log(
        `[APPLY-RANGE] schedule.apply_range.cleanup.playout episodeId=${unplanOp.episodeId} playoutId=${unplanOp.playoutId} key=${idempotencyKey}`,
      )

      // ⚠️ CRITICAL SECTION - Auto-cleanup attempt
      // Check if the instance is now empty and clean it up
      if (unplanOp.instanceId) {
        // Add delay to allow LibreTime API to update (eventual consistency)
        await sleep(200) // ⚠️ NOT SUFFICIENT
        
        const instancePlayouts = await ltClient.listPlayouts(unplanOp.instanceId)
        console.log(
          `[APPLY-RANGE] Checking instance ${unplanOp.instanceId} after playout deletion: ${instancePlayouts.length} playouts remaining`,
        )
        
        // ❌ THIS CHECK FAILS - listPlayouts returns stale data
        if (instancePlayouts.length === 0) {
          console.log(
            `[APPLY-RANGE] Instance ${unplanOp.instanceId} is now empty - cleaning up`,
          )
          await ltClient.deleteInstance(unplanOp.instanceId)
          console.log(
            `[APPLY-RANGE] schedule.apply_range.cleanup.instance instanceId=${unplanOp.instanceId} (auto-cleanup after playout removal)`,
          )
        } else {
          // ✅ THIS PATH IS TAKEN - Cleanup deferred to next sync
          console.log(
            `[APPLY-RANGE] Instance ${unplanOp.instanceId} still has ${instancePlayouts.length} playouts - will be cleaned up on next sync if orphaned`,
          )
        }
      }
    }
  }
}
```

### 4.3 Diff-Range - Empty Instance Detection

**File**: `/srv/payload/src/app/api/schedule/diff-range/route.ts` (Lines 427-442)

```typescript
// Check for empty instances
const allInstances = await ltClient.getInstances({
  starts: rangeStart,
  ends: rangeEnd,
})

for (const instance of allInstances) {
  // Check if this instance has any playouts at all
  const instancePlayouts = ltSchedules.filter((p) => p.instance === instance.id)

  console.log(`[DIFF-RANGE] Instance ${instance.id}: ${instancePlayouts.length} total playouts`)

  // ✅ This works correctly on SECOND sync
  // Because enough time has passed for LibreTime cache to clear
  if (instancePlayouts.length === 0) {
    instancesToCleanup.add(instance.id)
    console.log(
      `[DIFF-RANGE] Found empty instance ${instance.id} (${instance.starts_at} to ${instance.ends_at}) - will clean up`,
    )
  }
}
```

---

## 5. Potential Solutions for Evaluation

### Solution A: Aggressive Force Delete (HIGH RISK)
```typescript
// After deleting playout, immediately force delete instance
// WITHOUT checking if it's empty
if (unplanOp.instanceId) {
  await ltClient.forceDeleteInstance(unplanOp.instanceId)
}
```
**Pros**: Single sync operation  
**Cons**: ⚠️ Could delete instances with valid content if logic has bugs  
**Risk**: HIGH - Data loss potential

---

### Solution B: Multiple Verification Attempts (MEDIUM RISK)
```typescript
// Retry listPlayouts with exponential backoff
if (unplanOp.instanceId) {
  let isEmpty = false
  const maxRetries = 3
  
  for (let i = 0; i < maxRetries; i++) {
    await sleep(500 * (i + 1)) // 500ms, 1000ms, 1500ms
    const playouts = await ltClient.listPlayouts(unplanOp.instanceId)
    
    if (playouts.length === 0) {
      isEmpty = true
      break
    }
  }
  
  if (isEmpty) {
    await ltClient.forceDeleteInstance(unplanOp.instanceId)
  }
}
```
**Pros**: Safer, waits for API consistency  
**Cons**: Slow (up to 3 seconds per instance), may still fail  
**Risk**: MEDIUM - Could timeout, slow UX

---

### Solution C: Direct LibreTime DB Query (REQUIRES INVESTIGATION)
```typescript
// Query LibreTime database directly instead of API
// Bypass caching layer entirely
const playouts = await ltClient.queryDatabase(
  'SELECT COUNT(*) FROM cc_playout WHERE instance_id = ?',
  [instanceId]
)
```
**Pros**: Immediate, accurate data  
**Cons**: Requires DB access, coupling to LT internals  
**Risk**: MEDIUM - LibreTime schema changes could break this

---

### Solution D: LibreTime API Cache Invalidation (REQUIRES LT MODIFICATION)
```typescript
// Add cache-busting header or endpoint call
await ltClient.deletePlayout(playoutId)
await ltClient.invalidateCache(instanceId) // Hypothetical
const playouts = await ltClient.listPlayouts(instanceId)
```
**Pros**: Clean API-level solution  
**Cons**: Requires LibreTime API changes  
**Risk**: LOW - But requires upstream contribution

---

### Solution E: Accept Two-Sync (CURRENT - LOW RISK)
```typescript
// Keep current implementation
// Document limitation and educate users
```
**Pros**: Safe, no data loss, works reliably  
**Cons**: UX friction (extra click)  
**Risk**: NONE - Proven stable

---

## 6. Test Scenarios & Results

### Test 1: Add Episodes (Single Sync) ✅
```
Action: Add 3 episodes to Planner → Sync
Result: ✅ All 3 episodes appear in LibreTime
Syncs Required: 1
```

### Test 2: Move Episodes (Single Sync) ✅
```
Action: Move episode from Monday to Tuesday → Sync
Result: ✅ Episode moves in LibreTime, old instance cleaned up
Syncs Required: 1
Note: Uses updateInstance() to reuse instance
```

### Test 3: Delete Episodes (Two Syncs) ⚠️
```
Action: Delete episode from Planner → Sync #1
Result: ⚠️ Playout removed, empty instance remains in LibreTime

Action: Sync #2 (no changes in Planner)
Result: ✅ Empty instance removed from LibreTime
Syncs Required: 2
```

### Test 4: Mixed Operations (Variable) ⚠️
```
Action: Add 2, move 1, delete 1 → Sync #1
Result: ✅ Add + move succeed
        ⚠️ Delete removes playout but leaves instance

Action: Sync #2
Result: ✅ Empty instance cleaned up
Syncs Required: 2 (for complete cleanup)
```

---

## 7. LibreTime API Behavior Documentation

### Observed API Response Patterns

#### Immediately After Playout Deletion
```bash
# DELETE playout
curl -X DELETE http://libretime/api/v2/show-instances/files/147
# Response: 204 No Content

# GET instance files (within 200ms)
curl http://libretime/api/v2/show-instances/98/files
# Response: [
#   { "id": 147, "file": 374, ... }  # ❌ STALE - Playout still appears!
# ]
```

#### After Cache Timeout (Unknown Duration)
```bash
# GET instance files (after ~minutes)
curl http://libretime/api/v2/show-instances/98/files
# Response: []  # ✅ CORRECT - Playout gone
```

### LibreTime API Endpoints Used

| Endpoint | Method | Purpose | Cache Behavior |
|----------|--------|---------|----------------|
| `/show-instances/{id}/files` | GET | List playouts | ❌ CACHED |
| `/show-instances/files/{id}` | DELETE | Delete playout | ✅ IMMEDIATE |
| `/show-instances/{id}` | DELETE | Delete instance | ✅ IMMEDIATE |
| `/schedules` | GET | List schedules | ✅ IMMEDIATE |

---

## 8. Recommendation for Chad/ChatGPT Analysis

### Questions to Explore

1. **LibreTime API Internals**
   - Does LibreTime v2 API have cache headers we can inspect?
   - Is there a cache invalidation endpoint?
   - What's the typical cache TTL?

2. **Alternative Approaches**
   - Can we use LibreTime's `/schedules` endpoint instead of `/show-instances/{id}/files`?
   - Does `/schedules` exhibit the same caching behavior?
   - Can we track instance emptiness without querying LibreTime?

3. **State Management**
   - Should we maintain a client-side cache of instance states?
   - Can we use optimistic updates and reconcile later?
   - Should we add a "pending deletion" state for instances?

4. **API Design Patterns**
   - How do other systems handle eventual consistency in sync operations?
   - Should we implement a polling mechanism with a timeout?
   - Could we use webhooks/callbacks from LibreTime (if supported)?

---

## 9. Current Workaround for Users

**User Documentation** (to be added to UI or docs):

```
When deleting episodes from the Planner:
1. Click "Sync This Week" to remove the episode content from LibreTime
2. Click "Sync This Week" again to remove the empty show instance

This two-step process ensures data integrity with LibreTime's API.
```

---

## 10. Environment & Version Info

| Component | Version | Notes |
|-----------|---------|-------|
| Payload CMS | Latest | Next.js App Router |
| LibreTime | v2 API | API endpoint unknown version |
| Node.js | Unknown | Check production |
| Database | PostgreSQL | Payload backend |

---

## 11. Log Excerpts for Analysis

### Complete Sync Cycle (Delete Episode)

```log
# USER DELETES EPISODE IN PLANNER
[PAYLOAD] PATCH /api/episodes/686d10d0d9c5ee507e7c92c8 200 in 176ms

# SYNC #1 - DIFF PHASE
[DIFF-RANGE] schedule.diff_range.requested range=2025-10-11T22:00:00.000Z to 2025-10-18T22:00:00.000Z
[DIFF-RANGE] Found orphaned LibreTime playout: 147 (File 374) at 2025-10-16T12:30:00Z
[DIFF-RANGE] Orphaned playout 147 has no corresponding Payload episode - will clean up
[DIFF-RANGE] Instance 98: 1 total playouts
[DIFF-RANGE] schedule.diff_range.produced unplan=1 plan=0

# SYNC #1 - APPLY PHASE
[APPLY-RANGE] schedule.apply_range.unplan episodeId=orphaned_147
[APPLY-RANGE] schedule.apply_range.cleanup.playout playoutId=147
[APPLY-RANGE] Checking instance 98 after playout deletion: 1 playouts remaining  ⚠️
[APPLY-RANGE] Instance 98 still has 1 playouts - will be cleaned up on next sync

# SYNC #2 - DIFF PHASE (moments later)
[DIFF-RANGE] schedule.diff_range.requested
[DIFF-RANGE] Instance 98: 0 total playouts  ✅
[DIFF-RANGE] Found empty instance 98 - will clean up
[DIFF-RANGE] schedule.diff_range.produced unplan=1 plan=0

# SYNC #2 - APPLY PHASE
[APPLY-RANGE] schedule.apply_range.unplan episodeId=empty_instance_98
[LT] Force deleting instance 98
[LT] Successfully force deleted instance 98  ✅
```

---

## 12. Files to Review

For a complete understanding, review these files:

1. **Core Logic**
   - `/srv/payload/src/app/api/schedule/diff-range/route.ts` (Lines 427-442)
   - `/srv/payload/src/app/api/schedule/apply-range/route.ts` (Lines 196-230)
   - `/srv/payload/src/integrations/libretimeClient.ts` (Full file)

2. **Documentation**
   - `/srv/payload/CHANGELOG.md` (Lines 184-187 - Known Issues)
   - `/srv/payload/docs/STEP_4D_INTEGRATION_GUIDE.md`

3. **UI**
   - `/srv/payload/src/admin/components/PlannerViewWithLibreTime.tsx` (Sync button logic)

---

## 13. Success Criteria for Solution

A successful solution must:

1. ✅ Delete episodes from LibreTime in **one sync operation**
2. ✅ Maintain **data integrity** (no accidental deletions)
3. ✅ Handle **edge cases** (concurrent syncs, partial failures)
4. ✅ Complete within **reasonable time** (< 5 seconds)
5. ✅ Work with **LibreTime v2 API as-is** (no LT modifications)
6. ✅ Be **maintainable** (clear code, good logging)

---

## 14. Contact & Next Steps

**Current Maintainer**: Development Team  
**Reviewer**: Chad/ChatGPT  
**Status**: Awaiting analysis and recommendation

**Next Steps**:
1. Analyze LibreTime API caching behavior
2. Evaluate Solution B (retry with backoff) vs Solution E (accept two-sync)
3. Implement chosen solution
4. Update user documentation
5. Add automated tests for cleanup scenarios

---

**END OF REVIEWER PACK**

