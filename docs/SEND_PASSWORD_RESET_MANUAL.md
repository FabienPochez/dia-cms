# Send Password Reset - Manual Method

**Date**: 2025-10-28  
**Status**: Temporary workaround until UI button is fixed

---

## Problem

The "Send Password Reset Email" button UI component is not rendering correctly in Payload v3. The form functionality has been restored, but we need an alternative way for admins to send reset emails.

---

## Solution: Browser Console Method

### For Admins: Send Reset Email from Browser Console

1. **Go to the User edit page** in admin panel
2. **Open Browser Console** (F12 or Cmd+Option+J)
3. **Paste this code** and press Enter:

```javascript
// Get user email from page
const emailInput = document.querySelector('input[name="email"]');
const userEmail = emailInput?.value;

if (!userEmail) {
  alert('Could not find user email');
} else {
  // Send reset email
  fetch('/api/users/send-reset-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userEmail }),
    credentials: 'include'
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('✅ Password reset email sent to ' + userEmail);
    } else {
      alert('❌ Error: ' + (data.error || 'Failed to send email'));
    }
  })
  .catch(err => {
    alert('❌ Network error: ' + err.message);
  });
}
```

4. **Check for success message** - Alert will show if email was sent

---

## Alternative: Create Bookmarklet

### Step 1: Create the Bookmarklet

1. **Create a new bookmark** in your browser
2. **Name it**: "Send Password Reset"
3. **URL**: Paste this code:

```javascript
javascript:(function(){const e=document.querySelector('input[name="email"]');if(!e||!e.value)return alert('Open a user edit page first');const t=e.value;confirm('Send password reset to '+t+'?')&&fetch('/api/users/send-reset-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:t}),credentials:'include'}).then(e=>e.json()).then(e=>{e.success?alert('✅ Sent to '+t):alert('❌ '+e.error)}).catch(e=>alert('❌ '+e.message))})();
```

### Step 2: Use the Bookmarklet

1. Go to any user edit page
2. Click the "Send Password Reset" bookmark
3. Confirm the dialog
4. Check for success message

---

## Alternative: curl Command (Server-Side)

If you have SSH access to the server:

```bash
# Get your auth cookie from browser first
# (Open DevTools → Application → Cookies → payload-token)

curl -X POST https://content.diaradio.live/api/users/send-reset-email \
  -H "Content-Type: application/json" \
  -H "Cookie: payload-token=YOUR_TOKEN_HERE" \
  -d '{"email":"host@example.com"}'
```

---

## Complete Host Invite Workflow

### Step 1: Create Host User

1. Admin logs into `/admin`
2. Go to Users → Create New
3. Fill in:
   - Email: `newhost@example.com`
   - Password: `TempPassword123!` (any dummy password)
   - Role: `host`
   - Linked Host Profile: (select from dropdown)
4. Click Save

### Step 2: Send Password Reset

**Method A - Browser Console:**
1. Open the newly created user
2. Open browser console (F12)
3. Paste the JavaScript code above
4. Press Enter

**Method B - Bookmarklet:**
1. Open the newly created user
2. Click "Send Password Reset" bookmark
3. Confirm dialog

### Step 3: Host Receives Email

Email sent to host with reset link:
```
https://content.diaradio.live/admin/reset-password?token=xxxxx
```

### Step 4: Host Sets Password

1. Host clicks link in email
2. Enters new password
3. Redirects to login
4. Logs in with new password
5. Auto-redirected to upload form

---

## Verification

Check that email was sent:

```bash
# Development (mock mode)
docker logs payload-payload-1 | grep -A 10 "Email sent"

# Production (real email)
# Check inbox
```

---

## Future Enhancement

Once we figure out the correct Payload v3 API for custom components, we'll add:
- ✅ UI button in sidebar (currently not working)
- ✅ Bulk invite system
- ✅ Email status tracking

---

## Technical Notes

### Why UI Button Failed

Payload v3 has different component APIs than v2. The attempts made:

1. **UI Field with custom Field component** - Component renders but breaks form
2. **afterFields component slot** - Property doesn't exist in v3
3. **edit.SaveButton override** - Wrong slot for this purpose

### What Works

- ✅ Server endpoint: `/api/users/send-reset-email` (fully functional)
- ✅ Password reset flow: (users can reset passwords)
- ✅ Email system: (Resend SMTP working)

### What Needs Research

- Correct Payload v3 API for custom edit view components
- Component slots available in v3 (BeforeDocument, AfterDocument, etc.)
- How to properly inject custom UI into edit views

---

## Support

**API Endpoint**: `/api/users/send-reset-email`  
**Documentation**: See `docs/HOST_PASSWORD_RESET_IMPLEMENTATION.md`  
**Component Code**: `src/admin/components/SendPasswordResetButton.tsx` (not currently used)  
**Server Route**: `src/app/api/users/send-reset-email/route.ts` ✅ Working

---

**Status**: Temporary workaround - functional but manual  
**Next Steps**: Research Payload v3 custom component API

