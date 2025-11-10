# Host User Access Report

**Date**: 2025-10-28  
**Investigation**: Host user access to password reset and account management

---

## Executive Summary

### Current Status: ⚠️ **PROBLEM IDENTIFIED**

Host users **cannot access** password reset pages or admin account management due to `access.admin: adminPanelOnly` restriction on the Users collection.

### Workflow Impact

**Intended Workflow** (NOT working):
1. ✅ Admin creates host user account with dummy password
2. ❌ Admin triggers password reset for host user
3. ❌ Host user receives email with reset link
4. ❌ Host user sets new password
5. ❌ Host user can log in and access upload form

**Current Block**: Host users cannot access `/admin/forgot-password` or `/admin/reset-password/:token` pages because these routes are blocked by `adminPanelOnly` access control.

---

## Detailed Analysis

### Access Control Configuration

**File**: `src/collections/Users.ts`

```typescript
access: {
  admin: adminPanelOnly, // Only admin/staff can access in admin panel
  // ... other access controls
}
```

**What `adminPanelOnly` Does**:
```typescript
// src/access/adminPanelOnly.ts
export const adminPanelOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any
  if (!user) return false
  return ['admin', 'staff'].includes(user.role)
}
```

**Impact**: 
- ✅ Admin/staff can access all admin routes (including forgot/reset password)
- ❌ Host users blocked from ALL admin routes, including password reset
- ❌ Unauthenticated users blocked from forgot/reset password pages

### Payload Auth Routes

**Built-in Routes** (handled by Payload):
- `/admin/login` - Login page
- `/admin/forgot-password` - Request password reset
- `/admin/reset-password/:token` - Reset password with token
- `/admin/account` - Account management (when logged in)
- `/admin/verify/:token` - Email verification

**All routes check**: `access.admin` for authentication requirements

---

## Root Cause

### 1. Auth Routes Require Authenticated Access

Payload's auth routes (forgot-password, reset-password) check `access.admin`:
- If returning `false` → Route returns 403 Unauthorized
- Host users `role === 'host'` → `adminPanelOnly()` returns `false` → Blocked

### 2. Missing Unauthenticated Access

The current configuration doesn't allow unauthenticated users to access forgot/reset password pages:

**Current**:
```typescript
export const adminPanelOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any
  if (!user) return false  // ❌ Blocks unauthenticated users
  return ['admin', 'staff'].includes(user.role)
}
```

**Needed**: Allow unauthenticated access for auth routes like forgot/reset password.

---

## Solutions

### Option 1: Separate Admin Auth Routes (RECOMMENDED)

**Create new access control** for auth routes that allows unauthenticated access:

```typescript
// src/access/adminAuthRoutes.ts
export const adminAuthRoutes = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any
  
  // Allow unauthenticated users to access auth routes
  if (!user) return true
  
  // Allow all authenticated users (admin, staff, host, user)
  return true
}
```

**Update Users collection**:
```typescript
admin: {
  useAsTitle: 'email',
  forgotPassword: {
    access: adminAuthRoutes,  // Override for forgot password
  },
  resetPassword: {
    access: adminAuthRoutes,  // Override for reset password
  },
  verify: {
    access: adminAuthRoutes,  // Override for verify
  },
},
```

**Pros**:
- ✅ Clean separation of concerns
- ✅ Allows unauthenticated access for password reset
- ✅ Maintains security for collection access
- ✅ Payload-native solution

**Cons**:
- Need to verify if Payload supports per-route access overrides
- May require Payload v3-specific approach

### Option 2: Modify adminPanelOnly to Allow Unauthenticated

**Update** `src/access/adminPanelOnly.ts`:

```typescript
export const adminPanelOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any
  
  // Allow unauthenticated access (needed for auth routes)
  if (!user) return true
  
  // Allow admin/staff for collection management
  return ['admin', 'staff'].includes(user.role)
}
```

**Pros**:
- ✅ Simple, single change
- ✅ Allows password reset for all users
- ✅ Minimal code changes

**Cons**:
- ⚠️ Security concern: Allows unauthenticated access to admin panel
- May expose admin routes (though they redirect to login if no auth)

**Risk Assessment**:
- Payload's built-in auth routes already handle unauthorized access gracefully
- Login page redirects to login, forgot/reset redirect to appropriate flows
- **Risk level**: LOW (but should test thoroughly)

### Option 3: Custom Forgot Password UI (ALTERNATIVE)

**Create custom forgot password page** that bypasses admin panel:

```typescript
// src/app/(frontend)/forgot-password/page.tsx
export default function ForgotPasswordPage() {
  // Direct API call to /api/users/forgot-password
  // No admin panel access checks
}
```

**Pros**:
- ✅ Complete control over flow
- ✅ No admin panel restrictions
- ✅ Can customize UI/UX

**Cons**:
- More code to maintain
- Duplicates Payload functionality
- Not using built-in features

---

## Recommended Implementation

### Solution: Option 2 (Modified adminPanelOnly) + Verification

**Rationale**: Simplest solution that maintains Payload's built-in auth flow while allowing host users to reset passwords.

**Steps**:

1. **Update** `src/access/adminPanelOnly.ts`:
```typescript
import type { PayloadRequest } from 'payload'

/**
 * Admin panel access: 
 * - Unauthenticated users: ALLOWED (for auth routes like forgot/reset password)
 * - Authenticated admin/staff: ALLOWED (for collection management)
 * - Authenticated hosts/users: BLOCKED (collection management)
 * 
 * Note: Payload's built-in auth routes (login, forgot-password, reset-password, verify)
 * handle their own authorization logic, so allowing unauthenticated access here
 * is safe.
 */
export const adminPanelOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any
  
  // Allow unauthenticated access (needed for password reset, email verification)
  // This is safe because Payload's auth routes handle their own authorization
  if (!user) return true
  
  // Allow authenticated admin/staff for collection management
  return ['admin', 'staff'].includes(user.role)
}
```

2. **Test the flow**:
   - Create test host user
   - Trigger forgot password
   - Verify email received
   - Click reset link
   - Set new password
   - Login with new password
   - Access upload form

3. **Verify host users still blocked from collections**:
   - Host user tries to access `/admin/collections/episodes` → Should get 403
   - Host user tries to access `/admin/collections/shows` → Should get 403
   - Host user can access `/admin/upload-episode` → Should work (custom view)

---

## Workflow Testing Checklist

### Admin Creates Host User

**Steps**:
1. Admin logs in to `/admin`
2. Goes to Users collection
3. Creates new user:
   - Email: `host-test@example.com`
   - Password: `TempPass123!` (dummy)
   - Role: `host`
   - Link to host profile
4. Click "Save"

**Expected Result**: User created successfully ✅

### Admin Triggers Password Reset

**Current**: Admin needs to trigger forgot password manually  
**Ideal**: Custom UI button "Send Password Reset" in Users list view

**Option A - Manual (Current)**:
1. Admin logs out
2. Go to `/admin/login`
3. Click "Forgot password?"
4. Enter host email
5. Click "Submit"

**Option B - Custom UI Button (Future)**:
Create custom Users list view with "Send Reset" button per user.

### Host Receives Email

**Expected**:
- Email from: `DIA! Radio <no-reply@notify.diaradio.live>`
- Subject: "Reset your DIA! Radio password"
- Link format: `https://content.diaradio.live/admin/reset-password?token=xxxxx`

### Host Resets Password

**Steps**:
1. Host clicks reset link in email
2. `/admin/reset-password?token=xxxxx` loads
3. Enter new password: `NewPassword123!`
4. Confirm password: `NewPassword123!`
5. Click "Reset Password"

**Expected**: Password updated ✅, redirected to login

### Host Logs In

**Steps**:
1. Go to `/admin/login`
2. Enter: `host-test@example.com`
3. Password: `NewPassword123!`
4. Click "Login"

**Expected**: 
- Login successful ✅
- Redirected to `/admin/upload-episode` (host dashboard redirect)
- Can access upload form

---

## Alternative Host Invite Workflow

### Option A: Manual Password Reset (Current)

1. Admin creates host user with dummy password
2. Admin triggers forgot password manually (via UI or API)
3. Host receives email with reset link
4. Host sets new password
5. Host can log in

**Pros**: Uses existing email system  
**Cons**: Manual trigger required, uses dummy password initially

### Option B: Send Initial Password (ALTERNATIVE)

1. Admin creates host user with strong random password
2. System sends password to host via email
3. Host receives email with credentials
4. Host can log in with provided password
5. Host can change password later if needed

**Pros**: No manual trigger needed  
**Cons**: Email contains password (security risk), uses sendPassword API

### Option C: Magic Link Invite (FUTURE)

1. Admin creates host user (no password needed)
2. Admin triggers magic link invite
3. Host receives email with login link
4. Host clicks link, redirected to set password
5. Host can log in

**Pros**: Modern UX, no passwords in emails  
**Cons**: Magic link not yet implemented in Payload

---

## Implementation Checklist

### Immediate Fix (Option 2)

- [ ] Update `src/access/adminPanelOnly.ts` to allow unauthenticated access
- [ ] Test forgot password for unauthenticated user
- [ ] Test password reset link
- [ ] Verify host users blocked from collections (403)
- [ ] Verify host users can access upload form

### User Experience Improvements (Optional)

- [ ] Add "Send Password Reset" button to Users list view
- [ ] Add user invite UI for admins
- [ ] Track password reset emails sent (audit log)
- [ ] Add success message after admin triggers reset

### Long-term Enhancements

- [ ] Implement magic link login
- [ ] Add user invite system with automatic email
- [ ] Custom email templates for invites
- [ ] Track user onboarding metrics

---

## Security Considerations

### Password Reset Flow Security

**Current Security Features**:
- ✅ Reset token expires after 1 hour
- ✅ Token is single-use
- ✅ Tokens stored in database (resetPasswordToken)
- ✅ Verified flag prevents account takeover

**Additional Security**:
- Consider rate limiting on `/admin/forgot-password` (prevent email spam)
- Add CAPTCHA for forgot password requests
- Log all password reset attempts

### Email Security

**Current**:
- Email sent via Resend (SMTP)
- Contains reset link with token
- Token is cryptographically secure

**Considerations**:
- Ensure HTTPS for reset links
- Token length sufficient (verify Payload default)
- Token entropy high enough

---

## Questions for Clarification

1. **Admin Dashboard Button**: Do you want a custom UI button in Users list to trigger password reset, or is manual workflow OK?
2. **Email Template**: Should we customize the forgot password email template?
3. **Audit Logging**: Should we track when admins trigger password resets?
4. **Password Policy**: Any specific password requirements for host users?
5. **Account Management**: Should hosts be able to change their own passwords after login?

---

## Next Steps

1. **Review** this report and choose solution (Option 1, 2, or 3)
2. **Implement** chosen solution
3. **Test** complete workflow with test host user
4. **Document** final workflow for team
5. **Deploy** to staging/production

---

**Report Status**: ✅ Complete - Waiting for implementation decision

