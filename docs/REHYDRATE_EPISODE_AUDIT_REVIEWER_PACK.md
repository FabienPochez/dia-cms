# REHYDRATE EPISODE AUDIT — REVIEWER PACK
**Date:** 2025-10-17  
**Scope:** Read-only inventory of utilities for `rehydrateEpisode(episodeId)` implementation  
**Objective:** KISS implementation to restore working files from archive when LibreTime path exists but local file is missing

---

## 1. SUMMARY (≤10 bullets)

1. **Archive→Working Copy**: No direct rsync reverse utility exists. Must create wrapper using `ssh bx-archive` + `rsync` in pull mode (`bx-archive:/home/archive/<path>` → `/srv/media/<path>`)
2. **rsync_one.sh**: Exists for working→archive (lines 1-161). Can be adapted or called in reverse with swapped src/dest
3. **File Existence Checks**: Use `fs.access()` for local (lines: `cleanup-imported-files.ts:144-149`), `ssh bx-archive "test -f /home/archive/<path>"` for remote (lines: `hydrate-archive-paths.ts:187-188`)
4. **Payload Episode Helpers**: Complete pattern in `hydrate-archive-paths.ts:207-343` for `GET /api/episodes/:id` and `PATCH /api/episodes/:id` with auth
5. **LibreTime Lookup**: `findLibreTimeFileByEpisodeId()` at `hydrate-archive-paths.ts:97-126` searches by prefix, returns track ID + filepath
6. **Path Constants**: Working root `/srv/media` via `LIBRETIME_LIBRARY_ROOT` (scripts use `/srv/media/imported/1` explicitly), Archive root `/home/archive` hardcoded in shell scripts
7. **JSONL Logging**: Format defined at `README.md:557-559` and implemented in `batch_rsync_hydrate.sh:228-244`
8. **mkdir -p**: Shell uses `ssh bx-archive "mkdir -p ..."` (`batch_rsync_hydrate.sh:190`), Node uses `fs.mkdir(dir, {recursive: true})` (`rename-media-in-place.ts:115`)
9. **ffprobe/Technicals**: No existing helper. LibreTime API provides `bit_rate`, `sample_rate`, `length` fields (lines: `libretimeClient.ts:24-26`)
10. **Episode Fields**: `libretimeFilepathRelative`, `archiveFilePath`, `hasArchiveFile`, `bitrate`, `realDuration` confirmed in schema (`Episodes.ts:236-287`, `payload-types.ts:216-243`)

---

## 2. ARTIFACT MAP

| File | Purpose | Key Functions/Sections | Inputs | Outputs | Envs | Side Effects |
|------|---------|----------------------|--------|---------|------|--------------|
| **scripts/sh/archive/rsync_one.sh** | Single-file rsync transfer (working→archive) | Lines 1-161: rsync with retry, SSH test, dry-run | `<local_src>` `<remote_rel_dir>` `--apply` `--retries` `--bwlimit` | Exit 0/1, stdout logs | `RSYNC_RSH` (optional) | Creates remote dir, transfers file |
| **scripts/sh/archive/batch_rsync_hydrate.sh** | Batch transfer + JSONL logging | Lines 196-258: `extract_episode_id()`, `log_success()` (JSONL format) | `<local_dir>` `<remote_dir>` `--apply` `--concurrency` | JSONL log at `/srv/media/logs/rsync-archive-success.jsonl` | None | Creates log dir, appends JSONL |
| **scripts/hydrate-archive-paths.ts** | Hydrate Payload with archive paths | Lines 80-92: `buildPayloadAuthHeaders()`<br>Lines 97-126: `findLibreTimeFileByEpisodeId()`<br>Lines 184-202: `verifyRemoteFile()`<br>Lines 207-343: `hydrateEpisode()` | `--log <jsonl>` `--dry-run` `--verify` `--force` `--check-libretime` | Console logs, Payload updates | `PAYLOAD_API_URL`, `PAYLOAD_API_KEY`, `LIBRETIME_API_URL`, `LIBRETIME_API_KEY` | Updates episodes via PATCH |
| **scripts/cleanup-imported-files.ts** | Delete files after successful archive | Lines 143-149: `glob()` for recursive search<br>Lines 118-131: `verifyPayloadHydration()`<br>Lines 191: `fs.unlink()` | `--log <jsonl>` `--dry-run` `--verify-payload` | Console logs, deleted files | `PAYLOAD_API_URL`, `PAYLOAD_API_KEY` | Deletes files from `/srv/media/imported/1` |
| **src/integrations/libretimeClient.ts** | LibreTime API client | Lines 291-304: `getFiles({q, limit, ...})`<br>Lines 309-311: `getFile(id)`<br>Lines 170-270: `request()` with retries | `LibreTimeClient()` constructor | `LTFile[]`, `LTFile` (with `bit_rate`, `sample_rate`, `length`) | `LIBRETIME_API_URL`, `LIBRETIME_API_KEY` | HTTP calls to LT API |
| **src/lib/services/rehydrateEpisode.ts** | EXISTING LibreTime rehydrate service | Lines 28-140: `rehydrateEpisode(episodeId)` - finds LT track, updates Payload | `episodeId: string` | `RehydrateResult {success, trackId?, relativePath?}` | Via `LibreTimeClient` | Updates `libretimeTrackId`, `libretimeFilepathRelative` |
| **utils/generateEpisodeFilename.ts** | Canonical filename generator | Lines 1-27: `generateEpisodeFilename({id, show, title, episodeNumber})` | Episode metadata | Canonical filename: `{id}__{showSlug}__{titleSlug}__{num}.mp3` | None | None |
| **src/collections/Episodes.ts** | Episode schema definition | Lines 236-260: `libretimeFilepathRelative`, `hasArchiveFile`, `archiveFilePath`<br>Lines 282-287: `bitrate`, `realDuration` | N/A | Schema for Payload | None | None |
| **scripts/rename-media-in-place.ts** | In-place rename + ID3 sanitization | Lines 115: `fs.mkdir(dir, {recursive: true})`<br>Lines 180-206: `quarantineFile()` with mkdir + rename<br>Lines 316: `fs.access()` for conflict check | `--root <dir>` `--dry-run` `--limit` | Renamed files, JSONL log | `PAYLOAD_API_URL`, `PAYLOAD_API_KEY` | Renames files, writes ID3 |

---

## 3. CALL FLOW

### Current Archive Workflow (Steps 2–5)

1. **Import to LibreTime** (`import-batch-archives-media.ts`): Bulk CLI import → poll API → hydrate Payload with `libretimeTrackId` + `libretimeFilepathRelative`
2. **Archive to Hetzner** (`batch_rsync_hydrate.sh`): Rsync `/srv/media/imported/1/**` → `/home/archive/legacy/` (flat), JSONL logging
3. **Hydrate Archive Paths** (`hydrate-archive-paths.ts`): Read JSONL → update Payload with `archiveFilePath` + `hasArchiveFile: true` (optional LT lookup safety net)
4. **Cleanup Local** (`cleanup-imported-files.ts`): Read JSONL → recursively find + delete files from `/srv/media/imported/1`
5. **Verification**: API calls to confirm all fields populated

### Proposed KISS Rehydrate Call Graph

```
rehydrateEpisode(episodeId)
  ├─ a) getEpisode(id) via Payload API
  │    └─ Read: archiveFilePath, libretimeFilepathRelative, bitrate?, realDuration?
  │
  ├─ b) exists(workingPath)?
  │    ├─ YES → { status: 'ok', workingPath, action: 'exists' }
  │    └─ NO  → archivePath exists?
  │         ├─ YES → COPY archive → working
  │         │    ├─ mkdir -p (parent dirs)
  │         │    ├─ rsync pull: bx-archive:/home/archive/<archivePath> → /srv/media/<ltPath>
  │         │    ├─ verify copy (optional: checksum or size)
  │         │    └─ { status: 'copied', workingPath, bytes, duration_ms }
  │         └─ NO  → { status: 'error', code: 'E_ARCHIVE_MISSING' }
  │
  ├─ c) [OPTIONAL] ffprobe → fill bitrate/realDuration if empty
  │    └─ Parse LT API file.bit_rate, file.sample_rate, file.length (already has this)
  │    └─ OR: shell ffprobe -v error -show_entries format=duration,bit_rate
  │
  └─ d) [OPTIONAL] LT register-by-path (if trackId missing but file exists)
       └─ Call findLibreTimeFileByEpisodeId() from hydrate-archive-paths.ts:97-126
       └─ Update Payload if found
```

---

## 4. DATA CONTRACTS & CONSTS

### Episode Fields (Payload Schema)

**Location:** `src/collections/Episodes.ts:236-287`, `src/payload-types.ts:216-243`

```typescript
interface Episode {
  // LibreTime Integration
  libretimeTrackId?: string | null           // Line 228-229
  libretimeFilepathRelative?: string | null  // Line 236-237 (e.g., "imported/1/Artist/Album/file.mp3")
  libretimeInstanceId?: number | null        // Line 262-263
  libretimePlayoutId?: number | null         // Line 270-271
  
  // Archive Integration
  hasArchiveFile?: boolean | null            // Line 245-246
  archiveFilePath?: string | null            // Line 254-255 (e.g., "legacy/file.mp3")
  
  // Technical Metadata
  bitrate?: number | null                    // Line 282 (kbps)
  realDuration?: number | null               // Line 284-287 (seconds)
  
  // (Other fields: title, show, publishedAt, etc.)
}
```

### Path Constants

| Constant | Value | Defined In | Usage |
|----------|-------|------------|-------|
| `LIBRETIME_LIBRARY_ROOT` | `/srv/media` | `scripts/importOneEpisode.ts:90` | Path conversion (absolute → relative) |
| Archive Root | `/home/archive` | Hardcoded in shell scripts | Remote base for rsync |
| Archive Legacy Bucket | `/home/archive/legacy` | `README.md:308-309` | Flat storage for legacy files |
| Working Directory | `/srv/media/imported/1` | `cleanup-imported-files.ts:50` | LibreTime's working directory |
| Log Directory | `/srv/media/logs` | `batch_rsync_hydrate.sh:19` | JSONL log storage |
| Success Log | `/srv/media/logs/rsync-archive-success.jsonl` | `batch_rsync_hydrate.sh:20` | Archive transfer log |

### LibreTime File Type (API Response)

**Location:** `src/integrations/libretimeClient.ts:12-68`

```typescript
interface LTFile {
  id: number
  filepath: string               // Absolute: "/srv/media/imported/1/Artist/Album/file.mp3"
  size: number                   // Bytes
  bit_rate: number              // Bits per second
  sample_rate: number           // Hz
  length: string                // HH:MM:SS.mmm format
  exists: boolean               // File still on disk
  name: string                  // Filename
  // ... 40+ other fields
}
```

### JSONL Log Format (Archive Transfer)

**Location:** `README.md:557-559`, `batch_rsync_hydrate.sh:228-244`

```jsonl
{
  "episodeId": "685e6a57b3ef76e0e25c2557",
  "archivePath": "legacy/685e6a57__tragol-fitness-club__episode-12__012.mp3",
  "bucket": "legacy",
  "filename": "685e6a57__tragol-fitness-club__episode-12__012.mp3",
  "size": 86149711,
  "ts": "2025-10-15T14:30:45.123Z",
  "rsyncExitCode": 0
}
```

### Environment Variables

**Location:** `scripts/hydrate-archive-paths.ts:63-77`, `scripts/importOneEpisode.ts:87-96`

```bash
# Required
LIBRETIME_API_KEY=<key>           # LibreTime API authentication
PAYLOAD_API_KEY=<key>             # Payload REST API key (preferred)
# OR
PAYLOAD_ADMIN_TOKEN=<token>       # Payload JWT fallback

# Optional
PAYLOAD_API_URL=https://content.diaradio.live  # Default shown
LIBRETIME_API_URL=http://api:9001              # Default shown
PAYLOAD_AUTH_SLUG=users                        # Default shown
LIBRETIME_LIBRARY_ROOT=/srv/media              # Default shown
```

### Auth Headers Pattern

**Payload** (`scripts/importOneEpisode.ts:16-32`):
- Prefers: `Authorization: ${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_API_KEY}`
- Falls back to: `Authorization: Bearer ${PAYLOAD_ADMIN_TOKEN}`

**LibreTime** (`src/integrations/libretimeClient.ts:176`):
- Always: `Authorization: Api-Key ${LIBRETIME_API_KEY}`

---

## 5. GAPS

### Missing Utilities (Need to Create)

1. **Reverse rsync wrapper** (`archive → working` direction)
   - Current: `rsync_one.sh` only handles `working → archive`
   - Need: Node.js wrapper to invoke `rsync` in pull mode: `rsync bx-archive:/home/archive/<archivePath> /srv/media/<ltPath>`
   - Can reuse SSH config from `rsync_one.sh:114` (`RSYNC_RSH` export)

2. **Local mkdir -p for working paths**
   - Pattern exists in scripts: `fs.mkdir(dir, {recursive: true})` (line: `rename-media-in-place.ts:115`)
   - Need to ensure parent dirs exist for `/srv/media/imported/1/Artist/Album/` before copy

3. **ffprobe wrapper for duration/bitrate** (optional for KISS)
   - No TypeScript wrapper found (only `ffmpeg` for metadata stripping)
   - LibreTime API already has these fields (`LTFile.bit_rate`, `sample_rate`, `length`)
   - **Recommendation**: Use LT API data instead of ffprobe (simpler, already fetched)

4. **LT register-by-path** (optional for KISS)
   - Exists: `findLibreTimeFileByEpisodeId()` at `hydrate-archive-paths.ts:97-126`
   - Can be reused as-is
   - **Gap**: No "register without import" helper (would require LT bulk_import CLI call)

### Permission/SSH Considerations

1. **Hetzner Storage Box**: Read-only SSH access required for `bx-archive` alias
   - Config at `README.md:287-298` (SSH alias `bx-archive`, port 23)
   - Verified working in current workflow (Step 3 verification shows 700 files on archive)
   - No `chown` possible on Hetzner (noted in `README.md:391`)

2. **Local write permissions**: Script must run as user with write access to `/srv/media/imported/1`
   - Current scripts run in `payload-dev-scripts-1` container
   - Verified: cleanup script successfully writes to this path (Step 5 completed)

3. **rsync direction**: Pull mode (archive→working) may have different performance characteristics
   - Current workflow uses push mode (working→archive) with `--partial --inplace` flags
   - Same flags recommended for pull: `rsync -avh --progress --partial --inplace`

---

## 6. PROPOSAL (NO CODE)

### Minimal Files to Add

#### **1. `scripts/lifecycle/rehydrateEpisode.ts`** (Helper + CLI)

**Purpose:** Core rehydration logic callable from CLI or API

**Exports:**
```typescript
export interface RehydrateResult {
  episodeId: string
  status: 'ok' | 'copied' | 'error'
  action: 'exists' | 'copied_from_archive' | 'missing'
  workingPath: string
  bytes?: number
  duration_ms?: number
  ltTrackId?: number
  error?: RehydrateError
}

export enum RehydrateError {
  E_EPISODE_NOT_FOUND = 'episode_not_found',
  E_WORKING_MISSING = 'working_file_missing',
  E_ARCHIVE_MISSING = 'archive_file_missing', 
  E_METADATA_INCONSISTENT = 'metadata_inconsistent',  // Both paths missing
  E_COPY_FAILED = 'copy_failed',
  E_VERIFY_FAILED = 'verify_failed'
}

export async function rehydrateEpisode(
  episodeId: string,
  options?: { verify?: boolean; dryRun?: boolean }
): Promise<RehydrateResult>
```

**Logic Flow:**
1. `GET /api/episodes/:id` → extract `libretimeFilepathRelative`, `archiveFilePath`
2. Validate: both paths must exist, else `E_METADATA_INCONSISTENT`
3. Check local: `await fs.access(/srv/media/<libretimeFilepathRelative>)`
   - If exists → return `{status: 'ok', action: 'exists', workingPath}`
4. Check archive: `ssh bx-archive "test -f /home/archive/<archiveFilePath>"`
   - If missing → return `{status: 'error', error: E_ARCHIVE_MISSING}`
5. Ensure parent dirs: `fs.mkdir(path.dirname(workingPath), {recursive: true})`
6. Copy: `rsync -avh --partial --inplace bx-archive:/home/archive/<archivePath> /srv/media/<ltPath>`
7. Verify (if `options.verify`): Compare sizes or checksums
8. Return `{status: 'copied', action: 'copied_from_archive', workingPath, bytes, duration_ms}`

**CLI Wrapper:**
```bash
npx tsx scripts/lifecycle/rehydrateEpisode.ts --episodeId <id> [--dry-run] [--verify]
```

#### **2. `api/lifecycle/rehydrate.ts`** (API Endpoint - Optional)

**Purpose:** Staff/admin UI endpoint for on-demand rehydration

**Route:** `POST /api/lifecycle/rehydrate`

**Auth:** Staff/admin role required

**Request Body:**
```typescript
{ episodeId: string, verify?: boolean }
```

**Response:**
```typescript
{ 
  success: boolean,
  result?: RehydrateResult,
  error?: string 
}
```

**Calls:** `rehydrateEpisode()` helper from (1)

### Return Shape (Detailed)

```typescript
// Success - file already exists
{
  episodeId: "685e6a54b3ef76e0e25c1921",
  status: "ok",
  action: "exists",
  workingPath: "imported/1/685e6a54b3ef76e0e25c1921__strange-how-you-move__.mp3",
  ltTrackId: 988
}

// Success - copied from archive
{
  episodeId: "685e6a54b3ef76e0e25c1921",
  status: "copied",
  action: "copied_from_archive",
  workingPath: "imported/1/685e6a54b3ef76e0e25c1921__strange-how-you-move__.mp3",
  bytes: 145960000,
  duration_ms: 27340,
  ltTrackId: 988
}

// Error - archive file missing
{
  episodeId: "685e6a54b3ef76e0e25c1921",
  status: "error",
  action: "missing",
  error: "E_ARCHIVE_MISSING",
  workingPath: "imported/1/685e6a54b3ef76e0e25c1921__strange-how-you-move__.mp3"
}
```

### Error Taxonomy

| Code | Meaning | Resolution |
|------|---------|------------|
| `E_EPISODE_NOT_FOUND` | Episode ID not in Payload | Check episode exists |
| `E_METADATA_INCONSISTENT` | Both `libretimeFilepathRelative` and `archiveFilePath` missing | Run import workflow first |
| `E_WORKING_MISSING` | Local file missing (expected, triggers copy) | Normal case for rehydration |
| `E_ARCHIVE_MISSING` | Archive file not found on Hetzner | **Critical**: File lost, needs re-upload from source |
| `E_COPY_FAILED` | Rsync transfer failed | Check SSH, disk space, permissions |
| `E_VERIFY_FAILED` | Copied file size/checksum mismatch | Re-run copy, check network |

### Log Lines to Reuse

**From `hydrate-archive-paths.ts:100-120`:**
```typescript
console.log(`🔍 Searching LibreTime for episode: ${episodeId}`)
console.log(`✅ Found LibreTime track: ID ${trackId}`)
console.log(`⚠️  No LibreTime track found for episode ${episodeId}`)
```

**From `cleanup-imported-files.ts:192, 183`:**
```typescript
console.log(`🗑️  Deleted: ${filename}`)
console.log(`🔍 DRY-RUN: Would delete ${filename}`)
```

**Proposed New:**
```typescript
console.log(`🔍 Checking working file: ${workingPath}`)
console.log(`✅ Working file exists (no copy needed)`)
console.log(`📥 Copying from archive: ${archivePath} → ${workingPath}`)
console.log(`✅ Copy completed: ${bytes} bytes in ${duration_ms}ms`)
console.log(`❌ Archive file not found: ${archivePath}`)
```

---

## 7. QUESTIONS & RISKS

### Questions

1. **Subdirectory Handling**: LibreTime creates `imported/1/Artist/Album/file.mp3` structure. Do we preserve this on copy or flatten?
   - **Answer from audit**: Preserve full `libretimeFilepathRelative` path (including Artist/Album subdirs)
   - Evidence: `README.md:493` confirms both paths stored in Payload

2. **Overwrite Policy**: If working file exists but is corrupted, should `--force` flag allow re-copy?
   - **Recommendation**: No overwrite in KISS v1. Return `{status: 'ok', action: 'exists'}` even if corrupted
   - Future: Add `--force` flag + checksum verification

3. **Concurrency**: Can multiple rehydrate calls run simultaneously?
   - **Risk**: rsync to same file may conflict
   - **Mitigation**: Add per-episode lockfile pattern (see `import-batch-archives-media.ts:371-384` for lock example)

4. **Bandwidth Limits**: Should rehydrate respect `--bwlimit` for production use?
   - **Recommendation**: Not needed for KISS (single-file ops). Add if batching later

### Risks

1. **Archive File Missing** (`E_ARCHIVE_MISSING`):
   - **Impact**: Cannot restore, episode unplayable
   - **Mitigation**: This is a critical data loss scenario. Requires manual re-upload from original source
   - **Detection**: Workflow Step 3 verification confirms 700 files on archive (as of today)

2. **SSH Key Expiry/Permissions**:
   - **Impact**: Cannot connect to `bx-archive`, all rehydrate ops fail
   - **Mitigation**: Test connection before batch ops (pattern: `rsync_one.sh:117-122`)
   - **Monitoring**: Log `E_COPY_FAILED` errors separately for ops team

3. **Disk Space Exhaustion** (`/srv/media/imported/1` fills up):
   - **Impact**: Copy fails mid-transfer, partial files left
   - **Mitigation**: Use rsync `--partial` flag (already in `rsync_one.sh:134`), verify disk space before copy
   - **Cleanup**: Partial files auto-resume on retry

4. **LibreTime Path Changed** (file moved/renamed in LT):
   - **Impact**: `libretimeFilepathRelative` stale, file copied to wrong path
   - **Detection**: Optional Step 4c (LT lookup) catches this
   - **Mitigation**: Run `findLibreTimeFileByEpisodeId()` to confirm path before copy

5. **Network Interruption During Copy**:
   - **Impact**: Partial file, episode unplayable
   - **Mitigation**: Rsync retry logic (pattern: `rsync_one.sh:144-161`, exponential backoff)
   - **Verification**: Size check after copy (`stat -c%s` on both files)

6. **Metadata Drift** (bitrate/duration empty):
   - **Impact**: Planner UI shows "unknown duration"
   - **Risk Level**: Low (cosmetic)
   - **Fix**: Optional Step 4c fetches from LT API (no ffprobe needed)

7. **Concurrent Access** (LibreTime reading file during copy):
   - **Impact**: Playback glitches if file being overwritten
   - **Mitigation**: Use rsync `--inplace` flag (atomic-ish writes)
   - **Better**: Check LT schedule before copy, warn if file is scheduled within next hour

8. **Permissions Mismatch** (copied file owned by wrong user):
   - **Impact**: LibreTime can't read file (permission denied)
   - **Mitigation**: Match existing file ownership in `/srv/media/imported/1` (check with `stat`)
   - **Solution**: `chown` after copy or run script as LibreTime user

---

## 8. REUSABLE HELPERS (Exact Locations)

### SSH/Rsync Invocation

```typescript
// From: scripts/hydrate-archive-paths.ts:14, 24, 187-188
import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

// Check remote file exists
const command = `ssh bx-archive "test -f /home/archive/${archivePath} && echo 'exists'"`
const { stdout } = await execAsync(command, { timeout: 10000 })
const exists = stdout.trim() === 'exists'
```

```bash
# Reverse rsync (pull from archive)
rsync -avh --progress --partial --inplace \
  bx-archive:/home/archive/legacy/file.mp3 \
  /srv/media/imported/1/Artist/Album/file.mp3

# With SSH options (from rsync_one.sh:114)
export RSYNC_RSH="ssh -p 23 -o Compression=no -o ControlMaster=auto \
  -o ControlPath=~/.ssh/cm-%r@%h:%p -o ControlPersist=60 -c aes128-gcm@openssh.com"
```

### Payload Episode Fetch/Update

```typescript
// From: scripts/hydrate-archive-paths.ts:80-84, 227-313
import axios from 'axios'

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'https://content.diaradio.live'
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY

function buildPayloadAuthHeaders() {
  return {
    Authorization: `JWT ${PAYLOAD_API_KEY}`,  // Note: Pattern varies, see line 16-32 in importOneEpisode.ts
    'Content-Type': 'application/json',
  }
}

// Fetch episode
const response = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
  headers: buildPayloadAuthHeaders(),
  timeout: 10000,
})
const episode = response.data

// Update episode
await axios.patch(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
  hasArchiveFile: true,
  archiveFilePath: 'legacy/file.mp3',
  // Optional: bitrate, realDuration if probed
}, {
  headers: buildPayloadAuthHeaders(),
  timeout: 10000,
})
```

### LibreTime File Lookup

```typescript
// From: scripts/hydrate-archive-paths.ts:97-126
async function findLibreTimeFileByEpisodeId(episodeId: string): Promise<{id: number, filepath: string} | null> {
  const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://api:9001'
  const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY
  
  const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files?search=${episodeId}__`, {
    headers: {
      Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  })
  
  const files = response.data
  const matchingFiles = files.filter((file) => {
    const filename = (file.filepath || file.name || '').split('/').pop() || ''
    return filename.startsWith(`${episodeId}__`)
  })
  
  return matchingFiles.length > 0 ? matchingFiles[0] : null
}
```

### Path Conversion

```typescript
// From: scripts/hydrate-archive-paths.ts:131-136
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'

function getRelativeLibreTimePath(absolutePath: string): string {
  if (absolutePath.startsWith(LIBRETIME_LIBRARY_ROOT)) {
    return path.relative(LIBRETIME_LIBRARY_ROOT, absolutePath)
  }
  return absolutePath
}

// Inverse: relative → absolute
function getAbsoluteWorkingPath(relativePath: string): string {
  return path.join(LIBRETIME_LIBRARY_ROOT, relativePath)
}
```

### Directory Creation

```typescript
// From: scripts/rename-media-in-place.ts:115
import fs from 'fs/promises'
import path from 'path'

// Ensure parent directories exist
await fs.mkdir(path.dirname(targetPath), { recursive: true })
```

### File Existence Checks

```typescript
// From: scripts/rename-media-in-place.ts:191-194
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
```

### Get File Size

```typescript
// From: scripts/cleanup-imported-files.ts:167, batch_rsync_hydrate.sh:216-226
const stats = await fs.stat(filePath)
const bytes = stats.size
```

### JSONL Logging Pattern

```typescript
// From: scripts/rename-media-in-place.ts:110-120
async function logEntry(entry: any): Promise<void> {
  const logDir = '/srv/media/logs'
  const logFile = path.join(logDir, 'rehydrate-operations.jsonl')
  
  try {
    await fs.mkdir(logDir, { recursive: true })
    await fs.appendFile(logFile, JSON.stringify(entry) + '\n')
  } catch (error) {
    console.warn(`⚠️ Failed to write log: ${error.message}`)
  }
}

// Log entry format
{
  episodeId: string,
  status: 'ok' | 'copied' | 'error',
  workingPath: string,
  archivePath: string,
  bytes?: number,
  duration_ms?: number,
  ts: string,  // ISO timestamp
  error?: string
}
```

---

## 9. IMPLEMENTATION ESTIMATE

**Time:** ~30-45 minutes of coding + 15 minutes testing = **1 hour total**

**Breakdown:**
1. Create `scripts/lifecycle/rehydrateEpisode.ts`:
   - Copy `hydrate-archive-paths.ts` skeleton (auth, Payload fetch)
   - Add rsync wrapper function (~15 lines)
   - Add path validation + exists checks (~20 lines)
   - Add CLI arg parsing (~10 lines)
   - **Total:** ~100 lines, **30 min**

2. Create reverse rsync helper function:
   - Adapt `rsync_one.sh` logic to TypeScript
   - Use `execAsync()` pattern from existing scripts
   - Add retry logic (copy from `rsync_one.sh:144-161`)
   - **Total:** ~40 lines, **15 min**

3. Testing:
   - Pick episode with `libretimeFilepathRelative` set
   - Delete local file manually
   - Run rehydrate, verify copy
   - **Total:** **15 min**

**Dependencies:** Zero new npm packages (uses `fs/promises`, `child_process`, `axios` already in project)

**Lines of Code:** ~140 lines total

---

## 10. ANCHOR POINTS (Exact File:Lines)

For implementation, copy these exact patterns:

1. **Payload Auth Headers**: `scripts/importOneEpisode.ts:16-32`
2. **LibreTime API Search**: `scripts/hydrate-archive-paths.ts:97-126`
3. **Remote File Verification**: `scripts/hydrate-archive-paths.ts:184-202`
4. **Payload Episode Update**: `scripts/hydrate-archive-paths.ts:207-343`
5. **SSH Test Pattern**: `scripts/sh/archive/rsync_one.sh:117-122`
6. **Rsync Command Build**: `scripts/sh/archive/rsync_one.sh:134-141`
7. **Retry Logic**: `scripts/sh/archive/rsync_one.sh:144-161`
8. **mkdir -p Pattern**: `scripts/rename-media-in-place.ts:115`
9. **File Exists Check**: `scripts/rename-media-in-place.ts:191-194`
10. **JSONL Append**: `scripts/rename-media-in-place.ts:110-120`

---

## 11. OUT OF SCOPE (Explicitly Not Doing)

- ❌ Path derivation (rely on existing `libretimeFilepathRelative`)
- ❌ LibreTime import/upload (files already in LT)
- ❌ Archive deletes (archive is append-only backup)
- ❌ ID3 metadata modification (files already sanitized in Step 1)
- ❌ Batch rehydration CLI (KISS: single-episode only)
- ❌ Quarantine system (not needed for copy ops)
- ❌ Filename validation (trust Payload data)

---

## 12. SAFETY CHECKLIST

Before running rehydrate:

- [ ] Episode has `libretimeFilepathRelative` set (planner precondition)
- [ ] Archive file verified on Hetzner: `ssh bx-archive "ls /home/archive/<archivePath>"`
- [ ] Disk space available: `df -h /srv/media` shows >10GB free
- [ ] SSH connection works: `ssh bx-archive "pwd"`
- [ ] Episode not currently scheduled in LibreTime (optional check to avoid playback glitches)

After rehydrate:

- [ ] File exists locally: `ls -lh /srv/media/<libretimeFilepathRelative>`
- [ ] Size matches archive: Compare `stat -c%s` on both
- [ ] LibreTime can read file: Check `LTFile.exists` via API
- [ ] Optional: Test playback in LibreTime UI

---

## END AUDIT

**Next Step:** Implement `scripts/lifecycle/rehydrateEpisode.ts` using patterns from sections 8 and 10.

**Estimated Total Implementation Time:** 1 hour (coding + testing)

**Dependencies:** None (all utilities exist or can be trivially adapted)

