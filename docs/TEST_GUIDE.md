# Password Change Endpoint Test Guide

## Endpoint
`POST /api/users/change-password`

## Implementation Complete ✅

The secure password change endpoint has been implemented with:
- ✅ Current password verification via Payload login
- ✅ JWT token rotation (invalidates old sessions)
- ✅ Rate limiting (5 attempts per minute per IP+user)
- ✅ Audit logging
- ✅ Self-service only (prevents horizontal privilege escalation)

## Files Created

1. **`src/lib/rateLimiter.ts`** - In-memory rate limiter utility
2. **`src/app/api/users/change-password/route.ts`** - Password change endpoint
3. **`test-password-change.sh`** - Automated test script

## Manual Testing

### 1. Get a JWT Token

First, log in to get a valid JWT token:

```bash
curl -X POST https://content.diaradio.live/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your-current-password"
  }'
```

Copy the `token` from the response.

### 2. Test Password Change

```bash
curl -X POST https://content.diaradio.live/api/users/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "currentPassword": "your-current-password",
    "newPassword": "your-new-password"
  }'
```

**Success Response (200):**
```json
{
  "user": {
    "id": "user-id",
    "email": "your@email.com",
    "role": "user"
  },
  "token": "new-jwt-token",
  "exp": 1234567890
}
```

### 3. Use the New Token

After a successful password change, use the new `token` from the response for subsequent API requests. The old token is now invalid.

## Automated Testing

Run the test suite:

```bash
# Get a JWT token first
JWT_TOKEN=$(curl -s -X POST https://content.diaradio.live/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | jq -r '.token')

# Run tests
JWT_TOKEN="$JWT_TOKEN" ./test-password-change.sh
```

## Test Scenarios Covered

1. ✅ Missing current password → 400
2. ✅ Missing new password → 400
3. ✅ New password too short (< 8 chars) → 400
4. ✅ Same as current password → 400
5. ✅ Invalid JWT token → 401
6. ✅ Incorrect current password → 401
7. ✅ Rate limiting (5+ attempts) → 429
8. ✅ Valid password change → 200 + new token

## Error Responses

### 400 Bad Request
```json
{
  "error": "Current password and new password are required"
}
```
or
```json
{
  "error": "New password must be at least 8 characters"
}
```

### 401 Unauthorized
```json
{
  "error": "Current password is incorrect"
}
```
or
```json
{
  "error": "Authentication required"
}
```

### 429 Too Many Requests
```json
{
  "error": "Too many password change attempts",
  "retryAfter": 45
}
```

### 500 Internal Server Error
```json
{
  "error": "An unexpected error occurred"
}
```

## Security Features

1. **Self-Service Only**: Users can only change their own password (no userId parameter)
2. **Current Password Verification**: Uses `payload.login()` to verify current password
3. **Token Rotation**: Issues new JWT token, invalidating stolen tokens
4. **Rate Limiting**: 5 attempts per minute per IP+user combination
5. **Audit Logging**: Server-side logs (no secrets): `{ userId, ip, timestamp, action }`
6. **Non-Revealing Errors**: Generic error messages to prevent information disclosure

## Integration with Vue Frontend

Your Vue frontend should:

1. **Send Request:**
```javascript
const response = await fetch('/api/users/change-password', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${currentToken}`
  },
  body: JSON.stringify({
    currentPassword: oldPassword,
    newPassword: newPassword
  })
});

const data = await response.json();
```

2. **Handle Success (200):**
```javascript
if (response.ok) {
  // Update stored token with new token
  localStorage.setItem('token', data.token);
  // Show success message
  // Optionally redirect or update UI
}
```

3. **Handle Errors:**
```javascript
if (response.status === 401) {
  // Current password incorrect
  showError('Current password is incorrect');
} else if (response.status === 429) {
  // Rate limited
  showError(`Too many attempts. Try again in ${data.retryAfter} seconds`);
} else if (response.status === 400) {
  // Validation error
  showError(data.error);
} else {
  // Generic error
  showError('Failed to change password');
}
```

## Production Considerations

### Current Setup (Good for Single Instance)
- In-memory rate limiter
- Works great for Docker single-instance deployment

### Future Scaling (If Needed)
If you scale to multiple instances or serverless:
- Migrate rate limiter to Redis
- Keep same logic, just change storage backend
- Example: `ioredis` with same key pattern `${ip}:${userId}`

## Monitoring

Check server logs for audit events:

```bash
docker logs payload | grep password_change
```

Sample log entry:
```json
{
  "action": "password_change",
  "userId": "67890",
  "userEmail": "user@example.com",
  "ip": "192.168.1.1",
  "timestamp": "2025-11-04T10:30:00.000Z",
  "duration": 234,
  "success": true
}
```

## Cleanup

The test script (`test-password-change.sh`) and this guide (`TEST_GUIDE.md`) can be deleted after testing if desired. The implementation files should remain:
- `src/lib/rateLimiter.ts`
- `src/app/api/users/change-password/route.ts`




