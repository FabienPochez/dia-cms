## Bug Log

### 2025-11-10 – Payload dev server OOM stalls host
- **When:** 2025-11-10 ~12:02–12:25 CET
- **Impact:** SSH unresponsive, stream stack unstable, CPU pegged (kswapd0), multiple containers unhealthy.
- **Symptoms:**
  - Noon changeover → server unreachable via SSH.
  - `htop`: `kswapd0` ~97 % CPU, `mongod` ~50 % CPU, high run queue.
  - Kernel OOM killed Next.js process inside `payload-payload-1`.
- **Root cause (confirmed):**
  - `payload-payload-1` running `next dev` in production.
  - Concurrent cron hits around noon triggered heavy recompiles → Node RSS >3.4 GB → memory pressure → swap thrash → OOM kill.
- **Evidence:**
  - `sar` showed ~90 % kernel time + runq 60–80.
  - `journalctl`: repeated “Under memory pressure, flushing caches.”
  - `dmesg`: OOM killed `next-server (v1)` in container.
  - `docker logs` for API showed worker timeouts/SIGKILLs.
- **Containment:**
  - Manual `docker compose down payload` via Hetzner console restored control and stabilized services.
- **Corrective actions (planned):**
  1. Switch Payload/Next to production mode (`next build` + `next start`), remove dev server from compose.
  2. Guard Node with `NODE_OPTIONS=--max_old_space_size=1536` (or lower).
  3. Stagger cron jobs near noon; call Payload REST directly (avoid Next layer).
  4. Cap Mongo WiredTiger cache (~0.5–1 GB).
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

