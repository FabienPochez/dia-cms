# Jobs v2 Secure Redesign Implementation Plan

## Overview
Replace the vulnerable `dev-scripts` long-lived container with a secure ephemeral `jobs` service. Migrate cron jobs to use `docker compose run --rm jobs` pattern, ensuring no docker.sock access, read-only repository mounts, and proper file permissions.

## Implementation Steps

### 1. Add New `jobs` Service to docker-compose.yml

**File**: `docker-compose.yml`

Add new service after `payload-build` service (before `dev-scripts`):

```yaml
  jobs:
    image: node:18-alpine
    restart: "no"  # Ephemeral - never auto-restart
    working_dir: /app
    user: "1000:1000"  # Non-root user
    volumes:
      - .:/app:ro  # Read-only repository mount
      - /srv/media:/srv/media:rw  # Read-write media access
      - jobs_node_modules:/app/node_modules  # Named volume for dependencies
    command:
      - sh
      - -c
      - "echo jobs image ready"  # No-op; cron overrides via `run --rm`
    env_file:
      - .env
    networks:
      - default
      - libretime_default  # Keep if scripts call LibreTime directly
```

**CRITICAL**: YAML indentation must match existing services. List items under `volumes`, `command`, `env_file`, and `networks` are indented 6 spaces total (2 for the key level + 4 for list items).

Add volume to volumes section:

```yaml
volumes:
  data:
  node_modules:
  jobs_node_modules:  # New volume for jobs service
```

**Key Security Features**:
- Alpine-based image (smaller attack surface)
- Read-only repository mount (`:ro`) - prevents source code modification
- No docker.sock mount - prevents container escape
- No SSH mount - SSH handled via host-level wrapper
- Ephemeral pattern (restart: "no") - containers auto-cleanup after execution
- Non-root user (1000:1000) - matches `/srv/media` ownership
- Named volume for node_modules - faster subsequent runs, isolated dependencies

**Notes**:
- When Node version is bumped to 20 LTS, remember to update `jobs` service image to `node:20-alpine`
- `libretime_default` network kept if scripts call LibreTime directly; can be removed if not needed

---

### 2. Verify and Fix File Permissions

**Action**: Verify `/srv/media` ownership matches container user (1000:1000)

**Current Status**: `/srv/media` is already owned by 1000:1000 ✅

**If needed** (only if ownership differs):
```bash
chown -R 1000:1000 /srv/media
```

**Note**: `/srv/payload` ownership (501:staff) is fine since we're mounting it read-only.

---

### 3. Initialize jobs_node_modules Volume

**Action**: Populate the named volume with dependencies

**Command**:
```bash
cd /srv/payload
docker compose run --rm jobs npm ci
```

This will:
- Create the `jobs_node_modules` volume
- Install all dependencies into the volume
- Make subsequent ephemeral runs faster (volume persists)

---

### 4. Update Cron Jobs to Use Ephemeral Pattern

**File**: `/etc/crontab`

**Current Pattern** (long-lived container):
```bash
docker compose -f /srv/payload/docker-compose.yml exec -T dev-scripts sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'
```

**New Pattern** (ephemeral container):
```bash
docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'
```

**Changes Required**:

1. **Pre-air Rehydrate** (line ~1251):
   - Change: `exec -T dev-scripts` → `run --rm jobs`
   - Keep: Same script path, same logging

2. **Post-air Archive** (line ~1255):
   - Change: `exec -T dev-scripts` → `run --rm jobs`
   - Keep: Same script path, same logging

**Note**: Other cron jobs (`fix-libretime-file-exists.sh`, `stream-health-check.sh`, `system_health_guard.sh`, `noon_canary.sh`) already run on host and don't need changes.

**Cron Overlap Note**: Current schedules (preair every 15m, postair every 10m) don't overlap. If overlap becomes an issue later, add lockfile mechanism to scripts.

---

### 5. Verify rsyncPull.ts Works with Ephemeral Pattern

**File**: `src/server/lib/rsyncPull.ts`

**Current Implementation**: Already calls host script directly (line 80):
```typescript
const hostCmd = `bash ${escapeShellArg(scriptPath)} ${escapedSrc} ${escapedDst}`
```

**Status**: ✅ No changes needed - script already runs on host where SSH keys are available.

**Verification**: The `rsync_pull.sh` script runs on the host (not in container), so it has access to SSH keys. The TypeScript code calls it directly via `execAsync(hostCmd)`, which executes on the host where the container is running.

---

### 6. Update Documentation

**Files to Update**:

1. **README.md**:
   - Replace all `docker exec payload-dev-scripts-1` references with `docker compose run --rm jobs`
   - Update cron job examples
   - Update development workflow section

2. **docs/JOBS_V2_REDESIGN_REVIEWER_PACK.md**:
   - Add implementation notes section
   - Document migration completion

3. **CHANGELOG.md**:
   - Add entry documenting the migration from dev-scripts to jobs service

**Key Documentation Updates**:
- Development workflow: `docker compose run --rm jobs sh` replaces `docker exec payload-dev-scripts-1 sh`
- Manual script execution: Use `docker compose run --rm jobs sh -lc 'npx tsx scripts/...'`
- Cron jobs: Updated to use ephemeral pattern

---

### 7. Test Ephemeral Jobs

**Test Commands**:

1. **Test container starts**:
   ```bash
   docker compose run --rm jobs echo "Container works"
   ```

2. **Test TypeScript execution**:
   ```bash
   docker compose run --rm jobs sh -lc 'npx tsx --version'
   ```

3. **Test cron scripts manually**:
   ```bash
   # Test preair
   docker compose run --rm jobs sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'
   
   # Test postair
   docker compose run --rm jobs sh -lc 'npx tsx scripts/cron/postair_archive_cleanup.ts'
   ```

4. **Test rsync (should work via host script)**:
   ```bash
   docker compose run --rm jobs sh -lc 'npx tsx -e "import { rsyncPull } from \"./src/server/lib/rsyncPull\"; rsyncPull(\"test/path\", \"test/dest\").then(console.log).catch(console.error)"'
   ```

---

### 8. Remove dev-scripts Service

**File**: `docker-compose.yml`

**Action**: Remove entire `dev-scripts` service definition (lines 94-115)

**After Removal**: The service will no longer be defined, and any references to it will fail gracefully.

**Cleanup**:
- Old container will remain stopped (already stopped)
- Can be manually removed: `docker rm payload-dev-scripts-1` (optional)

---

### 9. Update CHANGELOG.md

**File**: `CHANGELOG.md`

**Add Entry**:
```markdown
## [2025-12-08] - Security: Migrate to Ephemeral Jobs Pattern

### Security
- **Ephemeral Jobs Service** – Replaced vulnerable `dev-scripts` long-lived container with secure ephemeral `jobs` service. New service uses Alpine-based image, read-only repository mounts, no docker.sock access, and runs on-demand only.
  - **New Service**: `jobs` service in docker-compose.yml
  - **Pattern**: `docker compose run --rm jobs` (ephemeral, auto-cleanup)
  - **Security**: Read-only repository mount, no docker.sock, non-root user
  - **Performance**: Named volume for node_modules (faster subsequent runs)

### Changed
- **Cron Jobs** – Updated preair_rehydrate and postair_archive_cleanup cron jobs to use ephemeral `jobs` service instead of long-lived `dev-scripts` container
- **Development Workflow** – Replaced `docker exec payload-dev-scripts-1` with `docker compose run --rm jobs` for interactive development

### Removed
- **dev-scripts Container** – Removed vulnerable long-lived container that had full write access to repository and was identified as attack vector
```

---

## Implementation Order

**Execution Sequence** (follow this order):

1. ✅ Add `jobs` service to docker-compose.yml
2. ✅ Add `jobs_node_modules` volume to volumes section
3. ✅ Verify file permissions (`/srv/media` should be 1000:1000 - already correct)
4. ✅ Initialize node_modules volume: `docker compose run --rm jobs npm ci`
5. ✅ Smoke tests:
   - `docker compose run --rm jobs echo "test"`
   - `docker compose run --rm jobs sh -lc 'npx tsx --version'`
   - `docker compose run --rm jobs sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'` (manual test)
   - `docker compose run --rm jobs sh -lc 'npx tsx scripts/cron/postair_archive_cleanup.ts'` (manual test)
6. ✅ Update cron jobs in `/etc/crontab` (switch to `run --rm jobs`)
7. ✅ Test preair/postair manually from cron line:
   - Copy-paste the full cron command (including redirects) into a shell
   - Example: `/usr/bin/flock -n /tmp/dia-preair.lock docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts' >> /var/log/dia-cron/preair-rehydrate.log 2>&1`
   - Watch the log file (`tail -f /var/log/dia-cron/preair-rehydrate.log`) not just stdout
   - Repeat for postair cron command
8. ✅ **Only after successful testing**: Remove `dev-scripts` service from docker-compose.yml
9. ✅ Update documentation (README.md, CHANGELOG.md)
10. ✅ Final verification: Monitor cron jobs for 1-2 cycles to ensure stability

**Note**: Do not remove `dev-scripts` until cron jobs are confirmed working with new `jobs` service.

---

## Rollback Plan

**IMPORTANT**: Re-enabling `dev-scripts` is **LAST RESORT ONLY**. Prefer these options first:

**Preferred Rollback Steps** (in order):
1. **Git revert**: `git revert` the compose + crontab changes
2. **Hetzner snapshot**: Restore from snapshot if available
3. **Fix jobs service**: Debug and fix the `jobs` service issue (preferred)

**Last Resort Only** (if above options unavailable and urgent fix needed):
- **Prerequisites**: Verify MongoDB is localhost-only, firewall is tight, and you really need a hotfix
- Revert cron job changes in `/etc/crontab` (change back to `exec -T dev-scripts`)
- Re-add `dev-scripts` service to docker-compose.yml
- Start dev-scripts: `docker compose up -d dev-scripts`
- **Plan**: Fix `jobs` service and migrate back ASAP

**Note**: The `dev-scripts` container was identified as the attack vector. Only re-enable if absolutely necessary and with full security awareness.

---

## Verification Checklist

- [ ] `jobs` service defined in docker-compose.yml with correct YAML indentation (6 spaces for list items)
- [ ] `jobs_node_modules` volume created and populated
- [ ] File permissions verified (1000:1000 for /srv/media)
- [ ] Smoke tests pass (echo, tsx --version, both cron scripts)
- [ ] Cron jobs updated to use `run --rm jobs`
- [ ] Cron jobs execute successfully (test manually from cron line with log monitoring)
- [ ] Documentation updated (README.md, CHANGELOG.md)
- [ ] `dev-scripts` service removed (only after verification)
- [ ] Final monitoring: cron jobs run successfully for 1-2 cycles





