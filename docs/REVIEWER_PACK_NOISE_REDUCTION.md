# Reviewer Pack: Subprocess Logging Noise Reduction

**Date:** 2025-12-13  
**Component:** Subprocess Monitoring & Logging (Noise Reduction)  
**Risk Level:** LOW (log severity + noise classification only; no security behavior changes)

---

## 1. SUMMARY

- ✅ **Severity Fix:** `subprocess_log_suppressed` events now use DEBUG (internal) or INFO (others), never WARN/ERROR
- ✅ **Noise Classification:** Added `category` field (`internal`, `media`, `sync`, `unknown`) for filtering
- ✅ **Internal Command Handling:** `git config` commands classified as `internal` and never escalate to WARN
- ✅ **Repeat Escalation:** Skip repeat escalation (WARN threshold) for `category=internal` commands
- ✅ **Documentation:** Updated event severity table and field descriptions with category information
- ✅ **No Behavior Changes:** Core security logic, allowlists, validation, and execution paths unchanged
- ✅ **Minimal Changes:** Only logging metadata and severity classification modified

---

## 2. DIFFS

### Modified: `src/server/lib/subprocessGlobalDiag.ts`

**Key Changes:**

1. **Added `classifyCommandCategory()` function:**
   ```diff
   +/**
   + * Classify command category for noise filtering
   + */
   +function classifyCommandCategory(fullCmd: string): 'internal' | 'media' | 'sync' | 'unknown' {
   +  const cmd = fullCmd.toLowerCase()
   +  if (cmd.startsWith('git config')) {
   +    return 'internal'
   +  }
   +  if (cmd.startsWith('ffprobe') || cmd.startsWith('ffmpeg')) {
   +    return 'media'
   +  }
   +  if (cmd.includes('rsync')) {
   +    return 'sync'
   +  }
   +  return 'unknown'
   +}
   ```

2. **Updated `determineEventType()` to accept category and fix severity:**
   ```diff
   -function determineEventType(..., suppressed: boolean, executionFailed: boolean = false)
   +function determineEventType(..., suppressed: boolean, category: 'internal' | 'media' | 'sync' | 'unknown', executionFailed: boolean = false)
   
   -  if (suppressed) {
   -    return {
   -      event: 'subprocess_log_suppressed',
   -      severity: repeatCount >= REPEAT_WARN_THRESHOLD ? 'WARN' : 'INFO',
   +  if (suppressed) {
   +    const severity = category === 'internal' ? 'DEBUG' : 'INFO'
   +    return {
   +      event: 'subprocess_log_suppressed',
   +      severity,  // Never WARN/ERROR for suppressed events
   ```

3. **Skip repeat escalation for internal commands:**
   ```diff
   -  return {
   -    event: 'subprocess_attempt',
   -    severity: repeatCount >= REPEAT_WARN_THRESHOLD ? 'WARN' : 'INFO',
   +  const severity = category === 'internal' ? 'INFO' : repeatCount >= REPEAT_WARN_THRESHOLD ? 'WARN' : 'INFO'
   +  return {
   +    event: 'subprocess_attempt',
   +    severity,
   ```

4. **Added category classification and inclusion in logs:**
   ```diff
     const fullCmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
     const payloadHash = hashPayload(fullCmd)
     const payloadPreview = createPreview(redactSecrets(fullCmd))
   
   +  // Classify command category for noise filtering
   +  const category = classifyCommandCategory(fullCmd)
   
     const { event, severity, executed, blocked } = determineEventType(
       method,
       command,
       args,
       repeatCount,
       suppressed,
   +    category,
       false,
     )
   
     const logEntry = {
       ...
   +    category,  // internal|media|sync|unknown
       ...
     }
   
     const parts = [
       ...
   +    `category=${logEntry.category}`,
       ...
     ]
   ```

### Modified: `docs/SUBPROC_DIAG_LOGGING.md`

**Updated event severity table:**
```diff
-| Event | Description | executed | blocked | logged | Severity |
+| Event | Description | executed | blocked | logged | category | Severity |
-| `subprocess_log_suppressed` | ... | true | false | false | INFO (WARN if repeated ≥5x) |
+| `subprocess_log_suppressed` | ... | true | false | false | internal/media/sync/unknown | DEBUG (internal) or INFO (others) |
```

**Added category field description:**
```diff
+### Command Fields
+
+- **`category`**: Command category classification:
+  - `internal`: Known internal noise commands (e.g., `git config`) - never escalate to WARN
+  - `media`: Media processing commands (e.g., `ffprobe`, `ffmpeg`)
+  - `sync`: Synchronization commands (e.g., `rsync`)
+  - `unknown`: All other commands
```

**Updated examples:**
```diff
-[SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false reason=log_suppressed method=execSync payload_hash=def456 repeat_count=2
+[SUBPROC_DIAG] event=subprocess_log_suppressed severity=DEBUG executed=true blocked=false logged=false category=internal reason=log_suppressed method=execSync payload_hash=def456 repeat_count=8250
```

---

## 3. LOGS

### Build/Validation

```bash
# TypeScript compilation
# No compilation errors

# Linter check
# No linter errors in:
# - src/server/lib/subprocessGlobalDiag.ts
```

### Expected Runtime Logs

**Before (stressful WARN):**
```
[SUBPROC_DIAG] event=subprocess_log_suppressed severity=WARN executed=true blocked=false logged=false reason=log_suppressed method=execSync payload_hash=cc0b710f9d31d0de payload_preview="git config --local --get remote.origin.u" repeat_count=8250
```

**After (calm DEBUG for internal):**
```
[SUBPROC_DIAG] event=subprocess_log_suppressed severity=DEBUG executed=true blocked=false logged=false category=internal reason=log_suppressed method=execSync payload_hash=cc0b710f9d31d0de payload_preview="git config --local --get remote.origin.u" repeat_count=8250
```

**After (normal allowlisted command):**
```
[SUBPROC_DIAG] event=subprocess_exec_ok severity=INFO executed=true blocked=false logged=true category=media reason=allowlisted method=execFile cmd_allowlisted_name=ffprobe payload_hash=abc123def456 payload_preview="ffprobe -v quiet -print_format json"
```

### Verification Commands

```bash
# Check for internal noise commands (should be DEBUG, not WARN)
docker compose logs payload --tail 50 | grep "category=internal" | grep "severity=WARN"
# Expected: No results (internal commands never WARN)

# Check for log-suppressed events (should be DEBUG/INFO, never WARN)
docker compose logs payload --tail 50 | grep "event=subprocess_log_suppressed" | grep "severity=WARN"
# Expected: No results (suppressed events never WARN)

# Verify category field is present
docker compose logs payload --tail 50 | grep "\[SUBPROC_DIAG\]" | grep "category=" | head -1
# Expected: Log line includes category=internal|media|sync|unknown
```

---

## 4. QUESTIONS & RISKS

### Questions

1. **Category Expansion:** Should we add more categories (e.g., `database` for `psql`, `build` for `npm`/`npx`)? Currently minimal set for noise reduction.

2. **DEBUG vs INFO:** Is `DEBUG` appropriate for internal noise, or should it be `INFO`? Currently `DEBUG` for internal, `INFO` for others.

3. **Category Matching:** Should `git config` matching be more specific (e.g., only `git config --local --get remote.origin.url`) or broader (all `git` commands)? Currently matches all `git config` commands.

4. **Media Category:** Should `ffprobe` and `ffmpeg` be separate categories, or is `media` sufficient? Currently grouped as `media`.

5. **Sync Category:** Should `rsync` matching be exact or case-insensitive? Currently case-insensitive via `toLowerCase()`.

6. **Future Categories:** Should we add a configuration mechanism for categories, or keep it hardcoded? Currently hardcoded for simplicity.

### Risks

1. **Low Risk - Category Misclassification:** Commands may be misclassified if patterns don't match exactly. Mitigation: Simple patterns, easy to extend.

2. **Low Risk - Severity Change:** Changing severity from WARN to DEBUG may hide legitimate issues if misclassified. Mitigation: Only affects suppressed events and internal commands; suspicious commands still escalate.

3. **No Risk - Behavior Unchanged:** Core security logic unchanged; only logging metadata modified.

4. **No Risk - Backward Compatibility:** New `category` field is additive; old log parsers will ignore it.

### Mitigations

1. **Category Classification:** Simple pattern matching with clear rules. Easy to extend if needed.

2. **Severity Logic:** Only affects suppressed events and internal commands. Suspicious commands still escalate to WARN.

3. **Documentation:** Updated docs clearly explain category field and severity rules.

4. **Testing:** Verification commands provided to test new behavior.

---

## 5. TESTING RECOMMENDATIONS

1. **Verify Internal Commands:** Trigger `git config` commands and verify they're `category=internal` and `severity=DEBUG`
2. **Verify Suppressed Events:** Check that suppressed events never use WARN/ERROR severity
3. **Verify Category Field:** Confirm all log entries include `category=` field
4. **Verify Media Commands:** Trigger `ffprobe`/`ffmpeg` and verify `category=media`
5. **Verify Sync Commands:** Trigger `rsync` and verify `category=sync`

---

## 6. DEPLOYMENT NOTES

1. **No Breaking Changes:** Behavior unchanged; only logging metadata improved
2. **Log Format Change:** New `category` field added to all log entries
3. **Severity Change:** Suppressed events and internal commands now use lower severity
4. **Documentation:** Updated docs reflect new category field and severity rules

---

**Reviewer Pack Generated:** 2025-12-13  
**Status:** ✅ Ready for Review

