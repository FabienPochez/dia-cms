# Post-Air Script Diagnosis - January 9, 2025

## Issue
5 episodes aired yesterday (Thursday, January 8) but `firstAiredAt` was not set.

## Post-Air Script Query Criteria

The post-air script (`scripts/cron/postair_archive_cleanup.ts`) queries episodes with these criteria:

```typescript
{
  and: [
    { publishedStatus: { equals: 'published' } },  // ❓ CRITICAL: Must be 'published'
    { scheduledEnd: { exists: true } },             // ✅ Must have scheduledEnd
    { scheduledEnd: { greater_than_equal: fortyEightHoursAgo } }, // ✅ Within last 48h
    { scheduledEnd: { less_than: tenMinutesAgo } }, // ✅ At least 10 minutes ago
    { libretimeFilepathRelative: { exists: true } }, // ✅ Must have file path
    { libretimeFilepathRelative: { not_equals: '' } }, // ✅ Path must not be empty
  ]
}
```

## Possible Reasons Why Episodes Weren't Processed

### 1. publishedStatus is 'scheduled' instead of 'published' ⚠️ MOST LIKELY

**Issue**: User mentioned episodes are in "scheduled" status. This could mean:
- `publishedStatus: 'scheduled'` ❌ (won't match query)
- `airStatus: 'scheduled'` (doesn't affect query)

**Query requires**: `publishedStatus: { equals: 'published' }`

**Fix needed**: Either:
- Change episodes to `publishedStatus: 'published'`
- OR update query to also include `publishedStatus: 'scheduled'`

### 2. scheduledEnd not set or outside time window

**Query requires**: 
- `scheduledEnd` exists
- `scheduledEnd >= now - 48 hours`
- `scheduledEnd < now - 10 minutes`

**Check needed**: Verify episodes have `scheduledEnd` and it's in the correct time window.

### 3. Missing libretimeFilepathRelative

**Query requires**: 
- `libretimeFilepathRelative` exists
- `libretimeFilepathRelative` is not empty string

**Check needed**: Verify episodes have file paths set.

### 4. Time window issue

**Time window**: Episodes must have aired:
- At least 10 minutes ago (to avoid processing episodes currently airing)
- Within the last 48 hours

**Current time**: January 9, 2025
- Episodes from January 8 should be within 48h window ✅
- Episodes should be more than 10 minutes old ✅

### 5. Script hasn't run yet or cron not configured

**Check needed**: Verify cron job is running every 10 minutes.

## Query Details

**Location**: `scripts/cron/postair_archive_cleanup.ts:495-522`

**Time Window Calculation**:
```typescript
const now = new Date()
const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)
```

**Full Query**:
```typescript
{
  and: [
    { publishedStatus: { equals: 'published' } },  // ⚠️ KEY REQUIREMENT
    { scheduledEnd: { exists: true } },
    { scheduledEnd: { greater_than_equal: fortyEightHoursAgo.toISOString() } },
    { scheduledEnd: { less_than: tenMinutesAgo.toISOString() } },
    { libretimeFilepathRelative: { exists: true } },
    { libretimeFilepathRelative: { not_equals: '' } },
  ]
}
```

## Most Likely Issue: publishedStatus Mismatch

**User reported**: Episodes are in "scheduled" status with no `firstAirDate`

**Possible interpretations**:
1. `publishedStatus: 'scheduled'` ❌ (doesn't match query requirement)
2. `airStatus: 'scheduled'` (doesn't affect query - this is fine)

**The query explicitly requires**: `publishedStatus: { equals: 'published' }`

**If episodes have `publishedStatus: 'scheduled'`**, they will NOT be found by the query, and `firstAiredAt` will never be set.

## What the Script Does When It Finds Episodes

When episodes match the query, the script:
1. Calls `updateAiringMetrics()` which:
   - Sets `firstAiredAt = scheduledAt` if it's null ✅
   - Updates `lastAiredAt = scheduledEnd`
   - Increments `plays += 1`
   - Sets `airTimingIsEstimated = true`
   - ❌ Does NOT update `airStatus` to 'aired' (this is the second issue)

## Diagnostic Steps Needed

1. **Check episode status fields** (most important):
   ```javascript
   // Need to verify for each episode:
   - publishedStatus: ? (MUST be 'published' for query to match)
   - airStatus: ? (could be 'scheduled')
   - scheduledEnd: ? (must exist and be in time window)
   - firstAiredAt: ? (should be null, which is why we need to process)
   - libretimeFilepathRelative: ? (must exist and not be empty)
   ```

2. **Check cron logs**:
   - `/var/log/dia-cron/postair-archive.log`
   - Look for lines like: `📋 Found X episodes to process`
   - If it says "Found 0 episodes", the query isn't matching

3. **Check application logs**:
   - `/srv/media/logs/cron-postair-archive.jsonl`
   - Check if any episodes were processed yesterday

4. **Time window verification**:
   - Episodes aired Thursday Jan 8
   - Today is Friday Jan 9
   - Should be within 48h window ✅
   - Should be >10 minutes old ✅

## Next Steps

1. ✅ Query the 5 episodes to check their actual status
2. ✅ Check cron logs to see if script ran
3. ✅ Verify time window calculations
4. ⚠️ If `publishedStatus` is 'scheduled', fix query or update episodes
5. ⚠️ Update script to also set `airStatus: 'aired'` when processing
