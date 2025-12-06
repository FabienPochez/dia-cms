# Security Fixes Applied

**Date:** December 6, 2025  
**Status:** ✅ FIXES APPLIED

## Critical Vulnerabilities Fixed

### 1. ✅ Command Injection in `libretimeDb.ts`

**Issue:** `filepath` parameter inserted directly into shell commands with only SQL escaping.

**Fix Applied:**
- Added path validation using `isValidPath()` before processing
- Validates paths contain only safe characters (alphanumeric, `/`, `-`, `_`, `.`)
- Rejects shell metacharacters (`;`, `|`, `&`, `$`, backticks, etc.)
- Rejects command substitution attempts
- Applied to both `updateLibreTimeFileExists()` and `updateLibreTimeFileExistsBatch()`

**Files Changed:**
- `src/server/lib/libretimeDb.ts`
- `src/lib/utils/pathSanitizer.ts` (new utility)

### 2. ✅ Command Injection in `rsyncPull.ts`

**Issue:** `srcArchivePath` and `dstWorkingPath` inserted into bash command with only double quotes.

**Fix Applied:**
- Added path validation using `isValidRelativePath()` before processing
- Validates paths are relative (no leading `/`)
- Prevents directory traversal (`../`)
- Uses shell escaping (`escapeShellArg()`) for extra safety
- Throws `RsyncPullError` with `E_INVALID_PATH` code for invalid paths

**Files Changed:**
- `src/server/lib/rsyncPull.ts`
- `src/lib/utils/pathSanitizer.ts` (new utility)

### 3. ✅ Missing Authentication in `/api/lifecycle/rehydrate`

**Issue:** Endpoint had no authentication check, allowing unauthorized access.

**Fix Applied:**
- Added `checkScheduleAuth()` requiring admin/staff role
- Added rate limiting (10 requests per minute per IP)
- Added disable flag check (`ENABLE_DANGEROUS_ENDPOINTS`)
- Returns 403 for unauthorized requests
- Returns 429 for rate limit exceeded
- Returns 503 if endpoint is disabled

**Files Changed:**
- `src/server/api/lifecycle/rehydrate.ts`

### 4. ✅ Rate Limiting Added

**Implementation:**
- Created in-memory rate limiter (`src/lib/utils/rateLimiter.ts`)
- Tracks requests per IP with sliding window
- Applied to all lifecycle endpoints:
  - `/api/lifecycle/rehydrate` - 10 req/min
  - `/api/lifecycle/preair-rehydrate` - 5 req/min
  - `/api/lifecycle/postair-archive` - 5 req/min

**Files Changed:**
- `src/lib/utils/rateLimiter.ts` (new utility)
- `src/app/api/lifecycle/preair-rehydrate/route.ts`
- `src/app/api/lifecycle/postair-archive/route.ts`
- `src/server/api/lifecycle/rehydrate.ts`

### 5. ✅ Disable Flags Added

**Implementation:**
- All dangerous endpoints check `ENABLE_DANGEROUS_ENDPOINTS` environment variable
- If not set to `'true'`, endpoints return 503 Service Unavailable
- Allows temporary disabling of endpoints during security incidents

**Files Changed:**
- `src/app/api/lifecycle/preair-rehydrate/route.ts`
- `src/app/api/lifecycle/postair-archive/route.ts`
- `src/server/api/lifecycle/rehydrate.ts`

## New Security Utilities

### `pathSanitizer.ts`
- `isValidPath()` - Validates paths contain only safe characters
- `isValidRelativePath()` - Validates relative paths (no traversal)
- `sanitizePath()` - Attempts to sanitize dangerous paths
- `escapeShellArg()` - Escapes paths for shell commands

### `rateLimiter.ts`
- `checkRateLimit()` - Checks if request should be rate limited
- `getClientIp()` - Extracts client IP from request headers
- In-memory store with automatic cleanup

## Security Checklist

- [x] Fixed command injection in `libretimeDb.ts`
- [x] Fixed command injection in `rsyncPull.ts`
- [x] Added authentication to `/api/lifecycle/rehydrate`
- [x] Added rate limiting to all lifecycle endpoints
- [x] Added disable flags for dangerous endpoints
- [x] Created path validation utilities
- [x] Created rate limiting utilities
- [ ] Test all fixes
- [ ] Rebuild and restart application

## Next Steps

1. **Set environment variable** (if you want endpoints enabled):
   ```bash
   ENABLE_DANGEROUS_ENDPOINTS=true
   ```

2. **Rebuild application** to apply fixes:
   ```bash
   docker compose --profile build run --rm payload-build
   docker compose restart payload
   ```

3. **Test endpoints** to ensure they work with authentication

4. **Monitor logs** for any blocked attempts

---

**Status:** ✅ All critical vulnerabilities fixed. Ready for rebuild and deployment.

