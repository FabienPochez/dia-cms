# LibreTime API Troubleshooting Guide

## Common Issues & Solutions

### 1. Environment Variable Configuration

#### Problem: "Failed to create LibreTime show" (LT_SHOW_FAILED)
**Symptoms:**
- API returns 500 error with LT_SHOW_FAILED code
- LibreTime client can't connect to API

**Root Cause:**
Wrong `LIBRETIME_API_URL` environment variable

**Solution:**
```bash
# Check current value
docker exec payload-payload-1 env | grep LIBRETIME_API_URL

# Should be:
LIBRETIME_API_URL=https://schedule.diaradio.live

# NOT:
LIBRETIME_API_URL=http://libretime_nginx_1:8080
```

**Fix:**
1. Update `/srv/payload/.env`:
   ```bash
   LIBRETIME_API_URL=https://schedule.diaradio.live
   ```
2. Restart Payload container:
   ```bash
   docker restart payload-payload-1
   ```

### 2. LibreTime API Filtering Bug

#### Problem: "Multiple instances found" error
**Symptoms:**
- Error: "Multiple instances found for show X in time window Y to Z. Admin cleanup required."
- Even when no instances exist for that show

**Root Cause:**
LibreTime API doesn't filter instances by `show` parameter correctly. Returns instances from other shows.

**Solution:**
Client-side filtering is implemented in `ensureInstance()`:
```typescript
const existingInstances = allInstances.filter((instance) => instance.show === showId)
```

**Verification:**
```bash
# This should return instances for show 13 only, but returns all instances
curl -H "Authorization: Api-Key $API_KEY" "https://schedule.diaradio.live/api/v2/show-instances?show=13"
```

### 3. Missing Required Fields

#### Problem: "cue_out field is required" (400 error)
**Symptoms:**
- LibreTime API returns 400 Bad Request
- Error details: `{"cue_out":["This field is required."]}`

**Root Cause:**
LibreTime API requires `cue_out` field for playout creation

**Solution:**
Always include `cue_out` in playout data:
```typescript
const playoutData = {
  instance: instanceId,
  file: trackId,
  starts_at: normalizedStart,
  ends_at: normalizedEnd,
  position: 0,
  cue_in: '00:00:00',
  cue_out: '00:15:00', // Required by LibreTime API
  broadcasted: 0,
}
```

### 4. Error Class Definition

#### Problem: "LibreTimeError is not defined" (ReferenceError)
**Symptoms:**
- Runtime error: `ReferenceError: LibreTimeError is not defined`
- Module compilation fails

**Root Cause:**
`LibreTimeError` was defined as interface, not class, but used with `instanceof`

**Solution:**
Convert to proper Error class:
```typescript
export class LibreTimeError extends Error {
  status: number
  message: string
  details?: string

  constructor({ status, message, details }: { status: number; message: string; details?: string }) {
    super(message)
    this.name = 'LibreTimeError'
    this.status = status
    this.message = message
    this.details = details
  }
}
```

### 5. Duplicate Export Error

#### Problem: "Duplicate export 'LibreTimeError'" (ModuleParseError)
**Symptoms:**
- Webpack compilation fails
- Error: "Module parse failed: Duplicate export 'LibreTimeError'"

**Root Cause:**
`LibreTimeError` exported both as class and in export statement

**Solution:**
Remove duplicate export statement:
```typescript
// Remove this line:
export { LibreTimeError }

// Keep only the class export:
export class LibreTimeError extends Error { ... }
```

## Network Connectivity Issues

### Internal vs External URLs

#### Problem: Can't connect to LibreTime API
**Symptoms:**
- HTTP 400/500 errors from internal URLs
- Timeout errors

**Root Cause:**
Docker network configuration issues

**Solution:**
Always use external URL for LibreTime API:
- ✅ `https://schedule.diaradio.live`
- ❌ `http://libretime_nginx_1:8080`
- ❌ `http://libretime_nginx_1:8080`

**Verification:**
```bash
# Test external URL (should work)
curl -H "Authorization: Api-Key $API_KEY" "https://schedule.diaradio.live/api/v2/"

# Test internal URL (may fail)
curl -H "Authorization: Api-Key $API_KEY" "http://libretime_nginx_1:8080/api/v2/"
```

### Container Network Configuration

**Docker Compose Setup:**
```yaml
services:
  payload:
    networks:
      - default
      - libretime_default  # Connect to LibreTime network

networks:
  libretime_default:
    external: true  # Use existing LibreTime network
```

## API Response Debugging

### Check LibreTime API Status
```bash
# Test basic connectivity
curl -H "Authorization: Api-Key $API_KEY" "https://schedule.diaradio.live/api/v2/"

# Check shows
curl -H "Authorization: Api-Key $API_KEY" "https://schedule.diaradio.live/api/v2/shows"

# Check instances for specific show
curl -H "Authorization: Api-Key $API_KEY" "https://schedule.diaradio.live/api/v2/show-instances?show=13"

# Check playouts for specific instance
curl -H "Authorization: Api-Key $API_KEY" "https://schedule.diaradio.live/api/v2/schedule?instance=15"
```

### Check Payload Logs
```bash
# Check recent logs
docker logs payload-payload-1 --tail 20

# Look for specific patterns
docker logs payload-payload-1 | grep "SCHEDULE"
docker logs payload-payload-1 | grep "LT"
```

## Testing Commands

### Manual Integration Tests
```bash
# Test planning
curl -X POST "http://payload-payload-1:3000/api/schedule/planOne" \
  -H "Content-Type: application/json" \
  -d '{"showId":"686d00abd9c5ee507e7c8ea8","episodeId":"686d2d55d9c5ee507e7c9aea","scheduledAt":"2025-12-01T10:00:00Z","scheduledEnd":"2025-12-01T11:00:00Z"}'

# Test unplanning (JSON)
curl -X DELETE "http://payload-payload-1:3000/api/schedule/unplanOne" \
  -H "Content-Type: application/json" \
  -d '{"episodeId":"686d2d55d9c5ee507e7c9aea","scheduledAt":"2025-12-01T10:00:00Z"}'

# Test unplanning (Query)
curl -X DELETE "http://payload-payload-1:3000/api/schedule/unplanOne?episodeId=686d2d55d9c5ee507e7c9aea&scheduledAt=2025-12-01T10:00:00Z"

# Test time validation
curl -X POST "http://payload-payload-1:3000/api/schedule/planOne" \
  -H "Content-Type: application/json" \
  -d '{"showId":"686d00abd9c5ee507e7c8ea8","episodeId":"686d2d55d9c5ee507e7c9aea","scheduledAt":"2025-12-01T10:00:00Z","scheduledEnd":"2025-12-01T10:00:00Z"}'
```

### Expected Responses
- **Success**: `{"success":true,"showId":13,"instanceId":15,"playoutId":21}`
- **Time Error**: `{"error":"Invalid time range: end time must be after start time","code":"INVALID_TIME_RANGE"}`
- **Track Overlap**: `{"error":"Track already scheduled in overlapping time slot","code":"TRACK_OVERLAP"}`

## Performance Considerations

### LibreTime API Rate Limits
- No specific rate limits observed
- API responds quickly (< 1s for most operations)
- Use retry logic for network failures

### Caching Opportunities
- Show lookups can be cached (rarely change)
- Instance lookups could be cached for short periods
- Playout lookups are real-time (don't cache)

## Security Notes

### API Key Management
- Store API key in environment variables
- Never commit API keys to version control
- Rotate API keys regularly
- Use different keys for dev/staging/prod

### Network Security
- External LibreTime API uses HTTPS
- Internal Docker network communication
- No sensitive data in logs (API keys are masked)

## Monitoring & Alerting

### Key Metrics to Monitor
- LibreTime API response times
- Scheduling success/failure rates
- Collision detection frequency
- Rollback operations

### Log Patterns to Watch
```
[SCHEDULE] schedule_plan_ok - Successful planning
[SCHEDULE] schedule_plan_conflict - Collision detected
[LT] Failed to ensure - LibreTime API errors
```

### Alert Thresholds
- API response time > 5s
- Error rate > 10%
- Multiple collision errors in short time
