# Reviewer Pack: Jobs v2 Secure Redesign
**Date:** December 8, 2025  
**Type:** Security Audit & Design Proposal  
**Status:** READ-ONLY (Audit Only - No Code Changes)

---

## 1) SUMMARY

- **Current State**: `dev-scripts` container is a long-lived Debian-based container (`node:18`) with full bind mount to `/srv/payload`, recently hardened to remove `docker.sock` mount and run as non-root (UID 1000:1000). Container is currently **STOPPED** and was identified as the attack vector for cryptominer malware.

- **Script Inventory**: 54 TypeScript/JavaScript scripts and 24 shell scripts. Two critical cron jobs (`preair_rehydrate.ts`, `postair_archive_cleanup.ts`) run every 15/10 minutes via `docker compose exec` into the container.

- **Dependencies**: Scripts require Node.js/TypeScript runtime, Payload CMS API access, MongoDB connectivity, file system access to `/srv/media`, rsync with SSH to `bx-archive` server, and some require Docker control (postgres queries, container restarts).

- **Security Risk Level**: **HIGH** - Even with docker.sock removed, the full bind mount to `/srv/payload` allows source code modification. Long-lived container pattern increases attack surface. SSH key management for rsync is unresolved.

- **Key Finding**: Most scripts (TypeScript cron jobs) only need **API + data access** (Category A). A smaller subset needs **Docker control** (Category B) and should run from host via SSH, not inside containers.

- **Migration Path**: Introduce ephemeral `jobs` service using `docker compose run --rm`, migrate Category A scripts to ephemeral pattern, move Category B scripts to host-level execution, retire `dev-scripts` container.

---

## 2) FINDINGS & ANALYSIS

### a. Current dev-scripts Design

**Location**: `docker-compose.yml` lines 94-115

**Configuration**:
```yaml
dev-scripts:
  image: node:18                    # Debian-based (not Alpine)
  restart: unless-stopped          # Long-lived container
  user: "1000:1000"                # Non-root (recently added)
  volumes:
    - .:/app                       # Full bind mount (read-write)
    - /srv/media:/srv/media        # Media directory access
  command: 
    - "apt-get update && apt-get install -y rsync postgresql-client && tail -f /dev/null"
  env_file: .env
```

**Removed (Security Hardening)**:
- ❌ `/var/run/docker.sock:/var/run/docker.sock` (removed - was critical vulnerability)
- ❌ `/root/.ssh:/root/.ssh:ro` (removed - not compatible with non-root user)
- ❌ `docker.io` package (removed from apt-get install)

**Current Status**: Container is **STOPPED** (exited). Cron jobs are failing because they depend on this container.

**Security Concerns**:
1. **Full bind mount** (`.:/app`) allows modifying source code from inside container
2. **Long-lived container** (`restart: unless-stopped`) increases attack surface and persistence risk
3. **SSH key access unresolved** - rsync scripts need SSH to `bx-archive` but `/root/.ssh` mount was removed
4. **Debian base image** larger attack surface than Alpine
5. **Write access to `/srv/payload`** allows injecting malicious code into repository

---

### b. Scripts & Tasks Inventory

#### Category A: API/Data Only (No Docker Control Required)

**Cron Jobs** (run via `docker compose exec`):
- `scripts/cron/preair_rehydrate.ts` - Rehydrates missing working files for scheduled episodes
  - **Needs**: Payload API, MongoDB, file system (`/srv/media`), rsync (via shell script)
  - **Docker**: No direct Docker control
  
- `scripts/cron/postair_archive_cleanup.ts` - Archives aired episodes and cleans up working files
  - **Needs**: Payload API, MongoDB, file system (`/srv/media`), rsync (via shell script)
  - **Docker**: No direct Docker control

**Other TypeScript Scripts** (54 total, examples):
- `scripts/importBatchEpisodes.ts` - Batch episode import
- `scripts/importOneEpisode.ts` - Single episode import
- `scripts/hydrate-archive-paths.ts` - Archive path hydration
- `scripts/cleanup-imported-files.ts` - File cleanup
- `scripts/attach-media-to-episodes.ts` - Media attachment
- Most maintenance scripts in `scripts/maintenance/`
- Most database scripts in `scripts/db/`

**Common Requirements**:
- Node.js 18+ runtime
- TypeScript execution (`npx tsx`)
- Payload CMS API access (via `getPayload()`)
- MongoDB connectivity (via Payload, not direct)
- File system read/write to `/srv/media`
- Environment variables from `.env`

**Rsync Dependency**:
- Scripts call `rsyncPull()` which executes `scripts/sh/archive/rsync_pull.sh`
- This script uses SSH to connect to `bx-archive:/home/archive/...`
- **Requires**: SSH keys configured for `bx-archive` host
- **Current Issue**: SSH keys were removed with `/root/.ssh` mount

---

#### Category B: Requires Docker Control

**Host-Level Scripts** (run directly on host, not in container):
- `scripts/fix-libretime-file-exists.sh` - Fixes LibreTime file_exists flags
  - **Uses**: `docker exec -i libretime-postgres-1 psql ...`
  - **Needs**: Docker socket access (from host)
  
- `scripts/stream-health-check.sh` - Monitors stream and restarts playout
  - **Uses**: `docker exec -i libretime-postgres-1 psql ...`
  - **Uses**: `docker compose restart playout liquidsoap` (in `/srv/libretime`)
  - **Needs**: Docker socket access (from host)

**Scripts That Call Docker Exec** (from inside dev-scripts):
- `scripts/importBatchEpisodes.ts` - Calls `docker exec libretime_api_1 libretime-api bulk_import ...`
- `scripts/importOneEpisode.ts` - Calls `docker exec libretime_api_1 libretime-api bulk_import ...`
- **Note**: These scripts check `isInsideDocker()` and use different code paths

**Common Requirements**:
- Docker socket access (`/var/run/docker.sock`)
- Ability to execute `docker exec` commands
- Ability to restart containers via `docker compose`

---

### c. Cron / Automation

**Current Cron Jobs** (`/etc/crontab`):

1. **Pre-air Rehydrate** (every 15 minutes):
   ```bash
   */15 * * * * /usr/bin/flock -n /tmp/dia-preair.lock \
     docker compose -f /srv/payload/docker-compose.yml exec -T dev-scripts \
     sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts' \
     >> /var/log/dia-cron/preair-rehydrate.log 2>&1
   ```
   - **Status**: Currently failing (container stopped)
   - **Type**: Category A (API/data only)

2. **Post-air Archive** (every 10 minutes):
   ```bash
   */10 * * * * /usr/bin/flock -n /tmp/dia-postair.lock \
     docker compose -f /srv/payload/docker-compose.yml exec -T dev-scripts \
     sh -lc 'npx tsx scripts/cron/postair_archive_cleanup.ts' \
     >> /var/log/dia-cron/postair-archive.log 2>&1
   ```
   - **Status**: Currently failing (container stopped)
   - **Type**: Category A (API/data only)

3. **File Exists Check** (daily at 3 AM):
   ```bash
   0 3 * * * /usr/bin/flock -n /tmp/dia-filecheck.lock \
     /srv/payload/scripts/fix-libretime-file-exists.sh \
     >> /var/log/dia-cron/file-exists-check.log 2>&1
   ```
   - **Status**: Running (host-level script)
   - **Type**: Category B (needs Docker control)

4. **Stream Health Check** (every minute):
   ```bash
   * * * * * /usr/bin/flock -n /tmp/dia-health.lock \
     /srv/payload/scripts/stream-health-check.sh
   ```
   - **Status**: Running (host-level script)
   - **Type**: Category B (needs Docker control)

5. **System Health Guard** (every 5 minutes):
   ```bash
   */5 * * * * /usr/bin/flock -n /tmp/dia-system-watch.lock \
     /srv/payload/scripts/cron/system_health_guard.sh
   ```
   - **Status**: Running (host-level script)
   - **Type**: Host-level only (no container needed)

6. **Noon Canary** (daily at 12:05 CET):
   ```bash
   5 12 * * * /usr/bin/flock -n /tmp/dia-noon-canary.lock \
     /srv/payload/scripts/cron/noon_canary.sh
   ```
   - **Status**: Running (host-level script)
   - **Type**: Host-level only (no container needed)

**Dependencies**:
- All cron jobs use `flock` to prevent overlapping runs
- Category A jobs depend on `dev-scripts` container (currently broken)
- Category B jobs run directly on host (working)

---

### d. Security Concerns

**Critical Issues**:

1. **Full Bind Mount to Repository** (`.:/app`)
   - Allows modifying source code from inside container
   - If container is compromised, attacker can inject malicious code
   - Risk: Code injection, backdoor installation, supply chain attack
   - **Mitigation**: Use read-only mount or ephemeral containers with code copied in

2. **Long-Lived Container Pattern** (`restart: unless-stopped`)
   - Container runs continuously, increasing attack surface
   - If compromised, attacker has persistent access
   - Risk: Persistence mechanism, lateral movement
   - **Mitigation**: Use ephemeral containers (`docker compose run --rm`)

3. **SSH Key Management Unresolved**
   - Rsync scripts need SSH access to `bx-archive` server
   - `/root/.ssh` mount was removed (incompatible with non-root user)
   - Current scripts will fail when rsync is attempted
   - **Risk**: Scripts fail, or SSH keys need alternative management
   - **Mitigation**: Use SSH agent forwarding, dedicated SSH user, or host-level rsync

4. **Debian Base Image** (`node:18` vs `node:18-alpine`)
   - Larger attack surface than Alpine
   - More packages installed, more CVEs
   - **Mitigation**: Use Alpine-based image for smaller footprint

5. **Write Access to `/srv/payload`**
   - Container can modify repository files
   - Risk: Code injection, malicious script installation
   - **Mitigation**: Read-only mount or copy code into container

**Additional Weaknesses**:

6. **No Resource Limits**
   - Container can consume unlimited CPU/memory
   - Risk: Resource exhaustion attacks
   - **Mitigation**: Add `deploy.resources.limits`

7. **No Network Isolation**
   - Container shares network with other services
   - Risk: Lateral movement if compromised
   - **Mitigation**: Use isolated network or no network for jobs

8. **Environment Variable Exposure**
   - Full `.env` file mounted (may contain secrets)
   - Risk: Secret leakage if container compromised
   - **Mitigation**: Use Docker secrets or selective env vars

---

## 3) PROPOSED PLAN FOR "JOBS v2" (No Code Yet)

### Phase 1: Create Ephemeral Jobs Service

**New Service Definition** (`docker-compose.yml`):
- **Service Name**: `jobs` (not `dev-scripts`)
- **Image**: `node:18-alpine` (smaller, more secure)
- **User**: Non-root (UID 1000:1000, GID 1000:1000)
- **Restart Policy**: `no` (ephemeral, never auto-restart)
- **Volumes**:
  - `.:/app:ro` (read-only repository mount)
  - `/srv/media:/srv/media:rw` (read-write media access)
  - `node_modules:/app/node_modules` (named volume for dependencies)
- **No docker.sock mount** (ephemeral jobs don't need Docker control)
- **No SSH mount** (SSH handled differently - see Phase 3)
- **Command**: `tail -f /dev/null` (idle, ready for `docker compose run`)

**Key Differences from dev-scripts**:
- ✅ Ephemeral (run-on-demand, not long-lived)
- ✅ Read-only repository mount
- ✅ Alpine-based (smaller attack surface)
- ✅ No docker.sock access
- ✅ No SSH mount

---

### Phase 2: Migrate Category A Scripts to Ephemeral Pattern

**Cron Job Updates** (`/etc/crontab`):

**Before** (long-lived container):
```bash
docker compose exec -T dev-scripts sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'
```

**After** (ephemeral container):
```bash
docker compose -f /srv/payload/docker-compose.yml run --rm jobs \
  sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'
```

**Benefits**:
- Container starts fresh for each run
- No persistent state between runs
- Reduced attack surface (container only exists during execution)
- Automatic cleanup after completion

**Scripts to Migrate**:
- `scripts/cron/preair_rehydrate.ts` → Ephemeral pattern
- `scripts/cron/postair_archive_cleanup.ts` → Ephemeral pattern
- All other TypeScript scripts that don't need Docker control

**Manual Execution Pattern**:
```bash
# Old way (long-lived container)
docker exec payload-dev-scripts-1 sh -lc 'npx tsx scripts/importOneEpisode.ts'

# New way (ephemeral container)
docker compose run --rm jobs sh -lc 'npx tsx scripts/importOneEpisode.ts'
```

---

### Phase 3: Handle SSH/Rsync Requirements

**Problem**: Rsync scripts need SSH access to `bx-archive` server, but SSH keys can't be mounted into non-root container.

**Solution Options**:

**Option A: Host-Level Rsync Wrapper** (Recommended)
- Create wrapper script on host: `/srv/payload/scripts/sh/archive/rsync_pull_host.sh`
- Script runs rsync from host (has SSH keys)
- TypeScript code calls host script via `docker exec` or HTTP API
- **Pros**: SSH keys stay on host, no container access needed
- **Cons**: Requires host-level script execution

**Option B: SSH Agent Forwarding**
- Use SSH agent forwarding from host to container
- Container inherits SSH agent socket
- **Pros**: No key files in container
- **Cons**: Requires SSH agent running on host, more complex setup

**Option C: Dedicated SSH User**
- Create non-root user on host with SSH keys
- Mount user's `.ssh` directory into container
- **Pros**: Simple, works with non-root container
- **Cons**: Requires user management, keys still in container

**Option D: HTTP API Proxy**
- Create HTTP API endpoint that proxies rsync requests
- Container calls API instead of direct rsync
- **Pros**: Complete isolation, no SSH in container
- **Cons**: Requires new API endpoint, more infrastructure

**Recommendation**: **Option A** (Host-Level Wrapper) - Simplest, most secure, minimal changes.

**Implementation**:
- Modify `rsyncPull()` to detect if running in container
- If in container, call host script via `docker exec` or HTTP API
- If on host, call rsync directly

---

### Phase 4: Migrate Category B Scripts to Host Execution

**Scripts That Need Docker Control**:
- `scripts/fix-libretime-file-exists.sh` → Already runs on host ✅
- `scripts/stream-health-check.sh` → Already runs on host ✅
- `scripts/importBatchEpisodes.ts` → Modify to use host-level Docker exec
- `scripts/importOneEpisode.ts` → Modify to use host-level Docker exec

**Pattern**:
- These scripts should **not** run inside containers
- They should run directly on host (via cron or manual execution)
- They have direct access to Docker socket (`/var/run/docker.sock`)

**Modifications Needed**:
- Update `isInsideDocker()` checks in TypeScript scripts
- If in container, exit with error or delegate to host script
- Create host-level wrapper scripts for Docker operations

---

### Phase 5: Retire Legacy dev-scripts Container

**Steps**:
1. ✅ Verify all Category A scripts migrated to ephemeral `jobs` service
2. ✅ Verify all Category B scripts running on host
3. ✅ Update all documentation (README, scripts, docs)
4. ✅ Remove `dev-scripts` service from `docker-compose.yml`
5. ✅ Remove any references to `payload-dev-scripts-1` in scripts/docs
6. ✅ Test all cron jobs with new pattern
7. ✅ Monitor for 1 week to ensure stability

**Cleanup**:
- Remove `dev-scripts` service definition
- Update README.md references
- Update script comments/documentation
- Archive old container image (if needed)

---

## 4) QUESTIONS & RISKS

### Questions for Fabien:

1. **SSH Key Management**: How should we handle SSH keys for rsync to `bx-archive`? Do you prefer host-level wrapper (Option A) or another approach?

2. **Container User**: The new `jobs` service uses UID 1000:1000. Does this match the user that owns `/srv/media`? Should we verify file permissions?

3. **Node Modules Volume**: Should `node_modules` be a named volume (persistent) or recreated each run? Persistent is faster but may have permission issues.

4. **Script Execution Time**: Some scripts may take 5-10 minutes. Is ephemeral pattern acceptable for long-running jobs, or should we have a separate "long-running jobs" service?

5. **Error Handling**: If an ephemeral job fails mid-execution, how should we handle cleanup? Should failed containers be kept for debugging?

6. **Monitoring**: How should we monitor ephemeral jobs? Current monitoring assumes long-lived containers. Should we add job execution logging?

7. **Development Workflow**: Developers currently use `docker exec payload-dev-scripts-1` for interactive debugging. Should we provide an alternative (e.g., `docker compose run --rm jobs sh`)?

8. **Migration Timeline**: What's the acceptable downtime for cron jobs during migration? Should we run both systems in parallel during transition?

---

### Risks & Edge Cases:

1. **File Permission Issues**: Non-root user (1000:1000) may not have write access to `/srv/media` if owned by different user. Need to verify ownership.

2. **SSH Key Access**: Rsync scripts will fail until SSH key management is resolved. May break cron jobs temporarily.

3. **Container Startup Time**: Ephemeral containers have startup overhead (~5-10 seconds). May affect cron job timing, especially for frequent jobs (every 10 minutes).

4. **State Between Runs**: Ephemeral containers don't preserve state. If scripts rely on cached data or temp files, may need to use volumes or host storage.

5. **Concurrent Execution**: Multiple cron jobs may try to start containers simultaneously. Docker Compose handles this, but need to verify no conflicts.

6. **Resource Limits**: Ephemeral containers may consume resources during execution. Should add resource limits to prevent resource exhaustion.

7. **Network Access**: Ephemeral containers need network access for Payload API and MongoDB. Verify network configuration allows this.

8. **Error Visibility**: Failed ephemeral containers are removed automatically. May make debugging harder. Consider keeping failed containers or improving logging.

---

## 5) DIFFS

**Leave this section empty for this audit-only run.**

No code changes have been made. This is a design proposal only.

---

## 6) LOGS

**No logs for this audit-only run.**

All information gathered through file inspection and codebase analysis.

---

## APPENDIX: Script Classification Reference

### Category A: API/Data Only (Ephemeral Jobs)

**Cron Scripts**:
- `scripts/cron/preair_rehydrate.ts`
- `scripts/cron/postair_archive_cleanup.ts`

**Import Scripts**:
- `scripts/importBatchEpisodes.ts` (needs modification for Docker exec)
- `scripts/importOneEpisode.ts` (needs modification for Docker exec)
- `scripts/import-batch-archives-media.ts`
- `scripts/import-covers-from-local.ts`
- `scripts/import-sc-durations.ts`

**Maintenance Scripts**:
- `scripts/cleanup-imported-files.ts`
- `scripts/cleanup-orphaned-media.ts`
- `scripts/cleanup-unscheduled-files.ts`
- `scripts/hydrate-archive-paths.ts`
- `scripts/hydrate-single-episode.ts`
- `scripts/attach-media-to-episodes.ts`
- `scripts/maintenance/normalize-episodes.ts`
- `scripts/maintenance/test-failed-episodes.ts`

**Database Scripts**:
- `scripts/db/check-indexes.ts`
- `scripts/db/sync-indexes.ts`
- `scripts/db/create-search-indexes-mvp.js`

**Other Scripts**:
- `scripts/export-episodes.ts`
- `scripts/migrate-cover-fields.ts`
- `scripts/reset-mood-field.ts`
- `scripts/update-episodes-publishedAt.ts`

---

### Category B: Requires Docker Control (Host Execution)

**Host-Level Scripts**:
- `scripts/fix-libretime-file-exists.sh` ✅ (already on host)
- `scripts/stream-health-check.sh` ✅ (already on host)

**Scripts Needing Modification**:
- `scripts/importBatchEpisodes.ts` - Remove Docker exec calls, use host wrapper
- `scripts/importOneEpisode.ts` - Remove Docker exec calls, use host wrapper

---

### Host-Only Scripts (No Container Needed)

**System Scripts**:
- `scripts/cron/system_health_guard.sh` ✅ (runs on host)
- `scripts/cron/noon_canary.sh` ✅ (runs on host)

**Monitoring Scripts**:
- `scripts/monitor-docker-malware.sh` ✅ (runs on host)
- `scripts/monitor-malware.sh` ✅ (runs on host)
- `scripts/check-monitoring-status.sh` ✅ (runs on host)

---

**End of Reviewer Pack**

