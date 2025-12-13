# Subprocess Diagnostic Verification Procedure

## Prerequisites

1. Payload container running: `docker compose ps`
2. Logs accessible: `docker compose logs payload`

## Verification Steps

### 1. Verify Middleware is Active

Check that middleware is capturing request context:

```bash
# Make a test request
curl -X GET http://localhost:3000/api/schedule/deterministic

# Check logs for request context
docker compose logs payload --tail 50 | grep "req_path=/api/schedule/deterministic"
```

**Expected**: Log entries should include `req_path`, `req_method`, and optionally `req_cf_ip`.

### 2. Verify Structured Logging

Check that logs are in structured format:

```bash
# View recent subprocess logs
docker compose logs payload --tail 100 | grep "\[SUBPROC_DIAG\]"
```

**Expected**: Logs should be in `key=value` format (production) or JSON (debug mode).

### 3. Test Allowlisted Command

Trigger an allowlisted command (e.g., `git`):

```bash
# This should trigger a git command internally
curl -X GET http://localhost:3000/api/schedule/deterministic

# Check for allowlisted command log
docker compose logs payload --tail 50 | grep "event=subprocess_exec_ok"
```

**Expected**: Log entry with `event=subprocess_exec_ok`, `reason=allowlisted`, `cmd_allowlisted_name=git`.

### 4. Test Rate Limiting

If you have a way to trigger the same command multiple times quickly:

```bash
# Trigger command multiple times (if possible)
for i in {1..3}; do
  curl -X GET http://localhost:3000/api/schedule/deterministic
  sleep 0.1
done

# Check logs for rate limiting
docker compose logs payload --tail 50 | grep "blocked=true"
```

**Expected**: Some log entries may have `blocked=true` (rate-limited from logging).

### 5. Test Redaction

Check that secrets are redacted:

```bash
# View logs for any commands with secrets
docker compose logs payload --tail 100 | grep "payload_preview" | head -5
```

**Expected**: No secrets visible in `payload_preview` (e.g., `Api-Key ***`, `Bearer ***`).

### 6. Test Repeat Detection

Check that repeat counts are tracked:

```bash
# View logs with repeat counts
docker compose logs payload --tail 100 | grep "repeat_count="
```

**Expected**: Log entries may include `repeat_count=N` for repeated commands.

### 7. Test Debug Mode (Optional)

Enable debug mode and verify JSON output:

```bash
# Stop container
docker compose stop payload

# Add to .env: DEBUG_SUBPROC_DIAG=true
echo "DEBUG_SUBPROC_DIAG=true" >> /srv/payload/.env

# Restart container
docker compose up -d payload

# Wait for startup, then trigger a command
curl -X GET http://localhost:3000/api/schedule/deterministic

# Check for JSON logs
docker compose logs payload --tail 50 | grep "\[SUBPROC_DIAG\]" | head -1 | jq .
```

**Expected**: Log entry should be valid JSON with `payload_full` and `stack` fields.

### 8. Test Request Context Capture

Verify that request metadata is captured:

```bash
# Make request with custom headers
curl -X POST http://localhost:3000/api/episodes/new-draft \
  -H "X-Request-ID: test-123" \
  -H "User-Agent: TestAgent/1.0"

# Check logs for request context
docker compose logs payload --tail 50 | grep "request_id=test-123"
```

**Expected**: Log entry should include `req_method=POST`, `req_path=/api/episodes/new-draft`, `request_id=test-123`.

### 9. Test User Context (If Authenticated)

If you have an authenticated endpoint:

```bash
# Make authenticated request (adjust as needed)
curl -X GET http://localhost:3000/api/libretime/schedule \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check logs for user context
docker compose logs payload --tail 50 | grep "user_id="
```

**Expected**: Log entry should include `user_id`, `user_role` if user is authenticated and context is enriched.

## Sample Expected Log Output

### Production Mode (Default)

```
[SUBPROC_DIAG] event=subprocess_exec_ok severity=INFO executed=true blocked=false reason=allowlisted method=execFile cmd_allowlisted_name=git payload_hash=abc123def456 payload_preview="git config --local --get remote.origin.url" req_method=GET req_path=/api/schedule/deterministic req_cf_ip=192.0.2.1 source_file=route.ts
```

### Debug Mode

```json
{
  "event": "subprocess_exec_ok",
  "severity": "INFO",
  "executed": true,
  "blocked": false,
  "reason": "allowlisted",
  "timestamp": "2025-12-13T16:06:11.270Z",
  "method": "execFile",
  "cmd_allowlisted_name": "git",
  "argv_redacted": ["config", "--local", "--get", "remote.origin.url"],
  "payload_hash": "abc123def456",
  "payload_preview": "git config --local --get remote.origin.url",
  "payload_full": "git config --local --get remote.origin.url",
  "repeat_count": 1,
  "repeat_window_seconds": 60,
  "request": {
    "method": "GET",
    "path": "/api/schedule/deterministic",
    "cf_ip": "192.0.2.1"
  },
  "source": {
    "file": "route.ts",
    "function": "GET"
  }
}
```

## Troubleshooting

### No logs appearing

1. Check that `DISABLE_SUBPROC_DIAG` is not set to `true` in `.env`
2. Verify subprocess methods are being called (check application behavior)
3. Check container logs: `docker compose logs payload --tail 100`

### Request context missing

1. Verify `src/middleware.ts` exists and is properly configured
2. Check middleware matcher includes your route paths
3. Verify request is not a static file (excluded by matcher)

### User context missing

1. Verify route handler calls `enrichContextWithUser()` after authentication
2. Check that user is actually authenticated
3. Verify request context is available (middleware running)

## Cleanup

After verification, you may want to:

1. Disable debug mode (if enabled):
   ```bash
   # Remove from .env
   sed -i '/DEBUG_SUBPROC_DIAG/d' /srv/payload/.env
   docker compose restart payload
   ```

2. Clear old logs (if needed):
   ```bash
   docker compose logs --tail 0 payload > /dev/null
   ```

