# Inbox Hydration Script Implementation Review

**Date:** 2025-12-19  
**Status:** ⚠️ Blocked - Multiple Technical Issues  
**Script:** `scripts/hydrate-inbox-lt.ts`

---

## EXECUTIVE SUMMARY

Attempted to create an inbox hydration script that imports host-uploaded audio files from `/srv/media/new` into LibreTime and hydrates Payload episodes. Encountered multiple technical blockers related to:

1. **LibreTime API Upload Methods** - HTTP upload endpoints have compatibility issues
2. **Docker Container Execution Context** - Script needs Docker socket access for `bulk_import` but jobs container doesn't have it
3. **Network Configuration** - Internal vs external URL resolution and Cloudflare blocking
4. **LibreTime Legacy Container** - PHP-FPM service not responding after config changes

**Current State:** Script is functionally complete but cannot successfully import files to LibreTime due to the above blockers.

---

## IMPLEMENTATION ATTEMPTS

### Attempt 1: HTTP Upload via `/rest/media` (Legacy Endpoint)

**What We Tried:**
- Upload files via `POST /rest/media` using basic auth
- Use internal network URL (`http://nginx:8080`) to bypass Cloudflare

**Result:**
- ✅ Initial upload returned `201 Created` 
- ❌ File never appeared in LibreTime (no analysis occurred)
- ❌ Subsequent attempts return `502 Bad Gateway`

**Error Details:**
```
502 Server Error: Bad Gateway for url: http://nginx:8080/rest/media
nginx error: connect() failed (111: Connection refused) while connecting to upstream
upstream: "fastcgi://172.19.0.7:9000"
```

**Root Cause:** Nginx cannot connect to PHP-FPM in `libretime-legacy-1` container. The legacy container's PHP-FPM service appears to not be responding properly.

---

### Attempt 2: HTTP Upload via `/api/v2/files` (V2 API)

**What We Tried:**
- Upload files via `POST /api/v2/files` using API key auth
- Use internal network URL (`http://nginx:8080`)
- Same approach as `importOneEpisode.ts` and `importBatchEpisodes.ts` (just file + creator)

**Result:**
- ❌ Returns `400 Bad Request` requiring additional fields

**Error Details:**
```json
{
  "size": ["This field is required."],
  "mime": ["This field is required."],
  "accessed": ["This field is required."],
  "name": ["This field is required."]
}
```

**Root Cause:** V2 API endpoint requires explicit metadata fields that we're not providing. However, **other scripts (`importOneEpisode.ts`, `importBatchEpisodes.ts`) use the exact same approach** (just `file` + `creator` fields), suggesting either:
- The v2 API behavior changed recently
- There's a difference in how FormData is being sent
- These other scripts may also be failing (need to verify if they're actually working)

---

### Attempt 3: `bulk_import` via `docker exec` (Like Archive Script)

**What We Tried:**
- Use `docker exec libretime-api-1 libretime-api bulk_import` (same as archive script)
- Toggle LibreTime config to internal URL before import
- Run from host (not container)

**Result:**
- ❌ When run from jobs container: `docker: not found` (no Docker socket access)
- ❌ When run from host: `502 Bad Gateway` (same PHP-FPM issue)
- ❌ When config toggled to internal URL: `502 Bad Gateway` persists

**Error Details:**
```
502 Server Error: Bad Gateway for url: http://nginx:8080/rest/media
```

**Root Cause:** 
1. Jobs container doesn't have Docker socket mounted (security design - intentional)
2. Even when run from host, `bulk_import` still tries to upload via HTTP to `/rest/media`, hitting the same PHP-FPM issue

---

## TECHNICAL BLOCKERS

### Blocker 1: LibreTime Legacy Container PHP-FPM Not Responding

**Symptom:** 
- Nginx returns `502 Bad Gateway` when trying to proxy to PHP-FPM
- Error: `connect() failed (111: Connection refused) while connecting to upstream fastcgi://172.19.0.7:9000`

**Investigation:**
- Legacy container is running (`Up 50 seconds` after restart)
- Container health check may not be catching PHP-FPM readiness
- Network connectivity exists (containers can resolve each other)

**Possible Causes:**
1. PHP-FPM not fully started after container restart
2. PHP-FPM configuration issue preventing it from binding/listening
3. Network/firewall issue between nginx and legacy containers
4. LibreTime config change broke PHP-FPM startup

**Impact:** Blocks all HTTP-based upload methods (`/rest/media` endpoint)

---

### Blocker 2: V2 API Requires Additional Metadata Fields

**Symptom:**
- `POST /api/v2/files` returns `400 Bad Request`
- Requires: `size`, `mime`, `accessed`, `name` fields

**Investigation:**
- V2 API expects structured metadata, not just file upload
- Other scripts use `/rest/media` (legacy) which doesn't require these fields
- FormData file upload alone is insufficient

**Possible Solutions:**
1. Extract file metadata (size, mime type) and include in request
2. Use different endpoint or request format
3. Stick with legacy `/rest/media` endpoint (but fix PHP-FPM issue)

---

### Blocker 3: Docker Socket Access Required for `bulk_import`

**Symptom:**
- Script needs to run `docker exec` to call `bulk_import`
- Jobs container doesn't have Docker socket mounted (security design)

**Current Architecture:**
- Jobs container: Ephemeral, no docker.sock access (secure)
- Archive script: Runs from host, has docker.sock access
- Inbox script: Needs same access but wants to run from jobs container

**Possible Solutions:**
1. Run script from host (requires Node.js on host)
2. Mount docker.sock in jobs container (security risk - not recommended)
3. Create host-level wrapper script that jobs container calls
4. Use HTTP upload instead (but blocked by Blocker 1)

---

### Blocker 4: LibreTime Config Toggle Breaks Services

**Symptom:**
- When toggling `public_url` from public to internal, services restart
- After restart, PHP-FPM connection fails
- Services may not be fully ready when `bulk_import` runs

**Investigation:**
- Config toggle script restarts: `api`, `analyzer`, `legacy` containers
- Restart causes temporary service unavailability
- `bulk_import` runs immediately after restart, before services are ready

**Possible Solutions:**
1. Add health checks/wait logic after container restart
2. Don't toggle config - find another way to use internal URL
3. Use public URL and accept Cloudflare limitations (not ideal for large files)

---

## COMPARISON WITH ARCHIVE SCRIPT

### Archive Script (`import-batch-archives-media.ts`)

**How It Works:**
1. Runs from **host** (not container)
2. Uses `docker exec libretime-api-1 libretime-api bulk_import`
3. Sets `LIBRETIME_PUBLIC_URL=http://nginx:8080` env var
4. Processes files in `/srv/media/tracks` directory
5. **Does NOT use HTTP upload at all** - uses CLI `bulk_import` exclusively

**Key Differences:**
- ✅ Runs from host (has Docker access)
- ✅ Uses `bulk_import` CLI command (bypasses HTTP upload entirely)
- ✅ Same internal URL approach
- ✅ **No HTTP API calls for upload** - `bulk_import` handles file processing internally

**Why It Works:**
- `bulk_import` CLI command processes files directly in the LibreTime container
- Doesn't rely on HTTP endpoints (`/rest/media` or `/api/v2/files`)
- Bypasses PHP-FPM and nginx proxy issues
- Processes files from filesystem directly

**Important Finding:** The archive script **never uses HTTP upload** - it uses `bulk_import` CLI exclusively. This is why it works while HTTP upload methods fail.

---

## CURRENT SCRIPT STATE

### What Works ✅

1. **File Discovery** - Correctly scans `/srv/media/new` and extracts episode IDs
2. **Payload API** - Successfully fetches episodes and filters eligible ones
3. **LibreTime API Search** - Can query LibreTime files API (v2 endpoint works)
4. **URL Resolution** - Correctly resolves internal URLs when in Docker
5. **Docker Detection** - Properly detects container vs host execution
6. **Error Handling** - Comprehensive error messages and logging
7. **Polling Logic** - Polls LibreTime until files appear (ready to use once upload works)

### What Doesn't Work ❌

1. **File Upload** - All upload methods fail:
   - `/rest/media`: 502 Bad Gateway (PHP-FPM not responding)
   - `/api/v2/files`: 400 Bad Request (missing required fields)
   - `bulk_import`: Requires Docker socket (not available in jobs container)

2. **Host Execution** - Host doesn't have Node.js installed
   - Can't run `npx tsx` from host
   - Would need Node.js installation or wrapper script

---

## POTENTIAL SOLUTIONS

### Solution A: Fix LibreTime Legacy Container

**Approach:**
1. Investigate why PHP-FPM isn't responding in legacy container
2. Check PHP-FPM configuration and logs
3. Verify network connectivity between nginx and legacy containers
4. Ensure proper startup sequence/health checks

**Pros:**
- Fixes root cause
- Enables HTTP upload methods
- Benefits other scripts too

**Cons:**
- Requires LibreTime infrastructure debugging
- May be a deeper configuration issue

---

### Solution B: Use Direct File Copy Instead of HTTP Upload

**Approach:**
1. Copy files directly to LibreTime library directory (`/srv/media/imported/1`)
2. Trigger LibreTime analysis via API or database update
3. Skip HTTP upload entirely

**Pros:**
- Bypasses HTTP upload issues
- Works from container (no Docker socket needed)
- Faster for large files

**Cons:**
- Need to understand LibreTime's file processing pipeline
- May need to manually trigger analysis
- Less "official" than using LibreTime APIs

---

### Solution C: Host-Level Wrapper Script

**Approach:**
1. Create shell wrapper script on host that calls `bulk_import`
2. Jobs container calls wrapper script via `execAsync`
3. Wrapper handles Docker exec and config toggling

**Pros:**
- Keeps jobs container secure (no docker.sock)
- Reuses proven `bulk_import` approach
- Matches archive script pattern

**Cons:**
- Still blocked by PHP-FPM issue
- Adds complexity (two scripts to maintain)
- Requires host-level script permissions

---

### Solution D: Install Node.js on Host

**Approach:**
1. Install Node.js/npm on host system
2. Run inbox hydration script directly from host
3. Script has Docker socket access for `bulk_import`

**Pros:**
- Simplest solution
- Matches archive script execution model
- Full Docker access

**Cons:**
- Requires host system changes
- May conflict with containerized approach
- Still blocked by PHP-FPM issue

---

### Solution E: Provide Required Fields to V2 API

**Approach:**
1. Extract file metadata (size, mime type, name)
2. Include all required fields in V2 API request
3. Use `/api/v2/files` endpoint with complete metadata

**Pros:**
- Uses modern V2 API
- Works from container (no Docker needed)
- Internal network URL works

**Cons:**
- Need to figure out correct field format
- `accessed` field format unclear
- May have other hidden requirements
- **Note:** Other scripts (`importOneEpisode.ts`, `importBatchEpisodes.ts`) use same simple approach (file + creator) - need to verify if they actually work or also fail

### Solution F: Use `bulk_import` CLI Like Archive Script (RECOMMENDED)

**Approach:**
1. Run script from host (like archive script)
2. Use `docker exec libretime-api-1 libretime-api bulk_import`
3. Bypass HTTP upload entirely
4. Let `bulk_import` handle file processing internally

**Pros:**
- ✅ Proven to work (archive script uses this)
- ✅ Bypasses all HTTP upload issues
- ✅ No PHP-FPM dependency
- ✅ Handles file processing internally
- ✅ Same pattern as existing working script

**Cons:**
- Requires running from host (not container)
- Requires Docker socket access
- Need Node.js on host OR wrapper script approach

---

## RECOMMENDATIONS

### Immediate Next Steps

1. **Use `bulk_import` CLI Approach** (Highest Priority - RECOMMENDED)
   - Follow archive script pattern exactly
   - Run from host using `docker exec libretime-api-1 libretime-api bulk_import`
   - This bypasses all HTTP upload issues
   - Requires: Node.js on host OR host-level wrapper script

2. **Verify Other Scripts Using V2 API**
   - Test `importOneEpisode.ts` and `importBatchEpisodes.ts` to see if they actually work
   - If they also fail with 400, then v2 API may have changed
   - If they work, compare exact request format/headers

3. **Investigate PHP-FPM Issue** (If HTTP upload is still needed)
   - Check `libretime-legacy-1` container logs
   - Verify PHP-FPM is running: `docker exec libretime-legacy-1 ps aux | grep php-fpm`
   - Check PHP-FPM configuration and socket binding
   - Test direct connection: `docker exec libretime-nginx-1 curl http://libretime-legacy-1:8080/rest/media`

### Long-Term Considerations

1. **Architecture Decision**
   - Should inbox hydration run from host or container?
   - If container: How to handle Docker socket requirement?
   - If host: How to handle Node.js dependency?

2. **LibreTime Infrastructure**
   - Is PHP-FPM issue a one-time problem or systemic?
   - Do we need better health checks for legacy container?
   - Should we document LibreTime service dependencies?

3. **Alternative Upload Methods**
   - Is direct file copy + analysis trigger viable?
   - Can we use LibreTime's internal file processing without HTTP?
   - Are there other import endpoints we haven't tried?

---

## FILES MODIFIED

- `/srv/payload/scripts/hydrate-inbox-lt.ts` - Main script (complete but blocked)
- `/srv/libretime/config.yml` - Toggled between public/internal URL (restored to public)

---

## TEST RESULTS

### Successful Operations ✅
- File discovery: 7 files found, 7 episode IDs extracted
- Payload API: 7 episodes fetched, 1 eligible episode identified
- LibreTime API search: Can query files API successfully
- URL resolution: Correctly uses `http://nginx:8080` when in Docker
- Docker detection: Correctly identifies container execution

### Failed Operations ❌
- HTTP upload via `/rest/media`: 502 Bad Gateway
- HTTP upload via `/api/v2/files`: 400 Bad Request (missing fields)
- `bulk_import` from container: Docker not found
- `bulk_import` from host: 502 Bad Gateway (same PHP-FPM issue)

---

## QUESTIONS FOR REVIEW

1. **LibreTime Infrastructure:**
   - Is the PHP-FPM 502 error a known issue?
   - Should legacy container be restarted/reconfigured?
   - Are there health checks we should wait for?

2. **Execution Model:**
   - Should inbox hydration run from host (like archive script)?
   - Or should we find a container-compatible solution?
   - Is installing Node.js on host acceptable?

3. **Upload Method:**
   - Is fixing PHP-FPM the right approach?
   - Or should we explore direct file copy?
   - Are there other LibreTime import methods we haven't tried?

4. **Archive Script Status:**
   - Does archive import script currently work?
   - Has it been tested recently?
   - Does it also hit the 502 error?

---

## APPENDIX: Error Logs

### 502 Bad Gateway (PHP-FPM)
```
nginx error: connect() failed (111: Connection refused) while connecting to upstream
upstream: "fastcgi://172.19.0.7:9000"
```

### 400 Bad Request (V2 API)
```json
{
  "size": ["This field is required."],
  "mime": ["This field is required."],
  "accessed": ["This field is required."],
  "name": ["This field is required."]
}
```

### Docker Not Found
```
/bin/sh: docker: not found
```

---

**Next Steps:** Review with Chad to determine:
1. Priority of fixing PHP-FPM vs alternative approaches
2. Preferred execution model (host vs container)
3. Whether to proceed with direct file copy approach

