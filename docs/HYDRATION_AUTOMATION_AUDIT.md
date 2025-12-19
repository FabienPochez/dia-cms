# Archive Hydration Automation Audit

**Date**: 2025-01-XX  
**Goal**: Audit existing archive hydration tooling and identify minimal changes to support ongoing hydration automation for `/srv/media/new` and `/srv/media/live-inbox` while preserving archive pipeline.

---

## 1. SUMMARY

- **Archive pipeline uses 4 core scripts**: `import-batch-archives-media.ts` (import + hydrate), `batch_rsync_hydrate.sh` (transfer), `hydrate-archive-paths.ts` (archive paths), `cleanup-imported-files.ts` (cleanup)
- **Current workflow is manual**: Step 2 triggers import, Step 2-bis re-runs to poll/hydrate after LibreTime finishes (~10-20 min wait)
- **`import-batch-archives-media.ts` has two modes**: (1) bulk import trigger (if files missing in LT), (2) hydration-only (polls LT API, updates Payload)
- **Polling exists but is synchronous**: `pollLibreTimeFiles()` waits up to 90s with exponential backoff; script exits if timeout
- **Script is NOT fully idempotent**: Hardcoded `/srv/media/tracks` directory; no graceful exit if LT still analyzing; no resume capability
- **Episode matching uses filename prefix**: Extracts `episodeId` from `{episodeId}__*.mp3` pattern; matches LT files via API search
- **Data model**: `import-batch-archives-media.ts` sets `libretimeTrackId` + `libretimeFilepathRelative`; `hydrate-archive-paths.ts` sets `hasArchiveFile` + `archiveFilePath`
- **Reuse opportunity**: Scripts already support multiple directories via CLI args; minimal change to accept `/srv/media/new` and `/srv/media/live-inbox`
- **Cron readiness gaps**: No graceful timeout handling; no state tracking for "in progress" items; no skip logic for already-processed files

---

## 2. INVENTORY

### Scripts Involved in Archive Pipeline

#### 2.1 `scripts/import-batch-archives-media.ts`
- **Path**: `/srv/payload/scripts/import-batch-archives-media.ts`
- **Entrypoint**: `importBatchArchives()` (runs if executed directly)
- **Expected Args**:
  - `--episode-id=<id>` (optional, not used in batch mode)
  - `--file=<path>` (optional)
  - `--ingest=<http|cli>` (defaults to `cli`)
  - `--libretime-url=<url>` (optional, auto-detected)
  - `--dry-run` (optional)
- **Reads**: 
  - `/srv/media/tracks/*.mp3` (hardcoded directory)
  - LibreTime API (`/api/v2/files?search={episodeId}`)
  - Payload API (`/api/episodes/{episodeId}`)
- **Writes**:
  - Payload API (`PATCH /api/episodes/{episodeId}`) - sets `libretimeTrackId`, `libretimeFilepathRelative`
  - Lockfile: `/tmp/lt-bulk-import-archives.lock` (prevents concurrent bulk imports)
- **Modes**:
  1. **Import mode**: Checks if files exist in LT; if not, triggers `bulk_import` via Docker CLI
  2. **Hydration mode**: Always runs after import; polls LT API for each episode, updates Payload

#### 2.2 `scripts/sh/archive/batch_rsync_hydrate.sh`
- **Path**: `/srv/payload/scripts/sh/archive/batch_rsync_hydrate.sh`
- **Entrypoint**: Direct execution
- **Expected Args**:
  - `<local_dir_or_glob>` (e.g., `/srv/media/imported/1` or `/srv/media/imported/1/*.mp3`)
  - `<remote_rel_dir>` (e.g., `legacy`, `2025-10`)
  - `--apply` (required for actual transfer)
  - `--concurrency N` (default: 2)
  - `--log-file FILE` (default: `/srv/media/logs/rsync-archive-success.jsonl`)
  - `--verify-rate M` (default: 0)
- **Reads**: 
  - Local files from specified directory/glob
  - SSH config for `bx-archive` host
- **Writes**:
  - JSONL log: `/srv/media/logs/rsync-archive-success.jsonl` (default)
  - Remote files: `/home/archive/{remote_rel_dir}/{filename}.mp3`
- **Notes**: Extracts episode ID from filename prefix (`^[a-f0-9]{24}`); logs success/failure per file

#### 2.3 `scripts/hydrate-archive-paths.ts`
- **Path**: `/srv/payload/scripts/hydrate-archive-paths.ts`
- **Entrypoint**: `main()` (runs if executed directly)
- **Expected Args**:
  - `--log <logfile>` (required, JSONL from `batch_rsync_hydrate.sh`)
  - `--dry-run` (optional)
  - `--force` (optional, override existing archive paths)
  - `--verify` (optional, verify remote file exists)
  - `--check-libretime` / `--no-check-libretime` (default: enabled)
- **Reads**:
  - JSONL log file (from `batch_rsync_hydrate.sh`)
  - Payload API (`GET /api/episodes/{episodeId}`)
  - LibreTime API (if `--check-libretime`, searches for missing LT fields)
- **Writes**:
  - Payload API (`PATCH /api/episodes/{episodeId}`) - sets `hasArchiveFile: true`, `archiveFilePath`, optionally `libretimeTrackId` + `libretimeFilepathRelative`
- **Notes**: Idempotent (skips if `archiveFilePath` already set, unless `--force`); includes safety check to hydrate missing LibreTime fields

#### 2.4 `scripts/cleanup-imported-files.ts`
- **Path**: `/srv/payload/scripts/cleanup-imported-files.ts`
- **Entrypoint**: `main()` (runs if executed directly)
- **Expected Args**:
  - `--log <logfile>` (required, JSONL from `batch_rsync_hydrate.sh`)
  - `--dry-run` (optional)
  - `--verify-payload` / `--no-verify-payload` (default: enabled)
- **Reads**:
  - JSONL log file
  - Payload API (`GET /api/episodes/{episodeId}`) - if `--verify-payload`
  - Filesystem: `/srv/media/imported/1/**/*.mp3` (recursive search)
- **Writes**:
  - Deletes local files from `/srv/media/imported/1/` (recursively searches subdirectories)
- **Notes**: Idempotent (skips if file not found); optionally verifies Payload hydration before deletion

---

## 3. DEEP DIVE: `import-batch-archives-media.ts`

### 3.1 Modes Supported

The script operates in **two sequential modes** within a single execution:

1. **Import Trigger Mode** (lines 786-818):
   - Checks if any episode files are missing in LibreTime
   - If missing, triggers `bulk_import` via Docker CLI: `docker exec libretime-api-1 libretime-api bulk_import --path "{directoryPath}"`
   - Uses lockfile (`/tmp/lt-bulk-import-archives.lock`) to prevent concurrent bulk imports
   - **Returns immediately** after triggering import (LibreTime processes asynchronously)

2. **Hydration Mode** (lines 820-821, calls `hydrateAllEpisodes()`):
   - **Always runs** after import check
   - For each episode ID found in directory:
     - Checks if file exists in LibreTime via API search
     - If exists, fetches track ID and filepath
     - Updates Payload with `libretimeTrackId` and `libretimeFilepathRelative`
   - **No polling** - if file not found in LT, marks as error and continues

### 3.2 Episode ↔ LibreTime Matching

**Matching Strategy**:
- Extracts episode ID from filename: `^([a-f0-9]{24})__` (24-char hex prefix)
- Searches LibreTime API: `/api/v2/files?search={episodeId}__`
- Filters results to files where `filename.startsWith("{episodeId}__")`
- If multiple matches, throws error (ambiguous)
- If no matches, hydration fails for that episode

**Code Reference**:
```454:570:payload/scripts/import-batch-archives-media.ts
async function pollLibreTimeFiles(
  episodeId: string,
  baseUrl: string,
  endpointType: 'v2' | 'legacy',
): Promise<{ id: number; relativePath: string }> {
  // ... polling logic with exponential backoff ...
  // Searches: /api/v2/files?search={episodeId}
  // Filters: file.name.startsWith("{episodeId}__")
}
```

### 3.3 Polling Implementation

**Current Polling** (`pollLibreTimeFiles()`, lines 455-570):
- **Exists but NOT used in batch mode**: `pollLibreTimeFiles()` is defined but `hydrateAllEpisodes()` uses `findLibreTimeFileByPrefix()` instead (no polling)
- **Polling characteristics** (if used):
  - Exponential backoff: starts at 1s, caps at 10s
  - Total timeout: 90 seconds
  - Throws error if timeout exceeded
  - No graceful exit - script fails if LT not ready

**Actual Hydration Logic** (`hydrateAllEpisodes()`, lines 708-763):
- Uses `findLibreTimeFileByPrefix()` (lines 126-152) - **single API call, no polling**
- If file not found: logs error, increments `errorCount`, continues to next episode
- **No retry logic** - if LT hasn't finished analyzing, episode marked as failed

### 3.4 Idempotency Analysis

**Idempotent Aspects**:
- ✅ Skips import if all files already exist in LibreTime (line 799)
- ✅ Skips Payload update if episode already has same `libretimeTrackId` + `libretimeFilepathRelative` (lines 637-647)
- ✅ Lockfile prevents concurrent bulk imports

**Non-Idempotent Aspects**:
- ❌ **Hardcoded directory**: `/srv/media/tracks` (line 783) - cannot process other directories
- ❌ **No graceful exit**: If LT still analyzing, script marks episodes as failed; next run will re-check but may fail again
- ❌ **No state tracking**: Cannot resume from "partially hydrated" state
- ❌ **No skip logic**: Re-processes all episodes even if already hydrated

**Breakage Points**:
1. If script runs while LT is analyzing → episodes marked failed, need manual re-run
2. If script runs twice quickly → second run may find files in LT but hydration may fail if Payload already updated (race condition)
3. Directory hardcoding prevents processing `/srv/media/new` or `/srv/media/live-inbox`

---

## 4. REUSE FOR NEW WORKFLOW

### 4.1 Minimal Changes for Two Inboxes

**Current State**:
- `import-batch-archives-media.ts`: Hardcoded `/srv/media/tracks` (line 783)
- `batch_rsync_hydrate.sh`: Accepts directory as CLI arg (already flexible)
- `hydrate-archive-paths.ts`: Reads from JSONL log (directory-agnostic)
- `cleanup-imported-files.ts`: Hardcoded `/srv/media/imported/1` (line 50)

**Required Changes**:

1. **`import-batch-archives-media.ts`**:
   - Add `--directory` CLI arg (default: `/srv/media/tracks` for backward compat)
   - Replace hardcoded `directoryPath` with CLI arg
   - **Risk**: Low - single line change, backward compatible

2. **`cleanup-imported-files.ts`**:
   - Add `--directory` CLI arg (default: `/srv/media/imported/1` for backward compat)
   - Replace hardcoded `IMPORTED_DIR` with CLI arg
   - **Risk**: Low - single line change, backward compatible

3. **Episode ID Prefix Resolver**:
   - ✅ Already works: All scripts extract episode ID from filename prefix `^[a-f0-9]{24}__`
   - ✅ Works for both `/srv/media/new` and `/srv/media/live-inbox` (same filename format expected)

### 4.2 Workflow Differences

**Archive Pipeline** (`/srv/media/tracks`):
- Files manually placed in `/srv/media/tracks`
- After import, LibreTime moves files to `/srv/media/imported/1/` (with subdirectories)
- Archive transfer reads from `/srv/media/imported/1/`
- Cleanup deletes from `/srv/media/imported/1/`

**New Automation** (`/srv/media/new`, `/srv/media/live-inbox`):
- Files arrive via upload/automation
- After import, LibreTime may move files (behavior unclear - needs verification)
- Archive transfer should read from same directory (or LibreTime-organized location)
- Cleanup should delete from original location

**Unknown**: Where does LibreTime place files after importing from `/srv/media/new`? Same as `/srv/media/tracks` → `/srv/media/imported/1/`?

---

## 5. DATA MODEL TOUCH POINTS

### 5.1 Fields Set by `import-batch-archives-media.ts`

**Payload Episode Fields** (via `updatePayloadEpisode()`, lines 617-679):
- `libretimeTrackId`: String (LibreTime track ID from API)
- `libretimeFilepathRelative`: String (relative path from LibreTime library root, e.g., `imported/1/Artist/Album/file.mp3`)

**Update Logic**:
- Fetches current episode from Payload
- If already has same `libretimeTrackId` + `libretimeFilepathRelative`, skips update
- PATCHes Payload with new values

### 5.2 Fields Set by `hydrate-archive-paths.ts`

**Payload Episode Fields** (via `hydrateEpisode()`, lines 208-344):
- `hasArchiveFile`: Boolean (set to `true`)
- `archiveFilePath`: String (e.g., `legacy/filename.mp3` or `2025-10/filename.mp3`)
- `libretimeTrackId`: String (optional, if missing and `--check-libretime` enabled)
- `libretimeFilepathRelative`: String (optional, if missing and `--check-libretime` enabled)

**Update Logic**:
- Reads from JSONL log (episode ID + archive path)
- Fetches current episode from Payload
- If `archiveFilePath` already set (and matches), skips (unless `--force`)
- If LibreTime fields missing and `--check-libretime`, queries LT API to hydrate
- PATCHes Payload with archive fields (+ optional LT fields)

### 5.3 Field Dependencies

**Workflow Order**:
1. `import-batch-archives-media.ts` → sets `libretimeTrackId`, `libretimeFilepathRelative`
2. `batch_rsync_hydrate.sh` → creates JSONL log with `archivePath`
3. `hydrate-archive-paths.ts` → sets `hasArchiveFile`, `archiveFilePath` (can backfill LT fields if missing)
4. `cleanup-imported-files.ts` → verifies `hasArchiveFile` + `archiveFilePath` before deletion

**Safety Net**: `hydrate-archive-paths.ts` can hydrate missing LibreTime fields if Step 1 failed (via `--check-libretime`).

---

## 6. CRON READINESS

### 6.1 Steps That Can Run Multiple Times

| Step | Script | Idempotent? | Notes |
|------|--------|-------------|-------|
| Import trigger | `import-batch-archives-media.ts` | ✅ Yes | Skips if files already in LT |
| Hydration | `import-batch-archives-media.ts` | ⚠️ Partial | Skips if Payload already updated, but no graceful exit if LT analyzing |
| Archive transfer | `batch_rsync_hydrate.sh` | ✅ Yes | Re-transfers if file missing (idempotent rsync) |
| Archive hydration | `hydrate-archive-paths.ts` | ✅ Yes | Skips if `archiveFilePath` already set |
| Cleanup | `cleanup-imported-files.ts` | ✅ Yes | Skips if file not found |

### 6.2 Graceful Exit Points

**Current Behavior**:
- ❌ **No graceful exit**: If LibreTime still analyzing, `hydrateAllEpisodes()` marks episodes as failed and exits with error
- ❌ **No timeout handling**: Script waits for LT API calls (10s timeout per call) but no overall "give up and retry later" logic
- ❌ **No state tracking**: Cannot resume from "partially processed" state

**Required for Cron**:
1. **Graceful timeout**: If LT still analyzing after N attempts, exit successfully (not as error) so next cron run continues
2. **Skip already-processed**: Check Payload before processing each episode; skip if already hydrated
3. **Progress logging**: Log which episodes succeeded/failed/skipped for monitoring

**Current Code Gaps**:
- `hydrateAllEpisodes()` (line 708): No timeout, no graceful exit, no skip logic
- `findLibreTimeFileByPrefix()` (line 126): Single API call, no retry, no timeout handling

---

## 7. IMPLEMENTATION OPTIONS

### Option A: Extend `import-batch-archives-media.ts` into Idempotent Job

**Changes Required**:

1. **Add directory CLI arg** (`scripts/import-batch-archives-media.ts`):
   ```typescript
   // In parseArgs(), add:
   } else if (arg.startsWith('--directory=')) {
     options.directory = arg.split('=')[1]
   }
   
   // In importBatchArchives(), replace:
   const directoryPath = options.directory || '/srv/media/tracks'
   ```

2. **Add graceful timeout + skip logic** (`hydrateAllEpisodes()`):
   ```typescript
   // Add options:
   interface HydrateOptions {
     maxAttempts?: number
     skipAlreadyHydrated?: boolean
     gracefulTimeout?: boolean
   }
   
   // In hydrateAllEpisodes(), before processing each episode:
   if (options.skipAlreadyHydrated) {
     const existing = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`)
     if (existing.data.libretimeTrackId && existing.data.libretimeFilepathRelative) {
       console.log(`⏭️  Skipping ${episodeId} (already hydrated)`)
       continue
     }
   }
   
   // Replace findLibreTimeFileByPrefix() with pollLibreTimeFiles() + timeout handling:
   let libretimeData
   try {
     libretimeData = await pollLibreTimeFiles(episodeId, baseUrl, endpointType)
   } catch (error) {
     if (options.gracefulTimeout && error.message.includes('Timeout')) {
       console.log(`⏸️  ${episodeId} still analyzing, will retry next run`)
       continue // Don't fail, let next cron run handle it
     }
     throw error
   }
   ```

3. **Add cleanup directory CLI arg** (`scripts/cleanup-imported-files.ts`):
   ```typescript
   // In parseArgs(), add:
   } else if (arg.startsWith('--directory=')) {
     options.directory = arg.split('=')[1]
   }
   
   // Replace:
   const IMPORTED_DIR = options.directory || '/srv/media/imported/1'
   ```

**Files to Change**:
- `scripts/import-batch-archives-media.ts` (~50 lines changed)
- `scripts/cleanup-imported-files.ts` (~10 lines changed)

**Risk Level**: **Medium**
- **Pros**: Minimal changes, reuses existing polling logic
- **Cons**: Modifies core archive script (risk of breaking existing workflow), adds complexity to single script

---

### Option B: New Wrapper Script (Recommended)

**Changes Required**:

1. **Create `scripts/hydrate-inbox-automation.ts`**:
   ```typescript
   // Orchestrates: import → poll/hydrate → archive → hydrate archive paths → cleanup
   // Accepts: --directory (required), --archive-bucket (default: YYYY-MM)
   // Features:
   //   - Idempotent: skips already-processed episodes
   //   - Graceful timeout: exits successfully if LT still analyzing
   //   - State tracking: logs progress for monitoring
   //   - Calls existing scripts as subprocesses
   ```

2. **Add directory CLI arg to `import-batch-archives-media.ts`** (minimal, backward compatible):
   ```typescript
   // Same as Option A, step 1
   ```

3. **Add directory CLI arg to `cleanup-imported-files.ts`** (minimal, backward compatible):
   ```typescript
   // Same as Option A, step 3
   ```

**Wrapper Script Logic**:
```typescript
async function hydrateInboxAutomation(options: {
  directory: string
  archiveBucket?: string
  maxPollAttempts?: number
  pollTimeout?: number
}) {
  // Step 1: Import (if needed)
  await callImportScript(options.directory)
  
  // Step 2: Poll + Hydrate (with graceful timeout)
  const results = await pollAndHydrate(options.directory, {
    maxAttempts: options.maxPollAttempts || 3,
    timeout: options.pollTimeout || 300000, // 5 min
    skipAlreadyHydrated: true
  })
  
  // Step 3: Archive (only for successfully hydrated episodes)
  if (results.hydrated.length > 0) {
    await callArchiveScript(options.directory, options.archiveBucket)
  }
  
  // Step 4: Hydrate archive paths
  await callHydrateArchivePaths()
  
  // Step 5: Cleanup
  await callCleanupScript(options.directory)
  
  // Exit successfully even if some episodes still analyzing
  return { success: true, pending: results.pending }
}
```

**Files to Change**:
- `scripts/hydrate-inbox-automation.ts` (new file, ~300 lines)
- `scripts/import-batch-archives-media.ts` (~5 lines changed, add `--directory` arg)
- `scripts/cleanup-imported-files.ts` (~5 lines changed, add `--directory` arg)

**Risk Level**: **Low**
- **Pros**: Keeps archive script stable, clear separation of concerns, easier to test/debug
- **Cons**: New file to maintain, requires subprocess orchestration

---

## 8. QUESTIONS & RISKS

### Questions

1. **LibreTime file organization**: After importing from `/srv/media/new`, where does LibreTime place files? Same as `/srv/media/tracks` → `/srv/media/imported/1/`? Or different location?

2. **Cleanup target**: For new automation, should cleanup delete from `/srv/media/new` (original location) or `/srv/media/imported/1/` (LibreTime-organized location)?

3. **Archive bucket strategy**: Should `/srv/media/new` and `/srv/media/live-inbox` use same monthly bucket strategy (`YYYY-MM/`) or separate buckets?

4. **Cron frequency**: User mentioned "1-2x/day" - should script process all files in directory each run, or only new files since last run?

5. **Concurrent execution**: Can script run while archive pipeline is running? Lockfile prevents concurrent bulk imports, but hydration could conflict.

6. **Error handling**: If archive transfer fails for some files, should script continue to hydration step or exit?

7. **Monitoring**: How should "pending" episodes (LT still analyzing) be tracked? Log file? Payload field?

8. **Backward compatibility**: Will adding `--directory` arg break any existing cron jobs or scripts that call `import-batch-archives-media.ts`?

### Risks

1. **Medium**: Modifying `import-batch-archives-media.ts` could break existing archive workflow if not careful with backward compatibility
2. **Low**: Adding polling/timeout logic increases script complexity and potential failure modes
3. **Low**: Subprocess orchestration in wrapper script adds execution overhead and error handling complexity
4. **Low**: Directory flexibility may expose bugs if LibreTime handles `/srv/media/new` differently than `/srv/media/tracks`

---

## 9. RECOMMENDATION

**Recommend Option B (Wrapper Script)** for the following reasons:

1. **Minimal risk**: Keeps archive script stable; only adds backward-compatible CLI args
2. **Clear separation**: New automation logic isolated from archive pipeline
3. **Easier testing**: Can test wrapper independently without affecting archive workflow
4. **Future flexibility**: Easy to add new inbox directories or change orchestration logic

**Implementation Priority**:
1. Add `--directory` arg to `import-batch-archives-media.ts` and `cleanup-imported-files.ts` (backward compatible)
2. Create `hydrate-inbox-automation.ts` wrapper script
3. Test with `/srv/media/new` directory
4. Add cron job: `0 */12 * * *` (every 12 hours)
5. Monitor for 1 week, then add `/srv/media/live-inbox`

---

## 10. DIFFS

**No code changes proposed in audit phase.** Implementation diffs will be provided after option selection.

---

## 11. LOGS

**No logs generated in audit phase.**

