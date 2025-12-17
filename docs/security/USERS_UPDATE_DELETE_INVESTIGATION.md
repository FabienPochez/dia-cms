# Users.update/delete Investigation

**Date:** 2025-12-15  
**Status:** ✅ **RESOLVED - EXTERNAL PROBING CONFIRMED**  
**Priority:** HIGH  
**Mitigation:** Cloudflare WAF blocking PATCH/DELETE on `/api/users`

## Summary

**CONCLUSION:** The repeated unauthenticated `Users.update` / `Users.delete` events are **external probing attempts**, not Payload internal operations.

They match the **exact prelude of the previous breach** (2025-12-15) and correlate with abnormal Cloudflare traffic volume.

### Key Findings

- **External automated probing** targeting the Users collection
- **Matches exploit chain pattern:** probe → deserialize error → RCE (from previous breach)
- **Traffic volume abnormal:** ~9.8k requests/24h for ~350 visitors (~27 requests/visitor)
- **HTTP semantics don't match internal Payload behavior:**
  - Internal operations are authenticated, include target IDs, hit concrete REST routes
  - Observed events: `authed: false`, `targetId: undefined`, empty body, PATCH/DELETE
- **Path logging confusion:** Logged paths like `/` or `/admin` are artifacts of logging, not proof of internal origin
  - Cloudflare sits in front → real client IP was not logged initially
  - Lack of IP ≠ internal request

## Current Access Control

### Users.update
```typescript
update: ({ req, id }) => {
  const u = req.user as any
  // ... logging ...
  
  // Allow unauthenticated updates for password reset flow
  // Payload's resetPassword operation requires this to update the password
  // The reset token itself provides security (short-lived, single-use)
  if (!u) return true  // ⚠️ Allows unauthenticated updates
  
  if (u.role === 'admin') return true
  return String(u.id) === String(id)
}
```

**Security Note:** Line 90 allows unauthenticated updates (`if (!u) return true`). This is intentional for password reset flows, but could be exploited if:
1. An attacker can bypass reset token validation
2. Payload's internal reset password flow has a vulnerability
3. These are internal Payload operations (not actual HTTP requests)

### Users.delete
```typescript
delete: ({ req, id, doc }) => {
  const user = req.user as any
  // ... logging ...
  if (!user) return false  // ✅ Blocks unauthenticated deletes
  // ...
}
```

**Security Note:** Line 105 correctly blocks unauthenticated deletes.

## Suspicious Characteristics

1. **No target ID**: `id` parameter is `undefined`, suggesting these might be:
   - Collection-level access checks (not document-specific)
   - Payload internal operations during initialization
   - Health checks or validation operations

2. **No request path**: `path` shows root URL, not `/api/users/:id`, suggesting:
   - Internal Payload operations
   - Next.js middleware or initialization
   - Not actual HTTP requests

3. **No IP address**: `remoteIp` is `undefined`, suggesting:
   - Internal operations (no HTTP request)
   - Request context not properly captured
   - Payload's internal API calls

4. **No body**: `bodyPreview: 'no body'` suggests:
   - These are access checks, not actual update/delete operations
   - Payload validating access control during initialization
   - Internal validation operations

## Enhanced Logging Added

Enhanced logging now captures:
- Stack trace (to identify caller)
- User-Agent header
- Referer header
- Header keys (first 10)
- More detailed request context

## Investigation Steps

1. ✅ **Enhanced logging** - Added stack traces and headers
2. ⏳ **Monitor logs** - Wait for next occurrence to see enhanced details
3. ⏳ **Check Payload internals** - Verify if these are internal operations
4. ⏳ **Verify request context** - Check if middleware is capturing context
5. ⏳ **Review password reset flow** - Ensure reset token validation is secure

## Evidence Analysis

### 1. Historical Correlation with Previous Breach ✅

**2025-12-15 Attack Timeline:**
- **17:36:53 UTC / 17:41:24 UTC:** Unauthenticated `Users.update/delete` access checks
- **17:41:25 UTC:** JSON.parse error (`SyntaxError: Unexpected token ' in JSON at position 184`)
- **17:41:26 UTC:** Malicious `execSync` storm (8,247 executions in <1 second)

**Exploit Chain Established:**
```
probe → deserialize error → RCE
```

The same unauthenticated `Users.update/delete` pattern occurred immediately before the breach.

### 2. Traffic Volume Analysis ✅

- **~9.8k requests / 24h** for ~350 visitors
- **~27 requests per visitor** (abnormally high)
- **Very low cache ratio**
- DIA Radio does not have traffic patterns that justify this
- **Classic automated scanning / enumeration pattern**

### 3. HTTP Semantics Don't Match Internal Payload Behavior ✅

**Internal Payload/admin operations:**
- ✅ Are authenticated
- ✅ Include target IDs
- ✅ Hit concrete REST routes (e.g. `/api/users/:id`)

**Observed events:**
- ❌ `authed: false`
- ❌ `targetId: undefined`
- ❌ Empty body
- ❌ PATCH / DELETE without proper context

**Conclusion:** Payload does **not** internally emit unauthenticated PATCH/DELETE against `Users` collection.

### 4. Path Logging Confusion ✅

- Logged paths like `/` or `/admin` are **artifacts of logging**, not proof of internal origin
- **Cloudflare sits in front** → real client IP was not logged initially
- **Lack of IP ≠ internal request**
- Request context capture needs improvement to properly extract Cloudflare headers

## Mitigation Applied ✅

### Cloudflare WAF Rule
- **Blocked:** PATCH/DELETE on `/api/users`
- **Status:** Active and effective
- **Verification:** If this were internal Payload behavior, this rule would break the app (it does not)
- **Result:** 0 occurrences in last 10 minutes (previously ~22 in 6 hours)

### Additional Measures
- ✅ Re-enabled Bot Fight Mode
- ✅ No evidence of successful compromise
- ✅ Server state is clean
- ✅ Subprocess monitoring active and blocking malicious commands

## Recommendations Going Forward

### 1. Treat as Hostile by Default
- **Treat `Users.update/delete` unauthenticated hits as hostile by default**
- Do not assume "internal" without IP + headers
- Edge-layer mitigation (Cloudflare) is the correct response

### 2. Improve IP Logging
- **Fix request context capture** to properly extract Cloudflare headers
- Ensure `CF-Connecting-IP` is captured in access control logging
- Add proper header extraction in `Users.ts` access functions

### 3. Application-Level Hardening
- Application-level subprocess hardening should not be conflated with HTTP probing
- Keep subprocess monitoring active (already working)
- Consider rate limiting at application level as additional defense-in-depth

### 4. Monitoring
- Alert on suspicious patterns (already implemented)
- Monitor Cloudflare analytics for traffic anomalies
- Track unauthenticated access attempts to sensitive endpoints

### Code Changes (If Needed)
```typescript
update: ({ req, id }) => {
  const u = req.user as any
  
  // If no user and no ID, this is likely an internal check - allow it
  if (!u && !id) {
    // Log for investigation but allow (likely Payload internal)
    return true
  }
  
  // If no user but has ID, require reset token validation
  if (!u && id) {
    // Check for reset token in request
    const resetToken = (req as any).body?.resetPasswordToken
    if (!resetToken) {
      console.warn('[SECURITY] Unauthenticated update attempt without reset token:', {
        targetId: id,
        ip: (req as any).ip,
      })
      return false  // Block if no reset token
    }
    // Reset token validation happens in Payload's resetPassword operation
    return true
  }
  
  // Authenticated users
  if (u.role === 'admin') return true
  return String(u.id) === String(id)
}
```

## Conclusion

This activity is:

✅ **External** - Automated probing from external sources  
✅ **Automated** - High request volume (~27 requests/visitor)  
✅ **Payload-aware** - Targeting known vulnerable endpoint pattern  
✅ **Consistent with exploit attempt** - Matches previous breach pattern (probe → deserialize error → RCE)

It is **NOT**:

❌ Payload admin initialization  
❌ Deterministic feed operations  
❌ Sync jobs  
❌ Health checks  
❌ Internal Payload operations

## Action Taken (Correct)

✅ **Blocked the exploit vector at Cloudflare** (edge layer)  
✅ **Re-enabled Bot Fight Mode**  
✅ **No evidence of successful compromise**  
✅ **Server state is clean**  
✅ **Subprocess monitoring active** (would block any RCE attempts)

## Guidance Going Forward

1. **Treat `Users.update/delete` unauthenticated hits as hostile by default**
2. **Do not assume "internal" without IP + headers**
3. **Edge-layer mitigation (Cloudflare) is the correct response**
4. **Application-level subprocess hardening should not be conflated with HTTP probing**

The Cloudflare WAF rule blocking PATCH/DELETE on `/api/users` is the appropriate mitigation. The application-level subprocess monitoring provides defense-in-depth against any successful exploitation attempts.

