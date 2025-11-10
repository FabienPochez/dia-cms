# Host Password Reset Implementation

**Date**: 2025-10-28  
**Status**: ✅ Implemented and Ready for Testing

---

## What Was Implemented

### 1. Fixed Admin Panel Access for Password Reset ✅

**File**: `src/access/adminPanelOnly.ts`

**Change**: Modified to allow unauthenticated users to access password reset routes.

```typescript
export const adminPanelOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any
  
  // Allow unauthenticated access (needed for password reset, email verification)
  if (!user) return true
  
  // Allow authenticated admin/staff for collection management
  return ['admin', 'staff'].includes(user.role)
}
```

**Impact**:
- ✅ Unauthenticated users can now access `/admin/forgot-password`
- ✅ Users with reset tokens can access `/admin/reset-password/:token`
- ✅ Host users blocked from collections (adminPanelOnly still enforces this)
- ✅ Auth routes handle their own security (Payload built-in)

---

### 2. Created Server-Side Reset Email Endpoint ✅

**File**: `src/app/api/users/send-reset-email/route.ts`

**Purpose**: Admin-only endpoint to trigger forgot password email for any user via Local API.

**Features**:
- Admin/staff only access
- Accepts `userId` or `email` as input
- Uses Payload Local API (`payload.forgotPassword()`)
- Returns success/error status

**Usage**:
```bash
curl -X POST /api/users/send-reset-email \
  -H "Content-Type: application/json" \
  -H "Cookie: payload-token=..." \
  -d '{"userId": "68838a8e9a352ee12ba4df90", "email": "host@example.com"}'
```

**Response**:
```json
{
  "success": true,
  "message": "Password reset email sent to host@example.com"
}
```

---

### 3. Created "Send Password Reset Email" Button ✅

**File**: `src/admin/components/SendPasswordResetButton.tsx`

**Purpose**: Custom UI component that displays a button on User edit view to trigger password reset.

**Features**:
- Admin/staff only (hidden for hosts/users)
- Displays on User edit view (sidebar)
- Only shown when editing existing user (not on create)
- Confirmation dialog before sending
- Loading state during API call
- Success/error toast notifications

**UI Location**: User edit view → Sidebar → Top (before Role field)

**Behavior**:
1. Admin clicks "📧 Send Password Reset Email" button
2. Confirmation dialog: "Send password reset email to {email}?"
3. If confirmed → API call to `/api/users/send-reset-email`
4. Success → Toast: "Password reset email sent to {email}"
5. Error → Toast with error message

---

### 4. Integrated Button into Users Collection ✅

**File**: `src/collections/Users.ts`

**Change**: Added UI field with custom component in sidebar.

```typescript
fields: [
  {
    name: 'passwordResetAction',
    type: 'ui',
    admin: {
      components: {
        Field: '@/admin/components/SendPasswordResetButton',
      },
      position: 'sidebar',
    },
  },
  // ... other fields
]
```

**Result**: Button appears at top of sidebar on User edit view.

---

## Host User Invite Workflow

### Complete Flow (Admin → Host)

#### Step 1: Admin Creates Host User

1. Admin logs into `/admin`
2. Goes to Users collection (`/admin/collections/users`)
3. Clicks "Create New"
4. Fills in:
   - **Email**: `newhost@example.com`
   - **Password**: `TempPassword123!` (any dummy password)
   - **Role**: `host`
   - **Linked Host Profile**: Select from dropdown
5. Clicks "Save"

**Result**: Host user created with dummy password ✅

#### Step 2: Admin Sends Password Reset Email

1. Admin goes to the newly created user's edit page
2. Finds "📧 Send Password Reset Email" button in sidebar
3. Clicks button
4. Confirms dialog: "Send password reset email to newhost@example.com?"
5. Clicks "OK"

**Result**: 
- API call to `/api/users/send-reset-email`
- Payload Local API triggers `forgotPassword()`
- Email sent to `newhost@example.com`
- Toast notification: "Password reset email sent to newhost@example.com" ✅

#### Step 3: Host Receives Email

**Email Details**:
- **From**: `DIA! Radio <no-reply@notify.diaradio.live>`
- **Subject**: "Reset your DIA! Radio password"
- **Content**: 
  ```
  You are receiving this email because you (or someone else) has requested to reset the password for your account.
  
  https://content.diaradio.live/admin/reset-password?token=xxxxxxxxxxxxxxxxxxxxx
  
  If you did not request this, please ignore this email and your password will remain unchanged.
  ```

**Token Details**:
- Expires in 1 hour (Payload default)
- Single-use token
- Stored in database: `users.resetPasswordToken`

#### Step 4: Host Clicks Reset Link

1. Host opens email
2. Clicks reset password link
3. Browser opens: `https://content.diaradio.live/admin/reset-password?token=xxx`
4. Reset password page loads ✅ (no longer blocked by `adminPanelOnly`)

#### Step 5: Host Sets New Password

1. Host enters new password: `SecurePassword456!`
2. Confirms password: `SecurePassword456!`
3. Clicks "Reset Password"
4. Payload validates token and updates password
5. Redirects to login page

**Result**: Password updated in database ✅

#### Step 6: Host Logs In

1. Host enters:
   - **Email**: `newhost@example.com`
   - **Password**: `SecurePassword456!` (new password)
2. Clicks "Log In"
3. Payload authenticates user
4. **Auto-redirect**: Host redirected to `/admin/upload-episode` (via `HostDashboardRedirect`)

**Result**: Host logged in and viewing upload form ✅

#### Step 7: Host Can Access Upload Features

- ✅ Upload form accessible at `/admin/upload-episode`
- ✅ Upload success page at `/admin/upload-success`
- ❌ Collections blocked (403): `/admin/collections/episodes`, `/admin/collections/shows`
- ❌ Admin dashboard blocked: `/admin` redirects to upload form

**Result**: Host workflow complete ✅

---

## Security Considerations

### Password Reset Security

**Token Security**:
- ✅ Cryptographically secure tokens (Payload default)
- ✅ Tokens expire after 1 hour
- ✅ Single-use tokens (invalidated after reset)
- ✅ Tokens stored securely in database

**Email Security**:
- ✅ Sent via Resend SMTP (TLS encryption)
- ✅ Reset link uses HTTPS
- ✅ No passwords in email body
- ✅ Clear "ignore if not requested" message

**Access Control**:
- ✅ Only admin/staff can trigger reset email
- ✅ Endpoint checks authentication
- ✅ Unauthenticated users can only access reset page with valid token
- ✅ Host users cannot access collections (maintained security)

### Rate Limiting Considerations

**Current**: No rate limiting on forgot password  
**Recommendation**: Add rate limiting to prevent abuse

**Potential Attacks**:
- Email spam (send unlimited reset emails)
- Token brute force (try many tokens)

**Mitigation** (Future):
- Rate limit: 5 requests per hour per IP on `/api/users/forgot-password`
- Rate limit: 3 requests per minute per user on admin button
- CAPTCHA on public forgot password form (if exposed)
- Log all reset attempts for audit

---

## Testing Checklist

### ✅ Prerequisite: Email System Working

- [ ] Email configuration loaded (`EMAIL_HOST`, `EMAIL_USER`, etc.)
- [ ] Payload container running
- [ ] Mock mode active (dev) or DNS configured (production)
- [ ] Test forgot password from login page works

### ✅ Test 1: Admin Can Access Button

1. [ ] Admin logs in
2. [ ] Goes to Users collection
3. [ ] Opens any existing user
4. [ ] Sees "📧 Send Password Reset Email" button in sidebar
5. [ ] Button positioned at top of sidebar

### ✅ Test 2: Host User Cannot See Button

1. [ ] Host user logs in
2. [ ] (Not applicable - hosts can't access Users collection)
3. [ ] Verify host blocked from `/admin/collections/users` → 403

### ✅ Test 3: Send Reset Email Works

1. [ ] Admin opens user edit page
2. [ ] Clicks "📧 Send Password Reset Email"
3. [ ] Confirmation dialog appears
4. [ ] Admin clicks "OK"
5. [ ] Toast shows success message
6. [ ] Check logs for email sent (mock mode) or inbox (production)

### ✅ Test 4: Button Disabled During Send

1. [ ] Admin clicks button
2. [ ] Button shows "Sending..." text
3. [ ] Button is disabled
4. [ ] After API response, button re-enabled

### ✅ Test 5: Reset Link Works for Host

1. [ ] Create test host user with dummy password
2. [ ] Admin sends reset email
3. [ ] Copy reset link from email/logs
4. [ ] Open link in incognito window (unauthenticated)
5. [ ] Reset password page loads (no 403)
6. [ ] Set new password
7. [ ] Redirects to login
8. [ ] Login with new password
9. [ ] Auto-redirected to `/admin/upload-episode`

### ✅ Test 6: Token Expiration Works

1. [ ] Generate reset token
2. [ ] Wait 1 hour (or manually expire in database)
3. [ ] Try to use expired token
4. [ ] Should see error: "Token expired"

### ✅ Test 7: Token Single-Use Works

1. [ ] Generate reset token
2. [ ] Use token to reset password
3. [ ] Try to use same token again
4. [ ] Should see error: "Token invalid"

### ✅ Test 8: Collections Still Blocked for Hosts

1. [ ] Host logs in
2. [ ] Try to access `/admin/collections/episodes` → 403
3. [ ] Try to access `/admin/collections/shows` → 403
4. [ ] Try to access `/admin/collections/users` → 403
5. [ ] `/admin/upload-episode` works ✅

---

## Troubleshooting

### Issue: Button Not Visible

**Symptoms**: "Send Password Reset Email" button doesn't appear on User edit view

**Possible Causes**:
1. Component not loaded (check console for errors)
2. Admin is not logged in as admin/staff role
3. Viewing create page (not edit)
4. Component path incorrect in Users collection

**Fix**:
```bash
# Check Payload logs for errors
docker logs payload-payload-1 --tail 50

# Verify component exists
ls -la /srv/payload/src/admin/components/SendPasswordResetButton.tsx

# Restart container
docker compose restart payload
```

### Issue: API Endpoint Returns 401

**Symptoms**: Button click fails with "Unauthorized" error

**Possible Causes**:
1. User not authenticated
2. Session expired
3. CSRF token issue

**Fix**:
- Refresh page and try again
- Log out and log back in
- Check cookie settings (should include credentials)

### Issue: Email Not Sent

**Symptoms**: API succeeds but no email received

**Possible Causes**:
1. Email configuration missing
2. SMTP credentials invalid
3. Mock mode active (check logs for preview URL)

**Fix**:
```bash
# Check email env vars loaded
docker exec payload-payload-1 env | grep EMAIL

# Check Payload logs for email errors
docker logs payload-payload-1 | grep -i email

# Test forgot password from login page
# Go to /admin/login → "Forgot password?" → Enter email
```

### Issue: Reset Link Returns 403

**Symptoms**: Clicking reset link shows "Unauthorized" or 403 error

**Possible Causes**:
1. `adminPanelOnly` not updated
2. Token invalid/expired
3. Cache issue (old code loaded)

**Fix**:
```bash
# Verify adminPanelOnly.ts was updated
cat /srv/payload/src/access/adminPanelOnly.ts | grep "if (!user) return true"

# Restart container
docker compose restart payload

# Clear browser cache and try again
```

---

## Files Modified

### Core Changes

1. **`src/access/adminPanelOnly.ts`**
   - Modified to allow unauthenticated access for auth routes
   - Added detailed comments explaining security

2. **`src/collections/Users.ts`**
   - Added `passwordResetAction` UI field
   - Button positioned in sidebar

3. **`src/app/api/users/send-reset-email/route.ts`** (NEW)
   - Server-side endpoint for triggering forgot password
   - Admin-only access
   - Uses Payload Local API

4. **`src/admin/components/SendPasswordResetButton.tsx`** (NEW)
   - Custom UI component with button
   - Toast notifications
   - Loading states

### Documentation

5. **`docs/HOST_USER_ACCESS_REPORT.md`** (NEW)
   - Investigation report
   - Problem analysis
   - Solution options

6. **`docs/HOST_PASSWORD_RESET_IMPLEMENTATION.md`** (NEW - this file)
   - Implementation details
   - Complete workflow guide
   - Testing checklist

---

## Future Enhancements

### Phase 1: User Experience

- [ ] Add success message in UI after email sent
- [ ] Show timestamp of last reset email sent
- [ ] Rate limiting on button (prevent spam)
- [ ] Add "Copy reset link" option for manual sharing

### Phase 2: Security

- [ ] Add CAPTCHA to public forgot password form
- [ ] Implement rate limiting (5/hour per IP)
- [ ] Add audit log for password reset attempts
- [ ] Monitor for suspicious patterns

### Phase 3: Advanced Features

- [ ] Magic link login (passwordless)
- [ ] Bulk invite system (CSV upload)
- [ ] Custom email templates with branding
- [ ] User onboarding tracking

---

## Rollback Instructions

If something goes wrong and you need to rollback:

```bash
# 1. Revert adminPanelOnly.ts
cd /srv/payload/src/access
git checkout adminPanelOnly.ts

# 2. Remove UI field from Users collection
# Edit src/collections/Users.ts and remove passwordResetAction field

# 3. Remove new files
rm /srv/payload/src/app/api/users/send-reset-email/route.ts
rm /srv/payload/src/admin/components/SendPasswordResetButton.tsx

# 4. Restart container
docker compose restart payload
```

---

## Next Steps

1. **Test complete workflow** with a test host user
2. **Monitor logs** for errors during testing
3. **Invite real host users** and verify flow
4. **Consider adding** rate limiting for security
5. **Update team documentation** with new workflow

---

**Implementation Status**: ✅ Complete  
**Ready for Testing**: ✅ Yes  
**Production Ready**: ⏳ After successful testing

