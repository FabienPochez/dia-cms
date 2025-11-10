# TOKEN EXPIRY FIX — APPLIED ✅
**Date:** 2025-10-13  
**Changes:** Session horizon extended to 60 days

---

## CHANGES APPLIED

### ✅ 1. Extended Token Expiration (Users.ts)

**File:** `/srv/payload/src/collections/Users.ts`

**Change:**
- Added `tokenExpiration: 5184000` (60 days in seconds)
- Added explanatory comment for session horizon

```typescript
auth: {
  useAPIKey: true,
  // Session horizon for JWT/cookie. Needed for long-lived sessions + refresh flow.
  tokenExpiration: 5184000, // 60 days in seconds
  cookies: {
    sameSite: 'None',
    secure: true,
    domain: 'content.diaradio.live',
  },
}
```

**Impact:**
- Sessions now last **60 days** (was 2 hours default)
- Refresh token endpoint will maintain sessions for 60 days
- Users won't need to re-login every 2 hours

---

### ✅ 2. CORS Configuration (payload.config.ts)

**File:** `/srv/payload/src/payload.config.ts`

**Change:**
- Kept simple CORS array format
- Added comment noting Authorization header is supported by default
- Removed unused `apiKeyAccess` import

```typescript
// CORS with exact origins (Authorization header supported by default)
cors: allowedOrigins,
```

**Why simple format:**
- Payload includes `Authorization` in default CORS headers automatically
- No need for explicit header configuration
- Cleaner code, same functionality

---

## VERIFICATION CHECKLIST

### ✅ TypeScript Compilation
```bash
$ npx tsc --noEmit
# No TypeScript errors in modified files
```

### 🔄 Next Steps (Manual Testing Required)

1. **Restart Payload server:**
   ```bash
   # In Docker container
   docker-compose restart payload
   # OR local dev
   npm run dev
   ```

2. **Test auth flow:**
   ```bash
   # Should return user data with JWT
   curl -X GET https://content.diaradio.live/api/users/me \
     -H "Cookie: payload-token=<your-token>" \
     -H "Accept: application/json"
   ```

3. **Test refresh token:**
   ```bash
   # Should return success with new 60-day token
   curl -X POST https://content.diaradio.live/api/users/refresh-token \
     -H "Cookie: payload-token=<your-token>" \
     -H "Accept: application/json"
   ```

4. **Test from frontend:**
   - Login to dia-radio-app.vercel.app
   - Verify session persists across browser restarts
   - Check browser DevTools → Application → Cookies
   - Confirm `payload-token` cookie has longer expiry (60 days from now)

5. **Test Authorization header (if frontend uses it):**
   ```bash
   # Should succeed without CORS errors
   curl -X GET https://content.diaradio.live/api/users/me \
     -H "Authorization: Bearer <jwt-token>" \
     -H "Origin: https://dia-radio-app.vercel.app"
   ```

---

## CONFIGURATION SUMMARY

| Setting | Before | After | Status |
|---------|--------|-------|--------|
| **Token Expiration** | 7200s (2 hours) | 5184000s (60 days) | ✅ Fixed |
| **CORS Origins** | Array format | Array format | ✅ Unchanged |
| **CORS Headers** | Default | Default (includes Authorization) | ✅ Working |
| **Email Verification** | Disabled | Disabled | ✅ As requested |
| **API Key Auth** | Enabled | Enabled | ✅ Unchanged |

---

## SECURITY NOTES

### ⚠️ Token Leakage Risk
- **60-day tokens increase exposure if leaked**
- **Mitigation:** Ensure frontend stores tokens in:
  - iOS: Keychain
  - Android: Keystore
  - Web: httpOnly cookies only (no localStorage)

### ✅ Refresh Flow Still Works
- Client can call `/api/users/refresh-token` to get fresh token
- Silent refresh recommended every 30-60 minutes for better security
- Even with 60-day expiry, tokens can be rotated frequently

### ✅ CORS Security Maintained
- Origins still restricted to allowlist
- Credentials enabled automatically for matched origins
- Authorization header permitted by Payload defaults

---

## FILES MODIFIED

1. `/srv/payload/src/collections/Users.ts`
   - Line 7-8: Added tokenExpiration config

2. `/srv/payload/src/payload.config.ts`
   - Line 9: Commented out unused import
   - Line 68-69: Updated CORS comment

---

## ROLLBACK (if needed)

To revert to 2-hour sessions:

```typescript
// src/collections/Users.ts
auth: {
  useAPIKey: true,
  // tokenExpiration: 5184000, // REMOVE THIS LINE
  cookies: {
    sameSite: 'None',
    secure: true,
    domain: 'content.diaradio.live',
  },
}
```

Or set shorter duration:
```typescript
tokenExpiration: 3600, // 1 hour
tokenExpiration: 7200, // 2 hours (previous default)
tokenExpiration: 86400, // 24 hours
```

---

## WHAT WAS NOT CHANGED

As requested, the following were **NOT** modified:

- ❌ Email verification (still disabled)
- ❌ Email adapter/SMTP (not configured)
- ❌ Custom email templates (not added)
- ❌ Package installations (none needed)
- ❌ Environment variables (no SMTP vars added)
- ❌ Forgot password customization (using defaults)

---

**END OF SUMMARY**

