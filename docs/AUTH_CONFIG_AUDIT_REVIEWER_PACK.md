# AUTH CONFIG AUDIT — REVIEWER PACK
**Date:** 2025-10-13  
**Auditor:** Cursor AI  
**Scope:** Payload CMS Authentication & Server Config  
**Status:** ⚠️ MULTIPLE CRITICAL GAPS IDENTIFIED

---

## 1. SUMMARY

### ❌ Critical Missing Configurations
- **NO email adapter configured** — email/SMTP completely absent from `payload.config.ts`
- **NO email verification enabled** — `auth.verify` not set (defaults to `false`)
- **SHORT token expiration** — Using default `7200s` (2 hours), target is 30-90 days for sessions
- **NO custom email templates** — No `generateEmailHTML` or `generateEmailSubject` hooks for verify/reset flows
- **Missing SMTP env vars** — No `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` in `.env`

### ✅ What's Working
- **Refresh endpoint exists** — Payload built-in `/api/users/refresh-token` available (auto-enabled)
- **API Key auth enabled** — `useAPIKey: true` in Users collection
- **Secure cookies configured** — `sameSite: 'None'`, `secure: true`, correct domain
- **Minimal JWT payload** — Only `role` field has `saveToJWT: true` ✓
- **CORS configured** — Allowlist includes frontend origins (dia-radio-app.vercel.app)

### 🟡 Potential Issues
- **No Authorization header in CORS** — Only domain-based CORS, no explicit header allowlist
- **Forgot password enabled by default** — But unusable without email adapter
- **Lock time: 10 min** — Default `maxLoginAttempts: 5`, `lockTime: 600000ms` (acceptable)
- **No custom hooks** — No auth flow overrides detected (good for security)

---

## 2. DIFFS (PROPOSED — NOT APPLIED)

### Diff 1: Add Email Adapter to `payload.config.ts`

```diff
--- a/src/payload.config.ts
+++ b/src/payload.config.ts
@@ -1,4 +1,5 @@
 // storage-adapter-import-placeholder
+import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
 import { mongooseAdapter } from '@payloadcms/db-mongodb'
 import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
 import { lexicalEditor } from '@payloadcms/richtext-lexical'
@@ -58,6 +59,20 @@ export default buildConfig({
   sharp,
   plugins: [
     payloadCloudPlugin(),
+  ],
+
+  // Email configuration for auth flows
+  email: nodemailerAdapter({
+    defaultFromAddress: process.env.SMTP_FROM_ADDRESS || 'noreply@diaradio.live',
+    defaultFromName: 'DIA Radio',
+    transportOptions: {
+      host: process.env.SMTP_HOST,
+      port: Number(process.env.SMTP_PORT) || 587,
+      auth: {
+        user: process.env.SMTP_USER,
+        pass: process.env.SMTP_PASS,
+      },
+    },
   }),
 
   media: {
```

### Diff 2: Enable Email Verification in `Users.ts`

```diff
--- a/src/collections/Users.ts
+++ b/src/collections/Users.ts
@@ -5,11 +5,31 @@ export const Users: CollectionConfig = {
   auth: {
     useAPIKey: true,
-    // keep auth enabled for admin users
-    // set cookie attributes here as the single source of truth
+    tokenExpiration: 5184000, // 60 days (in seconds)
+    verify: {
+      generateEmailHTML: ({ token, user }) => {
+        const verifyURL = `https://dia-radio-app.vercel.app/verify?token=${token}`
+        return `
+          <h1>Welcome to DIA Radio!</h1>
+          <p>Please verify your email address by clicking the link below:</p>
+          <a href="${verifyURL}">${verifyURL}</a>
+          <p>This link will expire in 24 hours.</p>
+        `
+      },
+      generateEmailSubject: () => 'Verify your DIA Radio account',
+    },
+    forgotPassword: {
+      generateEmailHTML: ({ token, user }) => {
+        const resetURL = `https://dia-radio-app.vercel.app/reset-password?token=${token}`
+        return `
+          <h1>Reset Your Password</h1>
+          <p>Click the link below to reset your password:</p>
+          <a href="${resetURL}">${resetURL}</a>
+          <p>If you didn't request this, please ignore this email.</p>
+        `
+      },
+      generateEmailSubject: () => 'Reset your DIA Radio password',
+    },
     cookies: {
       sameSite: 'None',
       secure: true,
```

### Diff 3: Add SMTP Environment Variables

**Create or update `.env`:**

```diff
+# Email/SMTP Configuration
+SMTP_HOST=smtp.resend.com
+SMTP_PORT=587
+SMTP_USER=resend
+SMTP_PASS=re_your_api_key_here
+SMTP_FROM_ADDRESS=noreply@diaradio.live
+
 DATABASE_URI=mongodb://mongo:27017/dia-cms
 PAYLOAD_SECRET=2dada6f02780cbeec7a7f968
 PAYLOAD_API_KEY=Z7kR3pV9tXyLqF2sMbN8aC1eJhGdUwYo
```

### Diff 4: Explicit CORS Headers (Optional Enhancement)

```diff
--- a/src/payload.config.ts
+++ b/src/payload.config.ts
@@ -68,7 +68,13 @@ export default buildConfig({
 
   // CORS with exact origins
-  cors: allowedOrigins,
+  cors: {
+    origins: allowedOrigins,
+    credentials: true,
+    headers: [
+      'Authorization',
+      'Content-Type',
+    ],
+  },
 
   // CSRF: relaxed in dev, strict in prod
   csrf: process.env.NODE_ENV === 'production' ? allowedOrigins : [],
```

---

## 3. LOGS

### Current Configuration Snapshot

**Users collection auth config (Users.ts:5-14):**
```typescript
auth: {
  useAPIKey: true,
  cookies: {
    sameSite: 'None',
    secure: true,
    domain: 'content.diaradio.live',
  },
}
// ❌ Missing: tokenExpiration, verify, forgotPassword customization
```

**Payload config (payload.config.ts):**
```typescript
export default buildConfig({
  serverURL: 'https://content.diaradio.live',
  cors: allowedOrigins, // ['https://dia-radio-app.vercel.app', ...]
  csrf: process.env.NODE_ENV === 'production' ? allowedOrigins : [],
  // ❌ NO email adapter configured
})
```

**Environment variables (.env):**
```bash
DATABASE_URI=mongodb://mongo:27017/dia-cms
PAYLOAD_SECRET=2dada6f02780cbeec7a7f968
PAYLOAD_API_KEY=Z7kR3pV9tXyLqF2sMbN8aC1eJhGdUwYo
# ❌ Missing: SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM_ADDRESS
```

### Payload Default Auth Values (from source)

```typescript
// .pnpm-store authDefaults:
tokenExpiration: 7200,        // 2 hours (TOO SHORT for sessions)
maxLoginAttempts: 5,
lockTime: 600000,             // 10 minutes
verify: false,                // ❌ Email verification disabled
useSessions: true,            // ✓ Sessions enabled
```

### JWT Payload Inspection

**Fields with `saveToJWT: true`:**
- `role` (Users.ts:148) — ✓ Essential, keep

**No other fields save to JWT** — ✓ Minimal JWT hygiene maintained

### Endpoint Availability (Built-in)

✅ **Auto-enabled Payload REST endpoints:**
- `POST /api/users/login`
- `POST /api/users/logout`
- `POST /api/users/refresh-token` ← refresh endpoint confirmed
- `POST /api/users/forgot-password` (unusable without email)
- `POST /api/users/reset-password`
- `POST /api/users/verify/:token` (unusable without email)

**Source confirmation:**
```typescript
// .pnpm-store refresh handler (refreshHandler.js:6-36)
export const refreshHandler = async (req) => {
  const result = await refreshOperation({ collection, req })
  if (result.setCookie) {
    const cookie = generatePayloadCookie({ 
      collectionAuthConfig: collection.config.auth,
      cookiePrefix: req.payload.config.cookiePrefix,
      token: result.refreshedToken 
    })
    headers.set('Set-Cookie', cookie)
  }
  return Response.json({ message: 'Token refresh successful', ...result })
}
```

---

## 4. QUESTIONS & RISKS

### 🚨 Critical Risks

1. **Email verification completely broken**  
   - `auth.verify: false` → Users can register without email confirmation  
   - No email adapter → Even if enabled, no emails would send  
   - **Impact:** Spam accounts, no email ownership proof, security hole

2. **Token expiration too short for refresh flow**  
   - Default `tokenExpiration: 7200s` (2 hours) defeats long-lived session goal  
   - Should be **30-90 days** for refresh token pattern  
   - **Impact:** Users forced to re-login every 2 hours (poor UX)

3. **Forgot password unusable**  
   - Endpoint exists but no email sends (no SMTP configured)  
   - **Impact:** Users locked out of accounts permanently if password forgotten

4. **CORS may block Authorization header**  
   - Current config uses simple array format (domain allowlist only)  
   - No explicit `headers: ['Authorization']` in CORS config  
   - **Impact:** Possible preflight failures if frontend sends `Authorization` header

### 🟡 Medium Risks

5. **Email templates point to admin, not frontend app**  
   - Default Payload verify URL: `{serverURL}/admin/users/verify/{token}`  
   - Should be: `https://dia-radio-app.vercel.app/verify?token=...`  
   - **Impact:** Broken links in emails, users can't complete verification

6. **No SMTP fallback or error handling**  
   - If SMTP credentials fail, Payload will throw errors on registration  
   - No graceful degradation or admin notification  
   - **Impact:** Silent failures, users can't register

### 🔍 Investigative Questions

7. **Does frontend use JWT or cookies?**  
   - Cookies configured but CORS allows cross-origin  
   - If frontend uses `Authorization: Bearer {token}`, must confirm CORS allows it  
   - **Check:** Inspect dia-radio-app network requests for auth method

8. **Are there any custom auth hooks we missed?**  
   - No hooks found in Users collection or global config  
   - Confirm no third-party auth plugins (Auth0, Keycloak, etc.) in use  
   - **Verify:** `grep -r "auth.*hook" ./src`

---

## 5. TARGET SETTINGS vs CURRENT STATE

| Setting | Target | Current | Status |
|---------|--------|---------|--------|
| **Access Token TTL** | 30-60 min | 2 hours (7200s) | ⚠️ Too long for access token |
| **Session Expiration** | 60 days | 2 hours | ❌ WAY too short |
| **Email Verification** | `auth.verify: true` | `false` | ❌ Missing |
| **Email Adapter** | Configured with SMTP | Not configured | ❌ Missing |
| **Forgot Password** | Custom templates | Default (broken) | ⚠️ Needs templates |
| **JWT Payload** | Minimal (role, id, email) | Minimal (role only) | ✅ Good |
| **Refresh Endpoint** | Available | ✅ `/refresh-token` | ✅ Working |
| **CORS Headers** | Allow `Authorization` | Domain-only | ⚠️ May need explicit |
| **Cookie Security** | Secure, SameSite | ✅ Configured | ✅ Good |

---

## 6. RECOMMENDED ACTION PLAN

### Phase 1: Critical Fixes (Required before production)

1. **Install email adapter:**
   ```bash
   pnpm add @payloadcms/email-nodemailer nodemailer
   ```

2. **Apply Diff 1** — Add email adapter to `payload.config.ts`

3. **Apply Diff 2** — Enable verification + custom templates in `Users.ts`

4. **Apply Diff 3** — Add SMTP credentials to `.env`

5. **Configure SMTP service:**
   - Recommended: Resend.com (free tier: 3k emails/month)
   - Alternative: SendGrid, Postmark, AWS SES

6. **Extend token expiration:**
   - Change `tokenExpiration` from `7200` to `5184000` (60 days)

### Phase 2: Frontend Integration

7. **Create verification page** in dia-radio-app:
   - Route: `/verify`
   - Accept `?token=` query param
   - Call `POST /api/users/verify/{token}`

8. **Create password reset page:**
   - Route: `/reset-password`
   - Accept `?token=` query param
   - Form to submit new password to `POST /api/users/reset-password`

### Phase 3: Testing Checklist

- [ ] Register new user → receive verification email
- [ ] Click email link → lands on `/verify` page → account verified
- [ ] Attempt login before verification → blocked (if `loginAfterCreate: false`)
- [ ] Forgot password flow → receive reset email
- [ ] Click reset link → lands on `/reset-password` → password changed
- [ ] Refresh token flow → `/api/users/refresh-token` returns new token
- [ ] Token expires after 60 days → forced re-login

### Phase 4: Security Hardening (Optional)

9. **Apply Diff 4** — Explicit CORS headers for `Authorization`

10. **Add rate limiting** on auth endpoints:
    ```typescript
    // In Users.ts auth config
    maxLoginAttempts: 5,
    lockTime: 600000, // 10 min (already default)
    ```

11. **Monitor email deliverability:**
    - Set up DMARC/SPF/DKIM for sending domain
    - Add error logging for failed email sends

---

## 7. FOOTGUNS DETECTED

### 🪤 Footgun 1: Default Verify URL Mismatch
**Problem:** Payload's default verification email links to:  
`https://content.diaradio.live/admin/users/verify/{token}`  

**Why it's bad:** This is the CMS admin panel, not the user-facing app. Users can't verify here.

**Fix:** Custom `generateEmailHTML` (see Diff 2) must override with:  
`https://dia-radio-app.vercel.app/verify?token={token}`

---

### 🪤 Footgun 2: Silent Email Failures
**Problem:** Without email adapter, Payload allows registration but silently fails to send verification emails.

**Why it's bad:** Users think they're verified, but aren't. No error shown.

**Fix:** Configure email adapter (Diff 1) + monitor SMTP errors in production logs.

---

### 🪤 Footgun 3: Short Token = Broken Refresh Flow
**Problem:** 2-hour `tokenExpiration` means refresh token also expires in 2 hours.

**Why it's bad:** Defeats the purpose of refresh tokens (long-lived sessions).

**Fix:** Set `tokenExpiration: 5184000` (60 days) for session lifetime.  
For short access tokens, use a separate API gateway with JWT rotation.

---

### 🪤 Footgun 4: API Key Auth + Cookie Auth Overlap
**Problem:** Both `useAPIKey: true` and cookie-based auth enabled.

**Why it's bad:** Confusing security model. API keys should be for services, cookies for users.

**Fix:** Keep both only if:
- API keys → server-to-server (LibreTime integration)
- Cookies → user authentication (dia-radio-app)

Document separation clearly.

---

## 8. IMPLEMENTATION NOTES

### Email Provider Recommendations

**Option 1: Resend (Recommended)**
```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxxxx
```
- Free tier: 3k emails/month, 100/day
- Excellent deliverability
- Simple API

**Option 2: SendGrid**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.xxxxxxxxxxxx
```
- Free tier: 100 emails/day
- More features (templates, analytics)

**Option 3: Payload Cloud Email (if using Payload Cloud)**
```typescript
// Automatically configured if PAYLOAD_CLOUD=true
// No manual SMTP setup needed
```

### Token Strategy Clarification

**Current model (broken):**
- Access token = Session token (2 hours)
- Refresh = same token (no rotation)

**Target model:**
```
Access token:  30-60 min  (short-lived, in JWT)
Session:       60 days    (long-lived, cookie)
Refresh flow:  /refresh-token endpoint rotates access token
```

**Payload limitation:** Single `tokenExpiration` for both. Workarounds:
1. Use 60-day `tokenExpiration` + API gateway for short access tokens
2. Accept longer access tokens (less ideal)
3. Implement custom auth strategy with dual tokens

### CORS Configuration Deep Dive

**Current (simple array):**
```typescript
cors: ['https://dia-radio-app.vercel.app']
```

**Expanded (explicit headers):**
```typescript
cors: {
  origins: allowedOrigins,
  credentials: true,
  headers: ['Authorization', 'Content-Type'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}
```

**When to use which:**
- Simple array: Works if frontend uses cookies only
- Explicit object: Required if frontend sends `Authorization` header

**Test:** Check browser devtools → Network → preflight `OPTIONS` request.

---

## 9. NEXT STEPS (DO NOT EXECUTE YET)

**Awaiting approval to:**
1. Apply Diff 1-3 (email + verification config)
2. Add `.env` SMTP credentials (need Resend API key)
3. Test email flows in staging
4. Create frontend `/verify` and `/reset-password` pages
5. Update to 60-day `tokenExpiration`

**Questions for stakeholder:**
- Which email provider to use? (Resend recommended)
- Confirm frontend app routes for `/verify` and `/reset-password`
- Preferred "From" address? (e.g., `noreply@diaradio.live`)
- Require email verification before login? (set `loginAfterCreate: false`)

---

**END OF REVIEWER PACK**

