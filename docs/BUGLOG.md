## Bug Log

### 2026-01-02 – Inbox hydration: Duplicate files created in LibreTime due to UUID suffix collision handling
- **When:** 2026-01-02 ~12:00 UTC (during inbox hydration script run)
- **Impact:** Medium – duplicate files created in LibreTime for same episode, causing confusion and wasted storage
- **Symptoms:**
  - Episode `6943bf9b4a3a130aafe0b6bc` ("Karpatxoa Katedrala") has 2 files in LibreTime:
    - `6943bf9b4a3a130aafe0b6bc__dia-karpatxoa-kathedra.mp3` (ID: 2076)
    - `6943bf9b4a3a130aafe0b6bc__dia-karpatxoa-kathedra_dbfd16dd-9d79-48a2-8bef-6483fe66e19d.mp3` (ID: 2079)
  - Episode `68fb64f7ae3456e6cc4a322e` ("Gros Volume Sur La Molle w/ Chach") has 2 files in LibreTime:
    - `68fb64f7ae3456e6cc4a322e__gros-volume-sur-la-mol.mp3` (ID: 2077)
    - `68fb64f7ae3456e6cc4a322e__gros-volume-sur-la-mol_16ebfd72-fe15-4b3b-b349-8bba331cd733.mp3` (ID: 2078)
  - Second file in each pair has UUID suffix added by LibreTime
- **Root cause:**
  - Script checks for existing files using episode ID prefix search (`findLibreTimeFileByPrefix`)
  - If a file with the same episode ID prefix exists but with a different exact filename, the check may find it
  - However, when uploading, LibreTime detects a filename collision and automatically adds a UUID suffix
  - This creates a duplicate file even though a file for that episode already exists
  - The script doesn't check for exact filename matches before uploading
- **Evidence:**
  - Both duplicate pairs have same episode ID prefix but different exact filenames
  - Second file in each pair has UUID suffix (LibreTime's collision handling)
  - Files were uploaded today (2026-01-02) during inbox hydration run
- **Fix:**
  - Script should check for exact filename matches, not just episode ID prefix matches
  - Or check if ANY file with the episode ID prefix exists and skip upload if found
  - Need to handle LibreTime's UUID suffix behavior when checking for existing files
- **Status:** Open – needs investigation and fix
- **Location:**
  - `scripts/hydrate-inbox-lt.ts` (findLibreTimeFileByPrefix function, line ~262)
  - LibreTime file upload collision handling

### 2026-01-02 – Inbox hydration: Track title not set correctly for newly uploaded files
- **When:** 2026-01-02 ~12:00 UTC (during inbox hydration script run)
- **Impact:** Low – tracks are correctly linked between Payload and LibreTime, but track titles in LibreTime may be incorrect (e.g., timestamp patterns like "2025-10-28_17h52m48" instead of episode title)
- **Symptoms:**
  - Episode `6911e86b354d6d26f4bf20aa` ("Scorpio Season") uploaded to LibreTime today
  - Track correctly linked: LibreTime Track ID 2074, filepath `imported/1/6911e86b354d6d26f4bf20aa__scorpio-season-nietanc.mp3`
  - Payload episode has correct title: "Scorpio Season"
  - LibreTime track has incorrect title: "2025-10-28_17h52m48" (timestamp pattern, likely from filename/metadata)
- **Root cause (suspected):**
  - Track title update (`updateLibreTimeTrackName`) may be failing silently during upload
  - Or track title is being set from file metadata instead of episode title
  - The `updateLibreTimeTrackName` function is called after upload but may not be working correctly
- **Evidence:**
  - Track uploaded today (2026-01-02) via inbox hydration script
  - Payload episode title is correct: "Scorpio Season"
  - LibreTime track title is wrong: "2025-10-28_17h52m48"
  - Track is correctly linked (libretimeTrackId and filepath are set in Payload)
- **Fix:**
  - Not critical – tracks are correctly linked and functional
  - Track titles can be manually corrected in LibreTime if needed
  - Should investigate why `updateLibreTimeTrackName` isn't working during upload
- **Status:** Open – low priority, needs investigation
- **Location:**
  - `scripts/hydrate-inbox-lt.ts` (uploadFileToLibreTime function, line ~495)

### 2025-12-31 – Payload-LibreTime sync bug: Show instance exists but playout entry missing
- **When:** 2025-12-31 ~09:00-10:00 UTC (10:00-11:00 Paris time)
- **Impact:** Stream stuck in jingle loop, show scheduled in Payload but not playing in LibreTime
- **Symptoms:**
  - Episode `68826599ba767f41743ca787` ("Gros Volume Sur La Molle #12 w/ Chach") scheduled in Payload
  - Show instance exists in LibreTime (instance ID 407, 09:00-11:00 UTC)
  - File exists at `/srv/media/imported/1/68826599ba767f41743ca787__gros-volume-sur-la-mol.mp3`
  - **No playout entry** in `cc_schedule` table for that instance/time window
  - Stream playing jingles instead of scheduled show
  - LibreTime UI shows show instance but "nothing planned"
- **Evidence:**
  - Database query shows instance 407 exists but `playout_count = 0` for current time window
  - Only past playout entry exists (ID 2449 from Dec 28) for instance 407
  - After manual re-sync, playout entry created (ID 2504) and stream started playing
- **Root cause (suspected):**
  - Race condition during sync: episode scheduled in Payload, instance created in LibreTime, but playout entry creation failed or was skipped
  - Possible timing issue where sync happened before instance was ready
  - Or silent failure in playout creation step
- **Fix:**
  - Manual re-sync of planner resolved the issue
  - Playout entry (ID 2504) was created and stream resumed
- **Prevention:**
  - Add validation to ensure playout entries are created when episodes are scheduled
  - Add health check that detects show instances without playouts
  - Consider auto-fix mechanism that creates missing playouts for existing instances
- **Status:** Open – first occurrence, needs investigation
- **Location:**
  - Payload-LibreTime sync process
  - `src/lib/services/scheduleOperations.ts` (planOne function)

### 2025-12-31 (11:00 UTC) – LibreTime timing bug: Health check restart causes wrong show to play

- **When:** 2025-12-31 11:00-11:36 UTC (12:00-12:36 Paris time)
- **Severity:** Critical (wrong show playing)
- **Status:** ⚠️ Recurrence of Bug #1
- **Impact:** "La Guerre est Terminée" scheduled 11:00-13:00 UTC not playing; "Gros Volume Sur La Molle" (09:00-11:00 UTC) still playing instead
- **Symptoms:**
  - Health check restarted playout at 09:25 UTC (11:25 Paris time)
  - After restart, playout resumed playing "Gros Volume Sur La Molle" (09:00-11:00 UTC)
  - At 11:00 UTC, playout should have switched to "La Guerre est Terminée" but didn't
  - Playout logs show: `first_start_utc=2025-12-31T13:00:00Z` (waiting for 13:00 UTC)
  - Current time (11:36 UTC) falls within scheduled window (11:00-13:00 UTC) but playout doesn't recognize it
  - Playout says: `Need to add items to Liquidsoap *now*: {2492}` (correct show ID) but then waits for 13:00 UTC
- **Root cause:**
  - **LibreTime Bug #1**: Hourly boundary timing detection failure (same as 2025-12-30 and 2025-12-18)
  - Health check restart triggered at 09:25 UTC, causing playout to resume previous show
  - At 11:00 UTC boundary, playout failed to recognize current time falls within scheduled show window
  - Playout calculates "next show" incorrectly and waits for wrong time
- **Database status:**
  - Schedule entry exists (ID 2492): "La Guerre est Terminée #02" (11:00-13:00 UTC)
  - File exists and registered in LibreTime (ID 953)
  - Query confirms: `should_be_playing = true` (current time within window)
- **Fix applied:**
  - Manual restart of playout at 11:36 UTC
  - **Note:** Even after restart, playout still shows `first_start_utc=2025-12-31T13:00:00Z` and waits for 13:00 UTC
  - This suggests the bug persists even after restart in some cases
- **Prevention:**
  - Health check should be more careful about when it restarts playout
  - Consider adding logic to detect if restart causes schedule desync
  - May need to add manual intervention when health check detects this pattern
- **Status:** Open – recurrence of Bug #1, needs investigation into why restart doesn't always fix it
- **Related:**
  - Same bug as 2025-12-30 and 2025-12-18 incidents
  - Health check may be contributing to the problem by restarting at inopportune times

### 2025-12-30 – Stream silent: LibreTime hourly boundary timing bug + missing health check
- **When:** 2025-12-30, 10:05-10:13 UTC (11:05-11:13 Paris time)
- **Severity:** Critical (stream offline)
- **Status:** ✅ Fixed (manual restart + health check configured)
- **Impact:** Stream completely silent, no "on air" indicator, no jingles playing
- **Symptoms:**
  - Stream completely silent
  - No "on air" indicator in LibreTime UI
  - No jingles playing (normally jingle loop runs when no track)
  - LibreTime playout service running but not playing content
- **Root cause (confirmed):**
  - **LibreTime Bug #1**: Hourly boundary timing detection failure
  - Playout logs show incorrect timing calculation:
    ```
    2025-12-30 10:11:32 UTC:
      first_start_utc=2025-12-30T11:00:00Z
      now_utc=2025-12-30T10:11:32.931158Z
      wait=2907.069s
      "waiting 2907.068842s until next scheduled item"
    ```
  - Playout thinks next show starts at 11:00 UTC, but show is scheduled RIGHT NOW (09:00-11:00 UTC)
  - Current time (10:11 UTC) falls within scheduled window but playout doesn't recognize it
- **Database status:**
  - Schedule entry exists (ID 2485): "Strange How You Move w/ Doum #07" (09:00-11:00 UTC)
  - File exists on disk: `/srv/media/imported/1/Doum/strange how you move/685e6a54b3ef76e0e25c192b__strange-how-you-move__.mp3`
  - File registered in LibreTime (ID 944)
- **Fix applied:**
  - Manual restart: `cd /srv/libretime && docker compose restart playout liquidsoap`
  - Stream resumed after restart
- **Health check issue:**
  - Health check cron job was **NOT configured** in crontab
  - Script exists but wasn't running automatically
  - **Fix:** Added to root crontab:
    ```bash
    * * * * * /usr/bin/flock -n /tmp/dia-health.lock /srv/payload/scripts/stream-health-check.sh
    ```
  - Also installed `jq` package (required by health check script)
  - Fixed state file permissions (`/tmp/stream-health-state.json`)
- **Status:** Fixed – 2025-12-30 (restart + health check now active)
- **Related:**
  - Same bug as 2025-12-18 incident (hourly boundary timing)
  - Documented in `docs/STREAM_HEALTH_MONITORING.md` as Bug #1
  - Health check should now catch and auto-fix future occurrences

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
