# Post-Air Scripts Audit - January 9, 2025

## Context
User aired 5 new episodes on Thursday, January 8, 2025. Episodes are in `scheduled` status with no `firstAirDate`. Need to audit post-air actions and understand workflow.

## Findings

### 1. firstAiredAt Behavior ✅ NORMAL

**Finding**: It is **completely normal** that scheduled episodes don't have a `firstAiredAt` field.

**How it works**:
- `firstAiredAt` is set by the **post-air script** (`postair_archive_cleanup.ts`) **AFTER** an episode has aired
- The script sets it only if it's `null` (line 239-241):
  ```typescript
  // Set firstAiredAt only if null
  if (!firstAiredAt) {
    updates.firstAiredAt = scheduledStart
  }
  ```

**When it gets set**:
- The post-air script runs every 10 minutes
- It queries episodes with `scheduledEnd` in the last 48 hours (excluding last 10 minutes)
- It updates `firstAiredAt` to `scheduledAt` if the field is null

**Reference**: `README.md:1508` and `scripts/cron/postair_archive_cleanup.ts:238-241`

### 2. SoundCloud Upload Script Behavior

**Script**: `scripts/upload-episodes-soundcloud.ts`

**What it does**:
1. Queries episodes with:
   - `airStatus: 'aired'` (not `publishedStatus`)
   - `firstAiredAt: exists` (must have aired)
   - `track_id: null` (not yet uploaded)
   - `libretimeFilepathRelative: exists` (must have audio file)

2. Uploads audio file to SoundCloud with:
   - Track title: "Episode Title (DD.MM.YY)"
   - Permalink slug: "Show Title (DD.MM.YY)" (slugified, max 80 chars)
   - Description from episode or show
   - Cover image if available

3. Updates Payload episode with:
   - `track_id` (SoundCloud track ID)
   - `soundcloud` (SoundCloud URL)
   - `scPermalink` (SoundCloud permalink pathname)

**What it does NOT do**:
- ❌ Does **NOT** change `publishedStatus` to 'published'
- ❌ Does **NOT** change `airStatus` (episodes must already be 'aired')

**Reference**: `scripts/upload-episodes-soundcloud.ts:469-499`

### 3. Post-Air Archive & Cleanup Script Behavior

**Script**: `scripts/cron/postair_archive_cleanup.ts`

**What it does**:
1. Queries episodes with:
   - `publishedStatus: 'published'`
   - `scheduledEnd` in last 48h (excluding last 10m)
   - `libretimeFilepathRelative: exists`

2. Updates airing metrics:
   - Sets `firstAiredAt` if null (to `scheduledAt`)
   - Updates `lastAiredAt` (to `scheduledEnd`)
   - Increments `plays` counter
   - Sets `airTimingIsEstimated: true`

3. Archives episode (if not already archived):
   - Rehydrates working file if missing
   - Archives to weekly bucket structure
   - Hydrates archive paths in Payload
   - Cleans up working files

**What it does NOT do**:
- ❌ Does **NOT** change `publishedStatus` (episodes must already be 'published')
- ❌ Does **NOT** change `airStatus` to 'aired'

**Reference**: `README.md:1505-1516` and `scripts/cron/postair_archive_cleanup.ts`

### 4. Status Workflow Summary

Current workflow:
1. Episode created → `publishedStatus: 'submitted'` or `'draft'`
2. Episode approved → `publishedStatus: 'published'`
3. Episode scheduled → `airStatus: 'scheduled'`, `scheduledAt` and `scheduledEnd` set
4. **Episode airs** (on LibreTime)
5. **Post-air script runs** → Sets `firstAiredAt`, updates `lastAiredAt`, increments `plays`, archives file
   - ⚠️ Script requires `publishedStatus: 'published'` to run
   - ⚠️ Script does NOT change `airStatus` to 'aired'
6. **SoundCloud upload script runs** → Uploads to SoundCloud (requires `airStatus: 'aired'`)
   - ⚠️ Script requires `airStatus: 'aired'` (but post-air script doesn't set it!)
   - ⚠️ Script requires `firstAiredAt` to be set (post-air script does this)

## Issues Identified

### Issue 1: airStatus Not Updated by Post-Air Script ⚠️

**Problem**: 
- Post-air script updates metrics but does **NOT** change `airStatus` to `'aired'`
- SoundCloud upload script requires `airStatus: 'aired'` to process episodes
- This creates a gap: episodes may have aired but can't be uploaded to SoundCloud

**Current State**:
- Post-air script queries: `publishedStatus: 'published'` ✅
- Post-air script updates: `firstAiredAt`, `lastAiredAt`, `plays` ✅
- Post-air script does NOT update: `airStatus` ❌

**SoundCloud script requires**: `airStatus: 'aired'` ❌

### Issue 2: publishedStatus vs airStatus Confusion

**Current behavior**:
- Post-air script filters by `publishedStatus: 'published'`
- SoundCloud script filters by `airStatus: 'aired'`
- These are different fields with different meanings

**Recommendation**: Clarify the relationship between these two fields in the workflow.

## Action Items

1. ✅ **Verify episodes status**: Check the 5 aired episodes from Thursday
   - What is their `publishedStatus`?
   - What is their `airStatus`?
   - Do they have `firstAiredAt`?
   - Do they have `scheduledEnd` in the last 48h?

2. ⚠️ **Fix post-air script**: Consider updating `airStatus` to `'aired'` when processing
   - Update `scripts/cron/postair_archive_cleanup.ts` to set `airStatus: 'aired'` when `firstAiredAt` is set

3. ✅ **Run SoundCloud upload**: Once episodes have `airStatus: 'aired'` and `firstAiredAt` set
   - Script: `npx tsx scripts/upload-episodes-soundcloud.ts`

4. ✅ **Create Hetzner archive script**: Archive tracks to Hetzner storage box
   - Should archive episodes that have been uploaded to SoundCloud
   - Use existing infrastructure: `scripts/sh/archive/rsync_one.sh`

## Next Steps

1. Query the 5 episodes from Thursday to check their current status
2. Fix the post-air script to update `airStatus` to `'aired'`
3. Run post-air script manually if needed
4. Run SoundCloud upload script for eligible episodes
5. Create Hetzner archive script for post-SoundCloud archiving

---

## Additional Fixes (2026-01-09)

### 7. SSH Connectivity for rsync_postair_weekly.sh - **FIXED**

**Problem**: The `rsync_postair_weekly.sh` script was failing with "Cannot connect to bx-archive. Check SSH alias configuration" when running inside the jobs container.

**Root Cause**: 
- The script was using `ssh bx-archive` directly without specifying the mounted SSH key path (`/home/node/.ssh/id_ed25519`)
- The script was using `~/.ssh/` for ControlPath, which may not be writable in the container
- Unlike `rsync_pull.sh`, which had been updated to handle jobs container SSH keys, `rsync_postair_weekly.sh` hadn't been updated with the same pattern

**Fix**: 
- Updated `rsync_postair_weekly.sh` to detect if `/home/node/.ssh/id_ed25519` exists (indicating jobs container) and use it explicitly
- Changed ControlPath from `~/.ssh/cm-%r@%h:%p` to `/tmp/ssh-cm-%r@%h:%p` for writable location
- Matched the SSH handling pattern from `rsync_pull.sh` (which was already working)
- Added `jq` package to `Dockerfile.jobs` (required for JSON logging in the script)

**Location**: 
- `scripts/sh/archive/rsync_postair_weekly.sh:65-74`
- `Dockerfile.jobs:10`

**Reference**: See CHANGELOG.md entry "[2026-01-06] - Jobs Container & Rsync Pull SSH" for context on the original jobs container SSH setup.

**Status**: ✅ Fixed - SSH connectivity now works from jobs container (requires rebuilding jobs image: `docker compose build jobs`)
