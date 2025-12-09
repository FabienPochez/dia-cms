# Security Constraints and Guidelines

**Last Updated:** 2025-12-09  
**Status:** Active Security Policy

## Overview

This document outlines security constraints for command execution, script execution patterns, and endpoint access controls in the Payload CMS application.

---

## Command Execution Patterns

### Safe Patterns

#### ✅ `execFile()` with Array Arguments
**Pattern:** Use `execFile()` with command and arguments as separate array elements.

**Example:**
```typescript
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Safe: Arguments passed as array
await execFileAsync('psql', [
  '-h', LIBRETIME_DB_HOST,
  '-U', LIBRETIME_DB_USER,
  '-d', LIBRETIME_DB_NAME,
  '-c', sqlQuery,
], { env: { PGPASSWORD: password } })
```

**Why Safe:** No shell interpretation - arguments are passed directly to the executable.

**Used In:**
- `src/server/lib/libretimeDb.ts` - PostgreSQL queries
- `src/app/api/lifecycle/postair-archive/route.ts` - Docker compose commands
- `src/utils/audioValidation.ts` - ffprobe commands
- `src/lib/schedule/deterministicFeed.ts` - ffprobe commands

---

### Dangerous Patterns (DO NOT USE)

#### ❌ `exec()` with String Interpolation
**Pattern:** Building shell commands with string interpolation.

**Example (DANGEROUS):**
```typescript
const command = `psql -c "UPDATE files SET exists = true WHERE path = '${filepath}';"`
await execAsync(command)
```

**Why Dangerous:** Shell interprets the string, allowing command injection if `filepath` contains shell metacharacters.

**Status:** All instances have been replaced with `execFile()`.

---

## Script Execution Context

### Host-Only Scripts

Some scripts **MUST** run on the host, not inside containers:

#### `rsyncPull()` Function
**Location:** `src/server/lib/rsyncPull.ts`

**Constraint:** Cannot be executed from inside the Payload container.

**Why:**
1. Container doesn't have SSH access to `bx-archive` server
2. Container is Alpine-based and doesn't have `bash` (script requires bash)
3. SSH keys are only available on the host

**Implementation:**
- Function detects if running inside container
- Throws `RsyncPullError` with `E_EXECUTION_BLOCKED` if called from container
- Only executes on host where bash and SSH keys are available

**Allowed Callers:**
- Host-side cron jobs (`scripts/cron/preair_rehydrate.ts`, `scripts/cron/postair_archive_cleanup.ts`)
- Host-side scripts executed directly

**Blocked Callers:**
- API endpoints running inside Payload container
- Any code executing inside Docker containers

**Example Usage (Host-Side Only):**
```typescript
// ✅ OK: Called from cron script running on host
await rsyncPull('legacy/file.mp3', 'imported/1/file.mp3')

// ❌ BLOCKED: Called from API endpoint inside container
// Throws: RsyncPullError('E_EXECUTION_BLOCKED', '...')
```

---

### Container-Safe Scripts

These scripts can safely run inside containers:

#### `updateLibreTimeFileExists()` Function
**Location:** `src/server/lib/libretimeDb.ts`

**Constraint:** Can run from both host and container.

**Implementation:**
- Uses `execFile()` with array arguments (safe)
- Detects execution context (container vs host)
- Uses `psql` TCP connection from container
- Uses `docker exec` from host

**Allowed Callers:**
- API endpoints (inside container)
- Cron scripts (on host)
- Any code path

---

## Endpoint Access Controls

### Dangerous Endpoints

Certain endpoints require explicit enablement via environment variable:

**Environment Variable:** `ENABLE_DANGEROUS_ENDPOINTS`

**Default:** `false` (endpoints disabled)

**Endpoints:**
- `POST /api/lifecycle/preair-rehydrate` - Manual pre-air rehydration trigger
- `POST /api/lifecycle/postair-archive` - Manual post-air archive trigger

**Security Checks:**
1. Rate limiting (5 requests per minute per IP)
2. Authentication required (admin/staff only)
3. Disable flag check (`ENABLE_DANGEROUS_ENDPOINTS !== 'true'`)

**When to Enable:**
- After verifying all security fixes are in place
- When manual triggers are needed for operational purposes
- With active monitoring in place

**When to Disable:**
- During security incidents
- When investigating suspicious activity
- As default state for production

---

## Path Validation

All file paths used in shell commands must be validated:

### Validation Functions

**Location:** `src/lib/utils/pathSanitizer.ts`

**Functions:**
- `isValidPath(filepath: string): boolean` - Validates absolute or relative paths
- `isValidRelativePath(filepath: string): boolean` - Validates relative paths only
- `escapeShellArg(arg: string): string` - Escapes shell arguments (for host-side use only)

**Validation Rules:**
- Rejects shell metacharacters: `;`, `|`, `&`, `` ` ``, `$`, `()`, `{}`
- Rejects command substitution attempts
- Rejects directory traversal (`../`)
- Allows safe characters: alphanumeric, `/`, `-`, `_`, `.`

**Usage:**
```typescript
import { isValidPath } from '@/lib/utils/pathSanitizer'

if (!isValidPath(filepath)) {
  throw new Error('Invalid filepath: contains dangerous characters')
}
```

---

## Cron Jobs

### Execution Pattern

All cron jobs use the **ephemeral container pattern**:

```bash
docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/cron/script.ts'
```

**Benefits:**
- Container is created fresh for each run
- No persistent state between runs
- Reduced attack surface
- Automatic cleanup after completion

### Current Cron Jobs

1. **Pre-air Rehydrate** (`preair_rehydrate.ts`)
   - Schedule: Every 15 minutes
   - Purpose: Ensure working files ready for scheduled episodes
   - Uses: `rsyncPull()` (host-side), `updateLibreTimeFileExists()` (container-safe)

2. **Post-air Archive** (`postair_archive_cleanup.ts`)
   - Schedule: Every 10 minutes
   - Purpose: Archive aired episodes and cleanup working files
   - Uses: `rsyncPull()` (host-side), `updateLibreTimeFileExists()` (container-safe)

---

## Monitoring

### Command Execution Monitor

**Script:** `scripts/monitor-command-execution.sh`

**Purpose:** Alert on suspicious command patterns in Payload logs.

**Monitored Patterns:**
- `curl -s -k` (suspicious curl flags)
- `wget --no-check-certificate` (suspicious wget flags)
- Known malicious domains (`repositorylinux.info`, attacker IPs)
- Suspicious exec() calls with URLs

**Usage:**
```bash
# Run as background service
nohup /srv/payload/scripts/monitor-command-execution.sh > /dev/null 2>&1 &

# Or add to systemd/cron for continuous monitoring
```

**Alert File:** `/var/log/command-execution-alerts.log`

---

## Security Checklist

Before re-enabling dangerous endpoints or cron jobs:

- [ ] All `exec()` calls replaced with `execFile()`
- [ ] Path validation in place for all user inputs
- [ ] `rsyncPull()` blocked from container execution
- [ ] Monitoring scripts active
- [ ] No malicious patterns in logs for 1+ hour
- [ ] Codebase scanned for hardcoded malicious URLs
- [ ] All fixes tested and verified

---

## Incident Response

If suspicious activity detected:

1. **Immediately disable dangerous endpoints:**
   ```bash
   echo "ENABLE_DANGEROUS_ENDPOINTS=false" >> /srv/payload/.env
   docker compose -f /srv/payload/docker-compose.yml restart payload
   ```

2. **Disable cron jobs:**
   ```bash
   sudo crontab -l | grep -v "preair_rehydrate\|postair_archive_cleanup" | sudo crontab -
   ```

3. **Check logs:**
   ```bash
   docker logs payload-payload-1 | grep -E "curl|wget|repositorylinux"
   tail -100 /var/log/command-execution-alerts.log
   ```

4. **Investigate source:**
   - Check for malicious data in MongoDB
   - Check LibreTime database for malicious filepaths
   - Review recent code changes
   - Check for unauthorized API access

---

## References

- Security Incident Report: `docs/SECURITY_INCIDENT_REPORT.md`
- Critical Vulnerabilities Found: `docs/CRITICAL_VULNERABILITIES_FOUND.md`
- Security Fixes Applied: `docs/SECURITY_FIXES_APPLIED.md`
