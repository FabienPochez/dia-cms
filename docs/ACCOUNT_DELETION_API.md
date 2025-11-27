# Account Deletion API

## Overview

Self-service account deletion endpoint that allows authenticated users to delete their own accounts. Uses a custom endpoint outside Payload's catch-all route handler to ensure reliable access control.

## Endpoint

**DELETE** `/api/delete-account`

## Authentication

Requires authentication via:
- JWT Bearer token in `Authorization` header, OR
- Session cookie (for browser-based requests)

## Request

### Headers

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

OR (for browser requests with cookies):

```
Content-Type: application/json
```

### Body

No request body required. The endpoint automatically uses the authenticated user's ID from the session.

## Response

### Success (200 OK)

```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

### Error Responses

#### 401 Unauthorized

User is not authenticated:

```json
{
  "error": "Authentication required"
}
```

#### 401 Invalid Session

User session is invalid:

```json
{
  "error": "Invalid user session"
}
```

#### 500 Internal Server Error

Account deletion failed:

```json
{
  "error": "Failed to delete account"
}
```

## Usage Examples

### JavaScript (Fetch API)

```javascript
async function deleteAccount() {
  try {
    const response = await fetch('https://content.diaradio.live/api/delete-account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        // Include JWT token if using Bearer auth
        // 'Authorization': `Bearer ${token}`
      },
      credentials: 'include', // Include cookies for session-based auth
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to delete account')
    }

    const data = await response.json()
    console.log('Account deleted:', data.message)
    return data
  } catch (error) {
    console.error('Delete account error:', error)
    throw error
  }
}
```

### Vue.js (Composition API)

```vue
<script setup>
import { ref } from 'vue'

const isDeleting = ref(false)
const error = ref(null)

async function deleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
    return
  }

  isDeleting.value = true
  error.value = null

  try {
    const response = await fetch('https://content.diaradio.live/api/delete-account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to delete account')
    }

    const data = await response.json()
    
    // Redirect to home or show success message
    alert('Account deleted successfully')
    // Clear local storage, cookies, etc.
    // Redirect to home page
    window.location.href = '/'
  } catch (err) {
    error.value = err.message
    console.error('Delete account error:', err)
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div>
    <button 
      @click="deleteAccount" 
      :disabled="isDeleting"
      class="delete-button"
    >
      {{ isDeleting ? 'Deleting...' : 'Delete Account' }}
    </button>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>
```

### Axios

```javascript
import axios from 'axios'

async function deleteAccount() {
  try {
    const response = await axios.delete('https://content.diaradio.live/api/delete-account', {
      withCredentials: true, // Include cookies
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${token}` // If using Bearer auth
      },
    })

    console.log('Account deleted:', response.data.message)
    return response.data
  } catch (error) {
    if (error.response) {
      // Server responded with error
      throw new Error(error.response.data.error || 'Failed to delete account')
    } else {
      // Network error
      throw new Error('Network error. Please try again.')
    }
  }
}
```

## Security Considerations

1. **Authentication Required**: The endpoint requires valid authentication. Unauthenticated requests will receive 401.

2. **Self-Service Only**: Users can only delete their own accounts. The endpoint automatically uses the authenticated user's ID from the session.

3. **No User ID in URL**: Unlike `DELETE /api/users/{userId}`, this endpoint doesn't require a user ID in the URL, preventing potential ID manipulation attempts.

4. **Permanent Deletion**: Account deletion is permanent and cannot be undone. Consider implementing a confirmation dialog in the UI.

5. **Session Invalidation**: After successful deletion, the user's session will be invalidated. The frontend should handle this by:
   - Clearing local storage
   - Clearing cookies
   - Redirecting to home/login page
   - Showing appropriate messaging

## Error Handling

The endpoint returns standard HTTP status codes:

- `200 OK`: Account deleted successfully
- `401 Unauthorized`: Authentication required or invalid session
- `500 Internal Server Error`: Server error during deletion

All error responses include an `error` field with a descriptive message.

## Testing

### cURL Example

```bash
# With JWT token
curl -X DELETE https://content.diaradio.live/api/delete-account \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# With session cookie
curl -X DELETE https://content.diaradio.live/api/delete-account \
  -H "Content-Type: application/json" \
  -b "payload-token=YOUR_SESSION_COOKIE"
```

## Migration from Previous Approach

If you were previously trying to use `DELETE /api/users/{userId}`, update your code to:

1. Change endpoint from `/api/users/{userId}` to `/api/delete-account`
2. Remove user ID from URL (endpoint uses authenticated user's ID automatically)
3. Keep authentication headers/cookies the same

## Related Endpoints

- `POST /api/users/change-password` - Change password (self-service)
- `POST /api/app-forgot-password` - Request password reset email
- `POST /api/users/reset-password` - Reset password with token

