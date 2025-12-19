# Episode State Wiring Audit — Reviewer Pack

**Date**: 2025-01-XX  
**Auditor**: AI Assistant  
**Scope**: Audit episode state wiring across Payload fields, Planner behavior, and Cron mutations

---

## 1. SUMMARY

- **Fields exist**: `publishedStatus` (`draft`, `submitted`, `published`, `scheduled`), `airStatus` (`draft`, `queued`, `scheduled`, `airing`, `aired`, `failed`), `pendingReview` (boolean), `scheduledAt`/`scheduledEnd` (dates), `firstAiredAt`/`lastAiredAt`/`plays` (metrics, read-only)
- **No publishAt/embargo field**: No "publish later" field exists; `publishedAt` is required but not used for embargo logic
- **Planner writes**: Sets `scheduledAt`, `scheduledEnd`, `airStatus: 'scheduled'`, `libretimePlayoutId`, `libretimeInstanceId`; does NOT set `publishedStatus`
- **Planner unscheduling**: Sets `airStatus: 'queued'` (unplanOne) or `'unscheduled'` (delete), clears schedule dates; does NOT change `publishedStatus`
- **Cron A (preair)**: Only reads `publishedStatus: 'published'` (query filter), does NOT mutate any status fields
- **Cron B (postair)**: Only updates metrics (`firstAiredAt`, `lastAiredAt`, `plays++`), does NOT mutate `publishedStatus` or `airStatus`
- **Host upload**: Sets `publishedStatus: 'submitted'`, `airStatus: 'draft'`, `pendingReview: true`
- **SoundCloud pipeline**: No status mutations found; only sets SoundCloud-specific fields (`soundcloud`, `scPermalink`, `track_id`, etc.)
- **State machine gap**: No automated transition from `submitted → published`; requires manual admin edit
- **Live scheduling**: Planner does NOT create draft episodes; requires existing episode with `libretimeTrackId`

---

## 2. DIFFS

**No code changes proposed in audit phase.**

---

## 3. LOGS

**No logs generated in audit phase.**

---

## 4. QUESTIONS & RISKS

### Questions

1. **Status transition gap**: Who/what transitions `submitted → published`? Currently appears to be manual admin edit only.

2. **Planner publishedStatus**: Should planner set `publishedStatus: 'scheduled'` when scheduling, or keep it as-is? Currently planner ignores `publishedStatus`.

3. **UnplanOne inconsistency**: `unplanOne` route sets `airStatus: 'queued'`, but `scheduleOperations.ts` sets `airStatus: 'published'`. Which is correct?

4. **Delete route airStatus**: `/api/schedule/delete` sets `airStatus: 'unscheduled'`, but this value is not in the enum. Is this intentional?

5. **Cron B metrics timing**: Cron B updates `firstAiredAt`/`lastAiredAt` based on `scheduledEnd`, but what if episode is rescheduled? Should it track actual air time vs scheduled time?

6. **SoundCloud status**: Should SoundCloud imports set `publishedStatus: 'published'` automatically, or require manual review?

7. **Inbox hydration status**: After inbox hydration completes, should status transition `submitted → published` automatically, or require admin approval?

8. **Planner episode creation**: Should planner support creating draft episodes on-the-fly when scheduling, or require pre-existing episodes?

### Risks

1. **Medium**: Status transition gap - No automated path from `submitted → published`; relies on manual admin intervention
2. **Low**: Planner ignores `publishedStatus` - May schedule episodes that aren't "published" yet
3. **Low**: UnplanOne inconsistency - Two different `airStatus` values used (`queued` vs `published`)
4. **Low**: Delete route enum mismatch - Sets `airStatus: 'unscheduled'` which isn't in enum options

---

## Detailed Audit Report

### A) Confirm Fields Exist (Payload Schema)

**Location**: `src/collections/Episodes.ts`

#### A.1 Publication Status Fields

**`publishedStatus`** (lines 188-196):
- **Type**: `select` (enum)
- **Values**: `'draft'`, `'submitted'`, `'published'`, `'scheduled'`
- **Default**: `'draft'`
- **Required**: `true`
- **Access**: Hosts can set to `'submitted'` during upload (line 199)

**`pendingReview`** (lines 202-211):
- **Type**: `checkbox` (boolean)
- **Default**: `false`
- **Purpose**: "Episode uploaded by host, awaiting admin/staff approval"
- **Access**: Hosts can set during upload (line 210)

**`publishedAt`** (lines 123-130):
- **Type**: `date`
- **Required**: `true`
- **Access**: Hosts cannot modify (read-only for hosts)
- **Note**: Not used for embargo logic; always required

**`publishAt` / Embargo field**: ❌ **DOES NOT EXIST**
- No "publish later" or embargo field found
- `publishedAt` is required but not used for scheduling publication

#### A.2 Air Status Fields

**`airStatus`** (lines 319-338):
- **Type**: `select` (enum)
- **Values**: `'draft'`, `'queued'`, `'scheduled'`, `'airing'`, `'aired'`, `'failed'`
- **Default**: `'draft'`
- **Required**: `true`
- **Access**: Hosts cannot modify (read-only for hosts)

**`scheduledAt`** (lines 289-302):
- **Type**: `date`
- **Required**: `false`
- **Indexed**: `true`
- **Access**: Hosts cannot modify (read-only for hosts)

**`scheduledEnd`** (lines 304-317):
- **Type**: `date`
- **Required**: `false`
- **Indexed**: `true`
- **Access**: Hosts cannot modify (read-only for hosts)

#### A.3 Airing Metrics Fields (Read-Only)

**`firstAiredAt`** (lines 475-479):
- **Type**: `date`
- **Read-only**: `true` (set by Cron B)
- **Access**: No update access

**`lastAiredAt`** (lines 481-486):
- **Type**: `date`
- **Read-only**: `true` (set by Cron B)
- **Access**: No update access

**`plays`** (lines 454-459):
- **Type**: `number`
- **Default**: `0`
- **Read-only**: `true` (incremented by Cron B)
- **Access**: No update access

#### A.4 SoundCloud Fields

**`soundcloud`** (lines 407-411):
- **Type**: `text` (URL)
- **Access**: Hosts cannot modify

**`scPermalink`**, `scSlug`, `track_id` (lines 413-419):
- **Type**: `text` / `number`
- **Access**: Hosts cannot modify

**Note**: SoundCloud fields exist but no status mutations found in SoundCloud import scripts.

---

### B) Planner Behavior (What It Writes)

#### B.1 Scheduling an Episode

**Routes**: 
- `/api/schedule/planOne` (POST)
- `/api/schedule/create` (POST)
- `/api/schedule/move` (POST)
- `src/lib/services/scheduleOperations.ts::planOne()`

**Fields Written** (from `planOne` route, lines 293-303):
```typescript
{
  scheduledAt: normalizedStart,
  scheduledEnd: normalizedEnd,
  airStatus: 'scheduled',
  libretimePlayoutId: playout.id,
  libretimeInstanceId: ltInstance.id,
}
```

**Fields NOT Written**:
- ❌ `publishedStatus` - Planner ignores this field
- ❌ `pendingReview` - Not modified by planner

**Criteria**:
- Episode must have `libretimeTrackId` and `libretimeFilepathRelative` (LT-ready)
- Episode must belong to show with `libretimeInstanceId`
- Validates time range (end > start)
- Checks for schedule conflicts

#### B.2 Unscheduling an Episode

**Routes**:
- `/api/schedule/unplanOne` (DELETE)
- `/api/schedule/delete` (DELETE)
- `src/lib/services/scheduleOperations.ts::unplanOne()`

**Fields Written** (`unplanOne` route, lines 99-110):
```typescript
{
  scheduledAt: null,
  scheduledEnd: null,
  airStatus: 'queued',  // ⚠️ Note: scheduleOperations.ts uses 'published'
  libretimePlayoutId: null,
  libretimeInstanceId: null,
}
```

**Fields Written** (`delete` route, lines 121-130):
```typescript
{
  scheduledAt: null,
  scheduledEnd: null,
  airStatus: 'unscheduled',  // ⚠️ Note: Not in enum!
  libretimeScheduleId: null,
}
```

**Inconsistency**: 
- `unplanOne` route: `airStatus: 'queued'`
- `scheduleOperations.ts::unplanOne()`: `airStatus: 'published'` (line 324)
- `delete` route: `airStatus: 'unscheduled'` (not in enum)

**Fields NOT Written**:
- ❌ `publishedStatus` - Not modified by unscheduling

#### B.3 Updating a Slot (Move/Resize)

**Route**: `/api/schedule/move` (POST)

**Fields Written** (lines 142-148):
```typescript
{
  scheduledAt: startsAt,
  scheduledEnd: endsAt,
  airStatus: 'scheduled',  // Always set to 'scheduled' on move
}
```

**Fields NOT Written**:
- ❌ `publishedStatus` - Not modified

#### B.4 Planner Status Updates Summary

| Action | scheduledAt | scheduledEnd | airStatus | publishedStatus | pendingReview |
|--------|-------------|--------------|-----------|-----------------|---------------|
| Schedule | ✅ Set | ✅ Set | ✅ `'scheduled'` | ❌ Ignored | ❌ Ignored |
| Unschedule | ✅ `null` | ✅ `null` | ⚠️ `'queued'` or `'published'` | ❌ Ignored | ❌ Ignored |
| Move | ✅ Update | ✅ Update | ✅ `'scheduled'` | ❌ Ignored | ❌ Ignored |
| Delete | ✅ `null` | ✅ `null` | ⚠️ `'unscheduled'` (not in enum) | ❌ Ignored | ❌ Ignored |

#### B.5 Live Scheduling Creates Draft Episode

**Current Behavior**: ❌ **NO** - Planner does NOT create draft episodes

**Requirements**:
- Episode must already exist
- Episode must have `libretimeTrackId` and `libretimeFilepathRelative`
- Episode must belong to show with `libretimeInstanceId`

**Code Reference** (`planOne` route, lines 105-116):
```typescript
// Validate LT-ready
if (!episode.libretimeTrackId?.trim() || !episode.libretimeFilepathRelative?.trim()) {
  return { error: 'Episode not LT-ready', code: 'NOT_LT_READY' }
}
```

---

### C) Cron/Scripts Mutations

#### C.1 Cron A: Pre-air Rehydrate

**Script**: `scripts/cron/preair_rehydrate.ts`
**Schedule**: Every 15 minutes
**Query Filter** (lines 260-274):
```typescript
{
  publishedStatus: { equals: 'published' },
  scheduledAt: { exists: true },
  scheduledAt: { greater_than_equal: now },
  scheduledAt: { less_than: now + 24h },
  libretimeFilepathRelative: { exists: true },
}
```

**Fields Read**:
- `libretimeFilepathRelative` (required)
- `archiveFilePath` (optional, for rehydration)

**Fields Written**: ❌ **NONE** - Cron A does NOT mutate status fields

**Actions**:
- Checks if working file exists at `/srv/media/{libretimeFilepathRelative}`
- If missing, copies from archive (`archiveFilePath`) to working directory
- Updates LibreTime database: `file_exists = true`
- Logs operations to JSONL

**Assumptions**:
- Only processes episodes with `publishedStatus: 'published'`
- Assumes episode is already scheduled (has `scheduledAt`)

#### C.2 Cron B: Post-air Archive & Cleanup

**Script**: `scripts/cron/postair_archive_cleanup.ts`
**Schedule**: Every 10 minutes
**Query Filter** (lines 505-519):
```typescript
{
  publishedStatus: { equals: 'published' },
  scheduledEnd: { exists: true },
  scheduledEnd: { greater_than_equal: now - 48h },
  scheduledEnd: { less_than: now - 10m },
  libretimeFilepathRelative: { exists: true },
}
```

**Fields Read**:
- `libretimeFilepathRelative` (required)
- `hasArchiveFile` (determines if archive step needed)
- `archiveFilePath` (optional, for rehydration)
- `scheduledAt`, `scheduledEnd` (for metrics)
- `firstAiredAt`, `plays` (for metrics)

**Fields Written** (`updateAiringMetrics`, lines 232-247):
```typescript
{
  lastAiredAt: scheduledEnd,  // Always update to most recent
  plays: plays + 1,          // Increment counter
  firstAiredAt: scheduledStart,  // Set only if null
  airTimingIsEstimated: true,
}
```

**Fields NOT Written**:
- ❌ `publishedStatus` - Not modified
- ❌ `airStatus` - Not modified
- ❌ `pendingReview` - Not modified

**Actions**:
- Updates airing metrics (`firstAiredAt`, `lastAiredAt`, `plays++`)
- Archives working file to weekly bucket (if `hasArchiveFile: false`)
- Hydrates Payload with archive path
- Deletes working file from `/srv/media/imported/1/`

**Assumptions**:
- Only processes episodes with `publishedStatus: 'published'`
- Assumes episode has already aired (`scheduledEnd` in past)

#### C.3 Host Upload Mutations

**Component**: `src/admin/components/EpisodeUploadView.tsx`
**Route**: `/api/episodes/new-draft` (POST) + `/api/episodes/{episodeId}` (PATCH)

**Fields Written** (lines 366-368):
```typescript
{
  publishedStatus: 'submitted',
  airStatus: 'draft',
  pendingReview: true,
  // ... other fields (title, description, media, etc.)
}
```

**Fields Written** (`new-draft` route, lines 50-51):
```typescript
{
  publishedStatus: 'draft',
  pendingReview: false,
  // ... minimal fields
}
```

**Flow**:
1. Create draft via `/api/episodes/new-draft` → `publishedStatus: 'draft'`, `pendingReview: false`
2. Upload audio/cover files
3. Submit form → `publishedStatus: 'submitted'`, `pendingReview: true`, `airStatus: 'draft'`

#### C.4 SoundCloud Pipeline Mutations

**Scripts Searched**:
- `scripts/create-missing-episodes.ts`
- `scripts/import-sc-durations.ts`
- `scripts/importBatchEpisodes.ts`

**Fields Written**: ❌ **NO STATUS MUTATIONS FOUND**

**SoundCloud scripts only set**:
- `soundcloud`, `scPermalink`, `scSlug`, `track_id`
- `coverExternal`, `mp3_url`, `bitrate`, `realDuration`
- `publishedAt` (from SoundCloud data)

**Status fields**: Not modified by SoundCloud import scripts

#### C.5 Other Mutations Found

**Email Notification Hook** (`src/collections/Episodes.ts`, lines 926-966):
- **Trigger**: `afterChange` hook
- **Condition**: `publishedStatus === 'submitted'` AND `pendingReview === true`
- **Action**: Sends email notification to admin/staff
- **Mutations**: ❌ None - read-only hook

**Mood Filter Hook** (`src/collections/Episodes.ts`, lines 571-600):
- **Trigger**: `beforeOperation` hook (read operations only)
- **Action**: Adds mood/tone/energy filters to query
- **Mutations**: ❌ None - read-only hook

---

### D) Current State Machine (AS-IS)

#### D.1 State Transitions Map

```
┌─────────────┐
│   DRAFT     │ ← Host creates via /api/episodes/new-draft
│             │   (publishedStatus: 'draft', pendingReview: false)
└──────┬──────┘
       │
       │ Host uploads audio + submits form
       ▼
┌─────────────┐
│  SUBMITTED   │ ← Host submits form
│             │   (publishedStatus: 'submitted', pendingReview: true, airStatus: 'draft')
│             │   → Email notification sent to admin/staff
└──────┬──────┘
       │
       │ ⚠️ MANUAL ADMIN EDIT (no automation)
       ▼
┌─────────────┐
│  PUBLISHED   │ ← Admin manually sets publishedStatus: 'published'
│             │   (publishedStatus: 'published', pendingReview: false)
└──────┬──────┘
       │
       │ Planner schedules episode
       ▼
┌─────────────┐
│  SCHEDULED   │ ← Planner sets scheduledAt/scheduledEnd
│             │   (airStatus: 'scheduled', publishedStatus unchanged)
│             │   → Cron A rehydrates working file (if missing)
└──────┬──────┘
       │
       │ Episode airs (scheduledEnd passes)
       ▼
┌─────────────┐
│   AIRED     │ ← Cron B updates metrics
│             │   (airStatus unchanged, firstAiredAt/lastAiredAt/plays++ set)
│             │   → Cron B archives file + deletes working file
└─────────────┘

Other transitions:
- Planner unschedules → airStatus: 'queued' or 'published' (inconsistent)
- Planner deletes → airStatus: 'unscheduled' (not in enum)
```

#### D.2 Transition Triggers

| Transition | Trigger | Who/What | Fields Changed |
|------------|---------|----------|----------------|
| `draft → submitted` | Host upload form submit | `EpisodeUploadView.tsx` | `publishedStatus`, `pendingReview`, `airStatus` |
| `submitted → published` | ⚠️ **MANUAL ADMIN EDIT** | Admin/staff (manual) | `publishedStatus`, `pendingReview` |
| `published → scheduled` | Planner schedules | `/api/schedule/planOne` | `scheduledAt`, `scheduledEnd`, `airStatus` |
| `scheduled → aired` | Time passes (`scheduledEnd` in past) | Cron B (metrics only) | `firstAiredAt`, `lastAiredAt`, `plays` |
| `scheduled → queued` | Planner unschedules | `/api/schedule/unplanOne` | `scheduledAt`, `scheduledEnd`, `airStatus` |
| `scheduled → unscheduled` | Planner deletes | `/api/schedule/delete` | `scheduledAt`, `scheduledEnd`, `airStatus` |

#### D.3 Missing Transitions

**Gap 1**: `submitted → published`
- **Current**: Manual admin edit only
- **Needed**: Automated transition after inbox hydration completes

**Gap 2**: `published → scheduled` (status update)
- **Current**: Planner sets `airStatus: 'scheduled'` but ignores `publishedStatus`
- **Question**: Should planner also set `publishedStatus: 'scheduled'`?

**Gap 3**: SoundCloud import status
- **Current**: SoundCloud scripts don't set status
- **Question**: Should SoundCloud imports set `publishedStatus: 'published'` automatically?

---

## Recommendations (DO NOT IMPLEMENT)

### What Planner Should Set

**Minimal writes** (keep current behavior):
- ✅ `scheduledAt`, `scheduledEnd` (required)
- ✅ `airStatus: 'scheduled'` (required)
- ✅ `libretimePlayoutId`, `libretimeInstanceId` (required)

**Optional enhancement**:
- Consider setting `publishedStatus: 'scheduled'` if episode is `'published'` (but keep current behavior if episode is `'submitted'` or `'draft'`)

**Fix inconsistencies**:
- Standardize `unplanOne` to use `airStatus: 'queued'` (or `'published'`)
- Fix `delete` route to use valid enum value (not `'unscheduled'`)

### What Hydration Should Set

**After inbox hydration completes**:
- ✅ `libretimeTrackId`, `libretimeFilepathRelative` (required)
- ✅ `publishedStatus: 'published'` (transition from `'submitted'`)
- ✅ `pendingReview: false` (clear review flag)
- ❌ Do NOT set `airStatus` (keep as `'draft'` until scheduled)

**After archive hydration completes**:
- ✅ `hasArchiveFile: true`, `archiveFilePath` (required)
- ❌ Do NOT change status fields

### What SoundCloud Pipeline Should Set

**After SoundCloud import**:
- ✅ `soundcloud`, `scPermalink`, `track_id` (required)
- ✅ `publishedAt` (from SoundCloud data)
- ⚠️ **Question**: Should it set `publishedStatus: 'published'` automatically, or require manual review?
- ❌ Do NOT set `airStatus` (keep as `'draft'`)

**Recommendation**: Keep SoundCloud imports as-is (no status mutations) unless explicit requirement exists.

---

**Status**: ✅ **AUDIT COMPLETE** - Ready for implementation planning

