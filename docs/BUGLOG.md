## Bug Log

### 2025-12-18 – Stream delay: 33-minute lag due to LibreTime hourly boundary bug
- **When:** 2025-12-18 ~13:00-14:33 UTC
- **Impact:** Stream delayed by 33 minutes, wrong show playing at scheduled time
- **Symptoms:**
  - "Le Son de la Méduse #04" scheduled 13:00-14:00 UTC did not start at 13:00
  - "Haircut 2000 #4 - Marcello" scheduled 14:00-15:00 UTC did not start at 14:00
  - Stream was playing "Le Son de la Méduse" when "Haircut 2000" should have been playing
  - Haircut 2000 finally started at ~14:33 UTC (33 minutes late)
- **Evidence:**
  - LibreTime playout logs show classic hourly boundary bug pattern:
    - `13:00:00 - "waiting 3599.995769s until next scheduled item"` (waiting for 14:00 instead of playing 13:00-14:00 show)
    - `14:00:00 - "waiting 3599.9958s until next scheduled item"` (waiting for 15:00 instead of playing 14:00-15:00 show)
  - Stream delay calculated: 33 minutes (1994 seconds)
  - Current time: 14:33 UTC, scheduled start: 14:00 UTC
- **Root cause (confirmed):**
  - LibreTime playout hourly boundary bug (documented in `STREAM_HEALTH_MONITORING.md`)
  - Playout fails to recognize that "now" falls within a scheduled show window at hourly boundaries
  - Calculates "next show" incorrectly and waits for the wrong time
  - Typically causes 2-3 minute delays, but this instance caused 33-minute delay (longer than usual)
  - Stream eventually self-recovers but with significant delay
- **Workaround applied:**
  - Restarted playout and liquidsoap services at 14:34 UTC to force immediate catch-up
  - Stream resumed correct schedule after restart
  - **Note:** This is a temporary workaround, not a fix. The underlying LibreTime bug remains.
- **Recurrence (15:00 UTC / 16:00 Paris):**
  - Bug recurred immediately at next hourly boundary (15:00 UTC)
  - "Lobster radio w/ Gencives #06" scheduled 15:00-16:00 UTC did not start at 15:00
  - Playout logs: `15:00:00 - "waiting 3599.996702s until next scheduled item"` (waiting for 16:00 instead of playing 15:00-16:00 show)
  - Deterministic feed was correct (showed Lobster radio as first item), but LibreTime playout still failed to recognize current show
  - Restarted again at 15:02 UTC to catch up
  - **This confirms restarting is not a fix - bug persists and recurs at every hourly boundary**
- **Prevention:**
  - Stream health check script (`scripts/stream-health-check.sh`) should detect this but may not be running or may have missed it
  - Health check typically detects delays >60 seconds and triggers restarts
  - This incident suggests health check may need tuning or was not active
  - The 33-minute delay is much longer than typical 2-3 minute delays, suggesting playout got stuck longer than usual
- **Fix (needed):**
  - **CRITICAL FINDING:** A queue.py patch was documented in CHANGELOG (Nov 6, 2025) but **never actually applied or was removed**
  - Documentation says patch exists at `/srv/libretime/patches/queue.py` with docker-compose mount `./patches/queue.py:/src/libretime_playout/player/queue.py:ro`
  - **Reality:** Patch file does NOT exist, docker-compose.yml does NOT have the mount
  - Patch was supposed to filter stale/past events before rebuilding schedule_deque to prevent "waiting 3599s" bug
  - **Action needed:** Recreate and apply the queue.py patch as documented in `LIBRETIME_HOUR_BOUNDARY_BUG_FORENSICS.md`
  - Improve stream health check detection and response time
  - Consider automatic restart triggers when delays exceed threshold
- **Status:** Open – 2025-12-18 (workaround applied, bug recurs at every hourly boundary, documented fix was never applied)
- **Testing (2025-12-18 15:16 UTC):**
  - Restored patches from `/srv/backups/LT/patches/`
  - Mounted `fetch.py` and `ls_script.liq` patches
  - **Initially NOT mounting `queue.py`** - testing if it's actually needed
  - Old server had queue.py file but it wasn't mounted and worked fine
  - **Result at 16:00 UTC:** Bug recurred - playout waiting for 17:00 instead of playing 16:00 show
  - **Logs:** `16:00:00 - "waiting 3599.996044s until next scheduled item"` (classic bug pattern)
  - **Conclusion:** queue.py patch IS needed - fetch.py alone doesn't fix hourly boundary bug
  - **Fix applied (16:13 UTC):** Added queue.py mount to docker-compose.yml and recreated playout container
  - **Patch verified:** queue.py now 147 lines (patched) vs 79 lines (original), contains `filtered_events` logic
  - **Result at 17:00 UTC:** Show started 11 minutes late (17:11 instead of 17:00)
  - **Analysis:** Container restart at 16:13 UTC cleared the queue, requiring schedule rebuild
  - **Insight:** The 11-minute delay was likely due to queue rebuilding after restart, not patch failure
  - **Status:** Patch active (147 lines, contains filtered_events logic), monitoring next transition
  - **Next monitoring:** Check 18:00 UTC transition - this will be the first transition with patch active and queue already built
- **Location:**
  - LibreTime playout service (`libretime-playout-1`)
  - Known bug documented in `docs/STREAM_HEALTH_MONITORING.md`
  - Stream health check: `scripts/stream-health-check.sh`

### 2025-11-25 – Upload form errors: 408 timeout, HEIC processing, duplicate filenames
- **When:** 2025-11-24 (reported), 2025-11-25 (fixed)
- **Fixed:** 2025-11-25
- **Impact:** Users unable to upload episodes via upload form, multiple error types preventing successful uploads
- **Symptoms:**
  - 408 Request Timeout errors during large file uploads
  - "bad seek" errors when processing HEIC/HEIF cover images from iPhones/Macs
  - "Value must be unique" errors for filename when retrying failed uploads
  - Uploads appearing successful (201) but episodes not created due to image processing failures
- **Evidence:**
  - Nginx logs show 408 errors from IP `176.171.168.82` on 2025-11-24
  - Payload logs show "source: bad seek to 1685510 heif: Unsupported feature: Unsupported codec (4.3000)" errors
  - Media-track uploads succeed (201) but episode creation fails during cover image processing
  - Duplicate filename errors occur when retrying uploads with same episode ID
- **Root cause (confirmed):**
  1. **408 Timeout:** Nginx timeout settings (300s) too short for large audio files on slower connections
  2. **HEIC/HEIF Errors:** Sharp library lacks HEIC codec support without `libheif`/`libde265` libraries, causing "bad seek" errors when processing iPhone/Mac cover images
  3. **Duplicate Filenames:** Failed uploads leave orphaned media-track records with same filename, causing unique constraint violations on retry
  4. **Audio Thumbnails:** `adminThumbnail` setting in MediaTracks attempted to generate thumbnails from audio files, triggering Sharp errors
- **Fix:**
  1. **Nginx timeouts:** Increased all timeout settings from 300s to 600s (10 minutes) in `/etc/nginx/sites-available/upload.content.diaradio.live`
  2. **HEIC support:** Added `libheif libde265` libraries to Docker containers and implemented automatic HEIC→JPEG conversion with compression in `MediaImages.ts`
  3. **Duplicate cleanup:** Added logic in `MediaTracks.ts` to detect and delete existing media-track records before creating new ones, with timestamp fallback if deletion fails
  4. **Audio thumbnails:** Removed `adminThumbnail` setting from MediaTracks collection
- **Location:**
  - `/etc/nginx/sites-available/upload.content.diaradio.live` (timeout settings)
  - `src/collections/MediaImages.ts` (HEIC handling)
  - `src/collections/MediaTracks.ts` (duplicate cleanup, thumbnail removal)
  - `docker-compose.yml` (HEIC libraries)
- **Status:** Fixed – 2025-11-25
- **Verification:** Successful upload completed at 08:27:01 UTC on 2025-11-25 (episode ID: `692567c9d3a867cc51d99948`)

### 2025-11-21 – User favorites update fails with MongoDB CastError
- **When:** 2025-11-21 ~09:12 UTC (10:12 Paris time)
- **Impact:** User favorites update fails, error logged but does not crash server or affect stream
- **Symptoms:**
  - MongoDB error: `Cast to ObjectId failed for value "..." (type Object) at path "favorites"`
  - Error occurs when admin user (`688a5b0e937506784ca139d1`) attempts to update their favorites
  - Full episode objects are being sent instead of ObjectId strings
- **Evidence:**
  - Payload logs show CastError with full episode object serialized as string
  - Error path: `favorites.0` (first element in favorites array)
  - `beforeValidate` hook in `Users.ts` should normalize this but appears to be bypassed or not handling this case
- **Root cause (suspected):**
  - Client/frontend sending full episode objects instead of just IDs
  - `beforeValidate` hook in `src/collections/Users.ts` (lines 96-128) attempts to extract IDs but may not handle all object shapes
  - Hook looks for `(v as any).episode || (v as any).id || (v as any).value` but full episode objects have nested structure
- **Fix (planned):**
  - Enhance `beforeValidate` hook to better handle full episode objects
  - Ensure hook extracts `id` field directly from episode objects
  - Add validation to reject invalid data before it reaches MongoDB
- **Status:** Open – needs investigation and fix
- **Note:** This error is unrelated to deterministic feed or stream interruptions

### 2025-11-21 – Large schedule delta triggers audible interruption during long show
- **When:** 2025-11-21 ~09:12 UTC (10:12 Paris time)
- **Impact:** Audible interruption in stream, schedule transition attempted mid-show
- **Symptoms:**
  - LibreTime logs: `Deterministic feed delta exceeds threshold (delta=4348.775s)` (~72 minutes)
  - Feed shows `first_start=2025-11-21T08:00:00` when fetched at `09:12:28 UTC`
  - "New schedule received" logged, causing queue rebuild during active playback
  - Audible interruption reported by user
- **Evidence:**
  - LibreTime logs show feed fetch at 09:12:28 UTC
  - Feed returned 2-hour show that started at 08:00 UTC (still playing)
  - Delta of 4348 seconds = time since show started (72 minutes into 2-hour show)
  - Queue rebuilt: "waiting 2851.22082s until next scheduled item" (47 minutes until 10:00 UTC end)
- **Root cause (suspected):**
  - Feed query in `deterministicFeed.ts` (lines 686-689) filters episodes where `scheduledEnd > now`, correctly including currently playing shows
  - LibreTime calculates delta as `abs((first_start - now_utc).total_seconds())` (line 312 in `fetch.py`)
  - For long shows (2+ hours), delta naturally becomes large (hours) as show progresses
  - LibreTime applies new schedule even when delta is large, triggering queue rebuild
  - Queue rebuild during active playback may cause brief interruption
- **Analysis:**
  - The large delta is expected behavior for long shows - it's the time since the show started, not an error
  - The warning threshold (2 seconds) is too strict for long shows
  - LibreTime should either:
    1. Not apply schedule updates when delta is large and show is already playing correctly, OR
    2. Calculate delta differently (e.g., time until next transition, not time since first_start)
- **Fix (planned):**
  - Modify LibreTime `fetch.py` to skip schedule application when:
    - Delta is large (> threshold) AND
    - Current show is still playing (matches first_start from feed) AND
    - No actual schedule change detected
  - Or adjust delta calculation to be time until next transition, not time since show start
- **Status:** Open – needs investigation and fix

### 2025-11-20 – Show cues out early after deterministic feed update
- **When:** 2025-11-20 ~14:56:45 UTC (observed during LEFEU show)
- **Fixed:** 2025-11-20
- **Impact:** Show restarts 3 minutes early, interrupting playback and causing schedule desync.
- **Symptoms:**
  - Show scheduled 14:00-15:00 UTC (1 hour duration, `cue_out` = 3600.222s)
  - At 14:56:45 UTC (56m 45s into show), Liquidsoap logs "Cueing out..." and "Finished with a non-existent file?!"
  - File immediately restarts, causing audible jingle/restart
  - Show ends 3 minutes early instead of at scheduled 15:00 UTC
- **Evidence:**
  - Liquidsoap logs show cue-out at 14:56:45 UTC (3 minutes before scheduled end)
  - Deterministic feed updated at 14:53:45 UTC with large delta (53m 45s)
  - Schedule metadata shows correct 1-hour duration and `cue_out` = 3600.222s
  - File metadata indicates full 1-hour duration
- **Root cause (confirmed):**
  - `deterministicFeed.ts` lines 423-428: `cue_in_sec` was recalculated on each feed generation for currently playing shows based on elapsed time
  - When feed updated mid-playback, Liquidsoap received a new `scheduleVersion` with changed `cue_in_sec` (e.g., 0 → 180 seconds after 3 minutes)
  - Liquidsoap interpreted the changed `cue_in_sec` as a new cue-in position and restarted the file from that position
  - This caused the file to restart, triggering an early cue-out 3 minutes before the scheduled end
- **Fix:**
  - Always set `cue_in_sec` to 0 to prevent Liquidsoap from restarting files when feed updates during playback
  - The `start_utc`/`end_utc` timestamps are sufficient for playout to identify which show should be playing now
  - Location: `src/lib/schedule/deterministicFeed.ts` (lines 419-425)
- **Status:** Fixed – 2025-11-20

### 2025-11-10 – Payload dev server OOM stalls host
- **When:** 2025-11-10 ~12:02–12:25 CET
- **Impact:** SSH unresponsive, stream stack unstable, CPU pegged (kswapd0), multiple containers unhealthy.
- **Symptoms:**
  - Noon changeover → server unreachable via SSH.
  - `htop`: `kswapd0` ~97 % CPU, `mongod` ~50 % CPU, high run queue.
  - Kernel OOM killed Next.js process inside `payload-payload-1`.
- **Root cause (confirmed):**
  - `payload-payload-1` running `next dev` in production.
  - Concurrent cron hits around noon triggered heavy recompiles → Node RSS >3.4 GB → memory pressure → swap thrash → OOM kill.
- **Evidence:**
  - `sar` showed ~90 % kernel time + runq 60–80.
  - `journalctl`: repeated "Under memory pressure, flushing caches."
  - `dmesg`: OOM killed `next-server (v1)` in container.
  - `docker logs` for API showed worker timeouts/SIGKILLs.
- **Containment:**
  - Manual `docker compose down payload` via Hetzner console restored control and stabilized services.
- **Corrective actions (planned):**
  1. Switch Payload/Next to production mode (`next build` + `next start`), remove dev server from compose.
  2. Guard Node with `NODE_OPTIONS=--max_old_space_size=1536` (or lower).
  3. Stagger cron jobs near noon; call Payload REST directly (avoid Next layer).
  4. Cap Mongo WiredTiger cache (~0.5–1 GB).
  5. Add alerts: OOM events, run queue >16, swap spikes.
  6. Schedule a noon canary run to verify stability.
- **Status:** Open – implementation pending.
- **Next actions:**
  - Approve change plan.
  - Draft Cursor prompt to update docker-compose, env guards, cron scheduling, and deploy.
  - Add Prometheus/node-exporter alerting or cron-based `sar` checks.

### 2025-11-07 – Episode slug update rejects unique value
- **Episode ID:** `685e6a51b3ef76e0e25c104b`
- **API endpoint:** `PATCH /api/episodes/{id}` from Payload admin
- **Observed:** Request fails with `400` and validation error `slug` must be unique.
- **Steps:**
  1. Open the episode in Payload admin.
  2. Clear the `slug` field (expect auto-regeneration) or enter a new unique slug manually.
  3. Save the form.
- **Expected:** Auto-generated or manually entered unique slug saves successfully.
- **Actual:** Validation rejects the update even when the slug value is unique (confirmed via backup inspection).
- **Notes:**
  - Automatic slug regeneration works for other episodes.
  - Backups show only one document with slug `antiskating-yanneras-260424`.
  - Likely caused by the beforeValidate hook reusing the same slug and tripping the Mongo unique index during update.
- **Next steps:**
  - Reproduce after server restart to confirm persistence.
  - Adjust slug regeneration logic to skip when value is unchanged or allow manual overrides.
