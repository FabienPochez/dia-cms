# Admin "Send Reset Email" Button

## Overview

Admin and Staff users can now trigger password reset emails for any user directly from the Users collection edit view via a sidebar button.

## Feature Details

### UI Component
- **Location**: Users collection sidebar (appears on edit view only)
- **Visibility**: Admin and Staff roles only
- **Label**: "📧 Send Reset Email"
- **Behavior**: 
  - Prompts for confirmation before sending
  - Shows loading state while processing
  - Displays success/error message via browser alert

### API Endpoint
- **URL**: `POST /api/admin/users/:id/send-reset`
- **Access Control**: Server-side role check (admin/staff only)
- **Response Format**:
  ```json
  // Success
  { "success": true, "message": "Password reset email sent to user@example.com" }
  
  // Error
  { "error": "Forbidden: Admin or Staff access required" }
  ```

### Security

**Server-side Protection**:
- Authenticates request via Payload's auth system
- Validates user role (admin/staff only)
- Returns 403 Forbidden for unauthorized access
- Logs all reset email actions with admin and target user details

**Client-side Protection**:
- Button only renders for admin/staff users
- Uses authenticated session cookies
- Confirmation dialog prevents accidental clicks

### Use Cases

1. **Host Onboarding**: Admin creates a new host user → clicks button → host receives reset email → sets password → accesses upload form
2. **Password Recovery**: User locked out → admin triggers reset → user receives new reset link
3. **Account Setup**: Manually created accounts → admin sends reset → user sets initial password

## Usage Instructions

### As an Admin/Staff User:

1. Navigate to **Collections → Users**
2. Click on any user to open the edit view
3. Look for the **"📧 Send Reset Email"** button in the right sidebar
4. Click the button
5. Confirm the action in the dialog
6. Wait for success confirmation
7. User will receive password reset email at their registered address

### Email Details:
- **Subject**: "Reset your DIA! Radio password"
- **Sender**: `DIA! Radio <no-reply@notify.diaradio.live>`
- **Reply-To**: `contact@diaradio.live`
- **Link format**: `https://content.diaradio.live/admin/reset-password?token=xxxxx`
- **Token expiry**: 1 hour

## Technical Implementation

### Files Created:
1. **`src/admin/components/SendResetButton.tsx`** - React component
   - Uses `useAuth()` for role check
   - Uses `useParams()` to extract user ID from URL
   - Handles loading state and error handling
   - Styled inline for consistency

2. **`src/app/api/admin/users/[id]/send-reset/route.ts`** - Next.js API route
   - RESTful pattern with dynamic `[id]` parameter
   - Uses Payload Local API for authentication
   - Calls `payload.forgotPassword()` to trigger email
   - Returns structured JSON responses

### Files Modified:
1. **`src/collections/Users.ts`** - Added UI field:
   ```typescript
   {
     name: 'adminActions',
     type: 'ui',
     admin: {
       position: 'sidebar',
       components: {
         Field: '@/admin/components/SendResetButton',
       },
     },
   }
   ```

2. **`src/app/(payload)/admin/importMap.js`** - Auto-generated
   - Registers component for Payload v3 import system

### Files Removed:
- **`src/app/api/users/send-reset-email/route.ts`** - Old endpoint (replaced)

## Logging

All password reset triggers are logged to the server console:

```
[send-reset] Password reset email sent to host@example.com by admin@example.com
```

This provides an audit trail for security and troubleshooting.

## Testing

### Manual Test:
1. Log in as admin
2. Create or edit a user
3. Click "Send Reset Email" button
4. Check target user's email inbox
5. Verify email arrives with valid reset link
6. Click link and set new password
7. Verify user can log in with new password

### Test Cases:
- ✅ Admin can send reset email
- ✅ Staff can send reset email
- ✅ Host users don't see the button
- ✅ Endpoint returns 403 for non-admin/staff
- ✅ Button doesn't appear on user creation view (only edit)
- ✅ Email arrives with correct sender and subject
- ✅ Reset link is valid and functional

## Troubleshooting

### Button Not Visible:
- Check your user role (must be admin or staff)
- Verify you're on an **edit** view (not create view)
- Check browser console for component errors
- Verify import map was regenerated: `npm run generate:importmap`

### 403 Forbidden Error:
- Your user account doesn't have admin/staff role
- Session expired - try logging out and back in

### Email Not Received:
- Check target user has a valid email address
- Verify SMTP configuration in `.env` (see `EMAIL_TRANSACTIONAL_SETUP.md`)
- Check server logs: `docker logs payload-payload-1 --tail 50`
- Verify DNS records (SPF, DKIM) are configured correctly

### Network Error:
- Check browser console for CORS errors
- Verify Payload service is running: `docker ps`
- Check API endpoint is accessible: browser network tab

## Future Enhancements

Potential improvements (not yet implemented):
- Toast notification instead of browser alert
- Email preview before sending
- Bulk action: send reset to multiple users
- Custom reset email templates per user role
- Activity log UI for all password reset actions
- Rate limiting to prevent abuse

## Related Documentation

- `docs/EMAIL_TRANSACTIONAL_SETUP.md` - Email system configuration
- `docs/EMAIL_RESEND_SETUP.md` - Resend provider setup
- `docs/HOST_USER_ACCESS_REPORT.md` - Analysis of host access patterns
- `docs/HOST_PASSWORD_RESET_IMPLEMENTATION.md` - Initial implementation notes

