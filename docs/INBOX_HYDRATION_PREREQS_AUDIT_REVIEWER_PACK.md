# Inbox Hydration Prereqs Audit — Reviewer Pack

**Date**: 2025-01-XX  
**Auditor**: AI Assistant  
**Scope**: Audit Cron A/B, JSONL logs, status enum for separate inbox hydration workflow

---

## 1. SUMMARY

- **Cron A (Pre-air)**: Runs every 15 min, queries episodes scheduled in next 24h, rehydrates missing working files from archive to `/srv/media/imported/1`; relies on `libretimeFilepathRelative`, `archiveFilePath`, `publishedStatus: 'published'`, `scheduledAt`
- **Cron B (Post-air)**: Runs every 10 min, queries episodes that aired 10m-48h ago, archives to weekly buckets (`archive/YYYY/week-WW`), cleans up working files from `/srv/media/imported/1`; relies on `libretimeFilepathRelative`, `hasArchiveFile`, `archiveFilePath`, `scheduledEnd`, `publishedStatus: 'published'`
- **Path format**: Cron B uses **weekly buckets** (`archive/YYYY/week-WW`), not monthly (`YYYY-MM/`); archive hydration scripts support both formats
- **JSONL schema**: `batch_rsync_hydrate.sh` produces `{episodeId, archivePath, bucket, filename, size, ts, rsyncExitCode}`; can map to inbox files via `filename` (episodeId prefix pattern)
- **Filename generation**: Host uploads to `/srv/media/new` use pattern `{episodeId}__{showSlug}__{titleSlug}__{episodeNumber}.mp3` (24-char hex prefix); sufficient for mapping JSONL → inbox file
- **Status enum**: `publishedStatus` values: `draft`, `submitted`, `published`, `scheduled`; host uploads set to `submitted`; recommend transition `submitted → published` (or new `ready-to-air`) after inbox hydration completes
- **Deletion triggers**: Cron B deletes from `/srv/media/imported/1` only after successful archive transfer + Payload hydration; Cron A never deletes (only copies)
- **Rehydration triggers**: Cron A copies from archive → `/srv/media/imported/1` if working file missing and `archiveFilePath` exists
- **Separate scripts strategy**: Archive hydration scripts can remain unchanged; new inbox scripts can call existing scripts as subprocesses; minimal new scripts needed: `hydrate-inbox-automation.ts` (wrapper) or separate import/archive/cleanup scripts

---

## 2. DIFFS

**No code changes proposed in audit phase.**

---

## 3. LOGS

**No logs generated in audit phase.**

---

## 4. QUESTIONS & RISKS

### Questions

1. **LibreTime file organization**: After importing from `/srv/media/new`, where does LibreTime place files? Same as `/srv/media/tracks` → `/srv/media/imported/1/`? Or does it keep them in `/srv/media/new`?

2. **Status transition timing**: Should status change from `submitted → published` happen immediately after LibreTime import completes, or after archive transfer completes? Or should we add a new status like `ready-to-air`?

3. **Archive bucket strategy**: Should inbox files use weekly buckets (`archive/YYYY/week-WW`) like Cron B, or monthly buckets (`YYYY-MM/`) like archive hydration scripts? Or separate bucket prefix (e.g., `inbox/YYYY-MM/`)?

4. **Cleanup target**: For inbox automation, should cleanup delete from `/srv/media/new` (original location) or `/srv/media/imported/1/` (LibreTime-organized location)? Or both?

5. **Cron overlap**: Can inbox hydration cron run concurrently with Cron A/B? Lockfile mechanism exists but may need coordination.

6. **JSONL sourcePath field**: Should we add `sourcePath` to JSONL schema to track original inbox location, or is `filename` + episodeId lookup sufficient?

7. **Status query filter**: Should inbox hydration query episodes with `publishedStatus: 'submitted'` or also include `draft`? What about `pendingReview: true`?

8. **Error handling**: If inbox hydration fails for some episodes, should script continue processing others or exit? How should partial failures be tracked?

### Risks

1. **Low**: Weekly vs monthly bucket mismatch - Cron B uses weekly, archive scripts support monthly; inbox scripts should choose one format consistently
2. **Low**: Filename collision - If same episodeId exists in both `/srv/media/new` and `/srv/media/imported/1`, cleanup may delete wrong file
3. **Low**: Status transition race - If host edits episode while hydration runs, status may change unexpectedly
4. **Low**: JSONL mapping ambiguity - If filename doesn't match exactly (e.g., LibreTime renames), mapping may fail

---

## Detailed Audit Report

### A) Cron A / Cron B Expectations

#### A.1 Cron Entrypoints

**Cron A: Pre-air Rehydrate**
- **Path**: `scripts/cron/preair_rehydrate.ts`
- **Schedule**: Every 15 minutes (`*/15 * * * *`)
- **Docker Service**: `jobs` (ephemeral container via `docker compose run --rm jobs`)
- **Lockfile**: `/tmp/dia-preair.lock` (prevents overlapping runs)
- **Logs**: 
  - Execution: `/var/log/dia-cron/preair-rehydrate.log`
  - JSONL: `/srv/media/logs/cron-preair-rehydrate.jsonl`

**Cron B: Post-air Archive & Cleanup**
- **Path**: `scripts/cron/postair_archive_cleanup.ts`
- **Schedule**: Every 10 minutes (`*/10 * * * *`)
- **Docker Service**: `jobs` (ephemeral container via `docker compose run --rm jobs`)
- **Lockfile**: `/tmp/dia-postair.lock` (prevents overlapping runs)
- **Logs**:
  - Execution: `/var/log/dia-cron/postair-archive.log`
  - JSONL: `/srv/media/logs/cron-postair-archive.jsonl`

#### A.2 Cron A: Pre-air Rehydrate

**What it does**:
- Queries episodes scheduled to air in next 24 hours (`scheduledAt` between now and now+24h)
- Checks if working file exists at `/srv/media/{libretimeFilepathRelative}`
- If missing, copies from archive (`archiveFilePath`) to working directory
- Updates LibreTime database: sets `file_exists = true` after successful copy
- Logs operations to JSONL

**Directories read/written**:
- **Reads**: `/srv/media/imported/1/` (checks if working file exists)
- **Reads**: Archive via SSH (`bx-archive:/home/archive/{archiveFilePath}`)
- **Writes**: `/srv/media/imported/1/` (copies file from archive)
- **Never deletes**: Only copies files, never removes them

**Payload fields relied on**:
- `publishedStatus: 'published'` (query filter)
- `scheduledAt` (query filter: next 24h)
- `libretimeFilepathRelative` (required, used to construct working path)
- `archiveFilePath` (optional, used as source for rehydration)

**Deletion triggers**: None - Cron A never deletes files.

**Re-copy triggers**: 
- Working file missing at `/srv/media/{libretimeFilepathRelative}`
- `archiveFilePath` exists in Payload
- Episode scheduled within next 24 hours

**Path format expectations**:
- Uses `libretimeFilepathRelative` directly (e.g., `imported/1/Artist/Album/file.mp3`)
- Archive paths can be any format (weekly, monthly, legacy) - script doesn't care

#### A.3 Cron B: Post-air Archive & Cleanup

**What it does**:
- Queries episodes that aired 10 minutes to 48 hours ago (`scheduledEnd` between now-48h and now-10m)
- If `hasArchiveFile: true`: Skips archive step, deletes working file from `/srv/media/imported/1/`
- If `hasArchiveFile: false`: Archives working file to weekly bucket, hydrates Payload with archive path, deletes working file
- Updates airing metrics: `lastAiredAt`, `plays++`, `firstAiredAt` (if null)
- Calls `hydrate-archive-paths.ts` and `cleanup-imported-files.ts` as subprocesses

**Directories read/written**:
- **Reads**: `/srv/media/imported/1/` (checks if working file exists)
- **Writes**: Archive via SSH (`bx-archive:/home/archive/{weeklyDir}/{filename}`)
- **Deletes**: `/srv/media/imported/1/` (after successful archive + hydration)
- **Also checks**: `/srv/media/imported/1/processed/` (LibreTime may move files here)

**Payload fields relied on**:
- `publishedStatus: 'published'` (query filter)
- `scheduledEnd` (query filter: 10m-48h ago)
- `libretimeFilepathRelative` (required, used to construct working path)
- `hasArchiveFile` (determines if archive step needed)
- `archiveFilePath` (used if rehydration needed before archiving)

**Deletion triggers**:
- `hasArchiveFile: true` → Delete working file immediately (already archived)
- `hasArchiveFile: false` → Archive first, then delete working file after successful hydration

**Re-copy triggers**: 
- If working file missing before archiving, attempts rehydration from `archiveFilePath` (if exists)
- Uses `rehydrateEpisodeDirect()` function (same as Cron A)

**Path format expectations**:
- **Uses weekly buckets**: `archive/YYYY/week-WW` (e.g., `archive/2025/week-42`)
- Computed via `getWeeklyArchivePath(scheduledEnd)` function
- Archive path format: `{weeklyDir}/{basename}` (e.g., `archive/2025/week-42/file.mp3`)
- **Note**: Different from archive hydration scripts which use monthly buckets (`YYYY-MM/`)

#### A.4 Path Format Summary

| Script/Service | Path Format | Example |
|----------------|-------------|---------|
| Cron B (postair) | Weekly: `archive/YYYY/week-WW` | `archive/2025/week-42/file.mp3` |
| Archive hydration scripts | Monthly: `YYYY-MM/` | `2025-10/file.mp3` |
| Legacy archive | Flat: `legacy/` | `legacy/file.mp3` |
| LibreTime working | Organized: `imported/1/Artist/Album/` | `imported/1/Artist/Album/file.mp3` |

**Recommendation**: Inbox hydration should use **weekly buckets** (like Cron B) for consistency with post-air workflow, OR use separate prefix (e.g., `inbox/YYYY-MM/`) to distinguish from scheduled episodes.

---

### B) JSONL Schema Suitability for Inbox Cleanup

#### B.1 JSONL Schema from `batch_rsync_hydrate.sh`

**Schema** (lines 233-241):
```json
{
  "episodeId": "685e6a57b3ef76e0e25c2557",
  "archivePath": "legacy/filename.mp3",
  "bucket": "legacy",
  "filename": "685e6a57__show-slug__title-slug__001.mp3",
  "size": 86149711,
  "ts": "2025-10-15T14:30:45.123Z",
  "rsyncExitCode": 0
}
```

**Required keys**:
- `episodeId` (string, 24-char hex)
- `archivePath` (string, relative path on archive server)
- `bucket` (string, archive bucket name)
- `filename` (string, basename of file)
- `size` (number, bytes)
- `ts` (string, ISO timestamp)
- `rsyncExitCode` (number, 0 = success)

**Error records** (if episodeId missing):
```json
{
  "error": "invalid_filename",
  "filename": "badfile.mp3",
  "archivePath": "legacy/badfile.mp3",
  "ts": "2025-10-15T14:30:45.123Z",
  "rsyncExitCode": 1
}
```

#### B.2 Mapping JSONL → Inbox File

**Current capability**:
- ✅ **Can map**: JSONL `filename` contains episodeId prefix (`^[a-f0-9]{24}__`)
- ✅ **Can locate**: Inbox file at `/srv/media/new/{filename}` (if filename matches exactly)
- ⚠️ **Limitation**: If LibreTime renames file (e.g., adds Artist/Album subdirectories), filename may not match

**Example mapping**:
```bash
# JSONL entry:
{"episodeId":"685e6a57...","filename":"685e6a57__show__title__001.mp3",...}

# Inbox file location:
/srv/media/new/685e6a57__show__title__001.mp3

# Can delete via:
rm /srv/media/new/685e6a57__show__title__001.mp3
```

**Smallest change needed** (if mapping fails):
- Add `sourcePath` field to JSONL: `"sourcePath": "/srv/media/new/685e6a57__show__title__001.mp3"`
- **Risk**: Breaks existing `hydrate-archive-paths.ts` and `cleanup-imported-files.ts` if they don't handle new field
- **Mitigation**: Make `sourcePath` optional, scripts ignore if missing

#### B.3 Filename Generation for Host Uploads

**Pattern** (from `src/utils/filenameFromEpisode.ts`):
```
{episodeId}__{showSlug}__{titleSlug}__{episodeNumber}.{ext}
```

**Example**:
```
685e6a57b3ef76e0e25c2557__diaspora-island-vibes__special-reggae-mix__42.mp3
```

**Components**:
- `episodeId`: 24-char MongoDB ObjectID (hex, lowercase)
- `showSlug`: Slugified show title (ASCII, lowercase, dashes)
- `titleSlug`: Slugified episode title
- `episodeNumber`: Integer episode number
- `ext`: From MIME type (`.mp3`, `.wav`, `.aiff`, `.m4a`)

**Validation**: Regex `/^([a-f0-9]{24})__([^_]+)__([^_]+)__(\d+)\.(mp3|wav|aiff|m4a)$/i`

**Sufficiency for mapping**: ✅ **Yes** - EpisodeId prefix is sufficient to:
1. Extract episodeId from JSONL `filename`
2. Locate inbox file at `/srv/media/new/{filename}`
3. Verify ownership via Payload API (`GET /api/episodes/{episodeId}`)

---

### C) Episode Status Enum + Transition Point

#### C.1 Status Enum Definition

**Location**: `src/collections/Episodes.ts` (lines 188-196)

**`publishedStatus` values**:
- `draft` (default) - Episode not ready for review
- `submitted` - Episode submitted by host, awaiting admin/staff approval
- `published` - Episode published and available
- `scheduled` - Episode scheduled to air (may be redundant with `published`)

**`airStatus` values** (lines 319-329):
- `draft` (default)
- `queued` - Queued for scheduling
- `scheduled` - Scheduled to air
- `airing` - Currently airing
- `aired` - Already aired
- `failed` - Air failed

#### C.2 Status Set on Host Upload

**Upload flow** (from `src/admin/components/EpisodeUploadView.tsx`):
1. Host creates draft episode via `/api/episodes/new-draft` → `publishedStatus: 'draft'`
2. Host uploads audio file → File saved to `/srv/media/new/{episodeId}__...mp3`
3. Host submits form → `publishedStatus: 'submitted'`, `pendingReview: true`

**Code reference** (`src/collections/Episodes.ts`, line 199):
```typescript
// Allow hosts to set status to 'submitted' during upload
```

**Email notification** (lines 928-929):
```typescript
// Only notify on create or when publishedStatus changes to 'submitted'
if (doc.publishedStatus !== 'submitted' || !doc.pendingReview) {
```

#### C.3 Recommended Status Transition

**Minimal transition for inbox hydration**:
- **From**: `publishedStatus: 'submitted'`
- **To**: `publishedStatus: 'published'` (or new status `ready-to-air`)

**When**: After successful LibreTime import + Payload hydration (before archive transfer)

**Where**: In new inbox hydration script (`hydrate-inbox-automation.ts`), after `import-batch-archives-media.ts` completes successfully

**Alternative**: Add new status `ready-to-air` to enum:
- **Pros**: Clear distinction between "submitted for review" and "ready to schedule"
- **Cons**: Requires enum change, may need UI updates

**Recommendation**: Use existing `published` status (simpler, no enum changes needed)

---

### D) Recommendation for "Separate Scripts" Strategy

#### D.1 Can Archive Scripts Remain Unchanged?

**✅ Yes** - Archive hydration scripts can remain unchanged if:
- New inbox scripts call them as subprocesses (like Cron B does)
- Inbox scripts handle directory differences (`/srv/media/new` vs `/srv/media/tracks`)
- Inbox scripts handle status transitions separately

**Reusable components**:
- `import-batch-archives-media.ts` - Can be called with `--directory /srv/media/new` (after adding CLI arg)
- `batch_rsync_hydrate.sh` - Already accepts directory as CLI arg
- `hydrate-archive-paths.ts` - Reads JSONL log, directory-agnostic
- `cleanup-imported-files.ts` - Can be called with `--directory /srv/media/new` (after adding CLI arg)

#### D.2 Minimal New Scripts Needed

**Option 1: Single Wrapper Script** (Recommended)
- **Name**: `scripts/hydrate-inbox-automation.ts`
- **Purpose**: Orchestrates import → poll/hydrate → archive → hydrate archive paths → cleanup
- **Features**:
  - Queries episodes with `publishedStatus: 'submitted'`
  - Calls existing scripts as subprocesses
  - Handles graceful timeout if LibreTime still analyzing
  - Updates status to `published` after successful hydration
- **Pros**: Single entrypoint, easier to test, clear separation
- **Cons**: New file to maintain

**Option 2: Separate Scripts** (More modular)
- **Names**:
  - `scripts/hydrate-inbox-import.ts` - Import to LibreTime + hydrate Payload
  - `scripts/hydrate-inbox-archive.ts` - Archive to Hetzner + hydrate archive paths
  - `scripts/cleanup-inbox.ts` - Delete from `/srv/media/new`
- **Pros**: More granular control, easier to debug individual steps
- **Cons**: More files to maintain, requires coordination between scripts

**Recommendation**: **Option 1 (Single Wrapper)** - Simpler, matches Cron B pattern, easier to orchestrate

#### D.3 Implementation Strategy

**Minimal changes to existing scripts**:
1. Add `--directory` CLI arg to `import-batch-archives-media.ts` (backward compatible, default: `/srv/media/tracks`)
2. Add `--directory` CLI arg to `cleanup-imported-files.ts` (backward compatible, default: `/srv/media/imported/1`)

**New script**:
- `scripts/hydrate-inbox-automation.ts` - Wrapper that:
  - Queries episodes with `publishedStatus: 'submitted'` and files in `/srv/media/new`
  - Calls `import-batch-archives-media.ts --directory /srv/media/new`
  - Polls LibreTime API with graceful timeout
  - Calls `batch_rsync_hydrate.sh` for archive transfer
  - Calls `hydrate-archive-paths.ts` for Payload hydration
  - Calls `cleanup-imported-files.ts --directory /srv/media/new` for cleanup
  - Updates `publishedStatus: 'published'` after successful hydration

**Cron entry**:
```bash
# Inbox hydration (every 12 hours)
0 */12 * * * /usr/bin/flock -n /tmp/dia-inbox.lock docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/hydrate-inbox-automation.ts' >> /var/log/dia-cron/inbox-hydration.log 2>&1
```

---

## Go/No-Go Checklist for Implementation Readiness

### ✅ Go Conditions

1. **Cron A/B understood**: Both crons documented, path formats confirmed (weekly vs monthly), deletion/rehydration triggers identified
2. **JSONL schema sufficient**: Can map JSONL `filename` → inbox file via episodeId prefix; optional `sourcePath` field can be added if needed
3. **Filename pattern confirmed**: Host uploads use `{episodeId}__...` pattern, sufficient for mapping
4. **Status enum documented**: `publishedStatus: 'submitted'` set on upload, transition to `published` recommended after hydration
5. **Separate scripts strategy**: Archive scripts can remain unchanged, single wrapper script recommended
6. **Path format decision**: Weekly buckets (like Cron B) OR separate prefix (e.g., `inbox/YYYY-MM/`) - needs decision before implementation

### ⚠️ Blockers (Need Answers)

1. **LibreTime file organization**: Where does LibreTime place files after importing from `/srv/media/new`? (affects cleanup target)
2. **Archive bucket format**: Weekly (`archive/YYYY/week-WW`) or monthly (`YYYY-MM/`) or separate (`inbox/YYYY-MM/`)? (affects archive path generation)
3. **Status transition timing**: Change status immediately after LibreTime import or after archive transfer? (affects script flow)

### 📋 Pre-Implementation Tasks

1. Verify LibreTime import behavior for `/srv/media/new` directory
2. Decide archive bucket format (weekly vs monthly vs separate)
3. Confirm status transition timing (import vs archive)
4. Test filename mapping: JSONL → inbox file (with actual files)
5. Add `--directory` CLI args to existing scripts (backward compatible)
6. Create `hydrate-inbox-automation.ts` wrapper script

---

**Status**: ✅ **GO** (pending answers to 3 blockers above)

