# Reviewer Pack: Preserved Originals Implementation

**Date:** 2025-12-16  
**Status:** Implementation complete, but error persists

---

## SUMMARY

- ✅ Added `globalThis.__DIA_ORIG_CP` storage in `subprocessGlobalDiag.ts` before patching
- ✅ Updated `subprocessDiag.ts` to use preserved originals from `globalThis.__DIA_ORIG_CP`
- ✅ Made originals access lazy (called when needed, not at module load)
- ✅ Fixed `execAsync` to use 2-arg signature when options is undefined
- ❌ Error persists: `ERR_INVALID_ARG_TYPE: callback must be function, received Object`
- ⚠️ Stored original is native (`name: "exec"`), but still goes through security block when called directly
- ⚠️ Root cause: Native `exec` internally calls `module.exports.execFile`, which we patched

---

## DIFFS

### File: `src/server/lib/subprocessGlobalDiag.ts`

**Lines 813-821:** Store originals in globalThis before patching

```diff
+// CRITICAL: Store originals globally BEFORE patching so other modules can access true originals
+// This ensures subprocessDiag.ts and other modules can use unpatched exec/execFile
+;(globalThis as any).__DIA_ORIG_CP = {
+  exec: originalExec,
+  execFile: originalExecFile,
+  execSync: originalExecSync,
+  spawn: originalSpawn,
+  spawnSync: originalSpawnSync,
+}
+
 // Check if patching is disabled via environment variable
```

### File: `src/server/lib/subprocessDiag.ts`

**Lines 1-54:** Complete rewrite to use preserved originals

```diff
-import { exec as cpExec, execFile as cpExecFile, ExecFileOptions, ExecOptions } from 'child_process'
+// CRITICAL: Use preserved originals from globalThis to guarantee true native exec/execFile
+// This ensures we never use patched versions, regardless of import order
 import { promisify } from 'util'
+import type { ExecFileOptions, ExecOptions } from 'node:child_process'
+
+// Get preserved originals from globalThis (set by subprocessGlobalDiag.ts before patching)
+// CRITICAL: Call lazily (not at module load) to ensure globalThis is set
+const getOriginalExec = () => {
+  const orig = (globalThis as any).__DIA_ORIG_CP
+  if (!orig || !orig.exec) {
+    throw new Error(
+      'subprocessDiag: __DIA_ORIG_CP.exec not found. Ensure subprocessGlobalDiag.ts loads first.',
+    )
+  }
+  return orig.exec
+}
+
+const getOriginalExecFile = () => {
+  const orig = (globalThis as any).__DIA_ORIG_CP
+  if (!orig || !orig.execFile) {
+    throw new Error(
+      'subprocessDiag: __DIA_ORIG_CP.execFile not found. Ensure subprocessGlobalDiag.ts loads first.',
+    )
+  }
+  return orig.execFile
+}
+
+// execAsync: properly handle options parameter with manual promise wrapper
+// Uses true original exec (not patched) to avoid recursion and argument misinterpretation
+// CRITICAL: Use 2-arg signature when options is undefined to avoid edge cases
 const execAsync = (command: string, options?: ExecOptions) => {
   return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
-    cpExec(command, options, (error, stdout, stderr) => {
+    // Get original exec lazily (ensures globalThis is set)
+    const originalExec = getOriginalExec()
+    // Use 2-arg signature (cmd, cb) when options is undefined, 3-arg (cmd, opts, cb) when provided
+    if (options) {
+      originalExec(command, options, (error, stdout, stderr) => {
+        if (error) {
+          reject(error)
+        } else {
+          resolve({ stdout, stderr })
+        }
+      })
+    } else {
+      originalExec(command, (error, stdout, stderr) => {
+        if (error) {
+          reject(error)
+        } else {
+          resolve({ stdout, stderr })
+        }
+      })
+    }
+  })
+}
+
+-const execFileAsync = promisify(cpExecFile)
+// Use promisify on original (not patched) to avoid recursion
+// Get original execFile lazily (ensures globalThis is set)
+const execFileAsync = promisify(getOriginalExecFile())
```

**Line 92:** Type assertion fix

```diff
-  return execAsync(command, options)
+  return execAsync(command, options as ExecOptions | undefined)
```

---

## Cron A Run Log Excerpt (Current Failure)

**Run Date:** 2025-12-16 17:45:09 UTC

```
[SUBPROC_DIAG] {"ts":"2025-12-16T17:45:09.564Z","context":"rsyncPull.host","cmd":"bash '/app/scripts/sh/archive/rsync_pull.sh' 'legacy/6882659cba767f41743cab3f__zaltan-03-07-20__zalta.mp3' 'imported/1/6882659cba767f41743cab3f__zaltan-03-07-20__zalta.mp3'","stack":""}
[RSYNCPULL] Error on attempt 1: {
  message: 'The "callback" argument must be of type function. Received an instance of Object',
  code: 'ERR_INVALID_ARG_TYPE',
  stdout: undefined,
  stderr: undefined
}
⚠️  Rsync failed (attempt 1/3), retrying in 3s...
```

**Status:** ❌ Still failing with same error

**Investigation Results:**
- ✅ `globalThis.__DIA_ORIG_CP.exec` exists and is native (`name: "exec"`, not `"patchedExec"`)
- ⚠️ Direct call to stored original still goes through security block (because native `exec` internally calls patched `execFile`)
- ❌ Error persists: suggests argument passing issue, not just security block

**Next Steps:**
- Need to investigate why native `exec` is receiving Object as callback
- May need to create isolated wrapper that doesn't call patched `execFile`
- Or bypass `diagExec` entirely in `rsyncPull.ts` and call native exec directly

---

**End of Reviewer Pack**









