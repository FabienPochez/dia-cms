## Bug Log

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
