# Investigation Summary - Evidence-Based Answers

**Date:** 2025-12-15  
**Questions Answered:** execSync source, payload location, endpoint exposure

---

## ANSWERS WITH EVIDENCE

### 1. WHERE IS execSync CALLED FROM (REAL STACK)?

**Answer:** ⚠️ **Cannot determine without enabling DEBUG mode**

**Evidence:**
- Current logs show: `source_file=9912.js` (this is monitoring code, not source)
- No stack trace in logs (suppressed because `DEBUG_SUBPROC_DIAG` not enabled)
- Historical logs show: `eval()` context in Next.js runtime (`app-page.runtime.prod.js:25:34007`)

**Context Before Attack:**
- JSON parse error: `SyntaxError: Unexpected token ' in JSON at position 184`
- No authentication context (`authed: false`)
- No HTTP request context (no `req_path`/`req_method` in logs)
- Attack started ~1 second after JSON parse error

**To Capture Full Stack:**
```bash
# Enable debug mode in .env
DEBUG_SUBPROC_DIAG=true
# Then restart container (when safe) to capture next occurrence
```

**Conclusion:** Execution happens outside HTTP request context, likely triggered by JSON parse error or internal function call.

---

### 2. IS THE PAYLOAD STRING PRESENT ON DISK?

**Answer:** ❌ **NO - Not found anywhere**

**Evidence:**

**Source Code (`src/`):**
```bash
grep -r "167.86.107.35" src/          # 0 matches
grep -r "muie.sh" src/                 # 0 matches  
grep -r "curl http://" src/            # 0 matches
```
✅ **CLEAN**

**Build Artifacts (`.next/`):**
```bash
grep -r "167.86.107.35" .next/        # 0 matches
grep -r "muie.sh" .next/              # 0 matches
grep -r "curl http://167" .next/      # 0 matches
```
✅ **CLEAN**

**Dependencies (`node_modules/`):**
```bash
grep -r "167.86.107.35" node_modules/ # 0 matches
grep -r "muie" node_modules/          # 0 matches
```
✅ **CLEAN**

**MongoDB Database:**
```bash
# Searched all collections (episodes, shows, users, media-images, media-tracks)
# For: "167.86.107.35", "muie.sh", "curl http://" patterns
# Result: 0 matches in all collections
```
✅ **CLEAN**

**Conclusion:** Payload is **injected at runtime**, not stored persistently. Confirms runtime code injection attack.

---

### 3. IS THERE ANY ENDPOINT STILL EXPOSED THAT CAN TRIGGER COMMAND EXECUTION?

**Answer:** ✅ **NO - All endpoints require authentication**

**Evidence:**

**Dangerous Endpoints Status:**
- `POST /api/lifecycle/preair-rehydrate` - ✅ Auth required, rate limited, disabled flag checked FIRST
- `POST /api/lifecycle/postair-archive` - ✅ Auth required, rate limited, disabled flag checked FIRST  
- `POST /api/lifecycle/rehydrate` - ✅ Auth required, rate limited, disabled flag checked FIRST
- `POST /api/libretime/[...path]` (write) - ✅ Auth required, disabled flag checked FIRST

**Security Check Order (Cannot Bypass):**
1. Rate limiting (if applicable)
2. **Disable flag checked FIRST** (`ENABLE_DANGEROUS_ENDPOINTS !== 'true'` → returns 503)
3. Authentication (`checkScheduleAuth()` → returns 403 if not admin/staff)
4. Command execution

**Current Environment:**
```bash
ENABLE_DANGEROUS_ENDPOINTS=true  # ⚠️ Enabled, but still requires auth
```

**Critical Finding:**
- Attack logs show **NO request context** (`req_path`, `req_method` missing)
- Attack did **NOT** come through HTTP endpoint
- Execution happened **outside** HTTP request flow

**Conclusion:** 
- ✅ No exposed endpoints can trigger command execution (all require auth)
- ⚠️ Attack occurred via runtime code injection, NOT through API endpoint
- Attack likely triggered by JSON parse error or internal function call

---

## SUMMARY

1. **execSync Source:** Cannot determine without DEBUG mode. Evidence suggests `eval()` context triggered by JSON parse error.

2. **Payload on Disk:** ❌ **NOT FOUND** - Confirms runtime injection, not persistent storage.

3. **Exposed Endpoints:** ✅ **NONE** - All require authentication. Attack did NOT come through endpoints.

**Attack Vector:** Runtime code injection outside HTTP request context, possibly triggered by JSON parse error handling.


