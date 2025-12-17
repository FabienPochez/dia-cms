# Step 4D: LibreTime Integration Guide

## Overview
This document covers the complete integration between Payload CMS and LibreTime v2 API for hard-timed show-per-slot scheduling. This enables the Planner to schedule episodes directly in LibreTime with proper collision detection and rollback mechanisms.

## Architecture

### Components
- **Payload CMS**: Episode management and scheduling UI
- **LibreTime v2 API**: Show/instance/playout management
- **Integration Layer**: `libretimeClient.ts` + API routes

### Data Flow
1. User schedules episode in Payload Planner
2. Payload creates/ensures LibreTime show
3. Payload creates/ensures LibreTime instance for time window
4. Payload creates LibreTime playout with episode track
5. Payload updates episode with LibreTime IDs

## API Endpoints

### POST /api/schedule/planOne
Schedules a single episode in LibreTime.

**Request Body:**
```json
{
  "showId": "string",
  "episodeId": "string", 
  "scheduledAt": "2025-12-01T10:00:00Z",
  "scheduledEnd": "2025-12-01T11:00:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "showId": 13,
  "instanceId": 15,
  "playoutId": 21
}
```

### DELETE /api/schedule/unplanOne
Removes a scheduled episode from LibreTime.

**Request Body (JSON):**
```json
{
  "episodeId": "string",
  "scheduledAt": "2025-12-01T10:00:00Z"
}
```

**Request (Query String):**
```
DELETE /api/schedule/unplanOne?episodeId=xxx&scheduledAt=2025-12-01T10:00:00Z
```

## Environment Configuration

### Required Environment Variables
```bash
# Server-to-server LibreTime base URL (preferred: internal Docker DNS; avoids Cloudflare)
LIBRETIME_API_URL=http://nginx:8080
LIBRETIME_API_KEY=your_libretime_api_key_here

# Optional: LibreTime base URL for legacy endpoints (e.g. /rest/*). Align to internal to avoid Cloudflare.
LIBRETIME_URL=http://nginx:8080
```

**Important**: Payload ↔ LibreTime backend HTTP must use `LIBRETIME_API_URL` and should stay **internal** (e.g. `http://nginx:8080`) to avoid Cloudflare challenges.

### Docker Network Configuration
- Payload containers: `payload_default` network + shared external `dia_internal`
- LibreTime containers: `libretime_default` network + shared external `dia_internal` (**nginx only**)
- Payload talks to LibreTime via internal DNS name `nginx:8080` on `dia_internal` (host bind stays `127.0.0.1:8080`)

## Known Issues & Workarounds

### 1. LibreTime API Filtering Bug
**Issue**: LibreTime API doesn't filter show instances by `show` parameter correctly.

**Workaround**: Client-side filtering in `ensureInstance()`:
```typescript
const existingInstances = allInstances.filter((instance) => instance.show === showId)
```

### 2. Required Fields
**Issue**: LibreTime API requires `cue_out` field for playouts.

**Solution**: Always include `cue_out: '00:15:00'` in playout creation.

### 3. Error Handling
**Issue**: `LibreTimeError` was defined as interface, not class.

**Solution**: Convert to proper Error class with constructor.

## Testing

### Integration Test Commands
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
```

### Test Results
- ✅ Happy path planning
- ✅ Idempotency detection  
- ✅ Unplanning (JSON + Query)
- ✅ Time validation
- ✅ Error handling

## Database Schema Updates

### Episodes Collection
Added fields:
- `libretimeInstanceId`: number - LibreTime instance ID
- `libretimePlayoutId`: number - LibreTime playout ID
- `scheduledAt`: date (nullable) - Scheduled start time
- `scheduledEnd`: date (nullable) - Scheduled end time

### Shows Collection  
Added fields:
- `libretimeShowId`: number - LibreTime show ID

## Collision Detection

### Overlap Detection
- Same track in overlapping time slot → 409 TRACK_OVERLAP
- Different track in overlapping time slot → 409 SLOT_OVERLAP
- Exact match (same track, same time) → Success (idempotent)

### Time Validation
- End time must be after start time
- Invalid time ranges → 400 INVALID_TIME_RANGE

## Rollback Mechanisms

### Failed Playout Creation
1. Check if instance is empty
2. If empty, delete the instance
3. Never delete instances with existing content

### Failed Instance Creation
- Instance creation is atomic
- No rollback needed for instance creation

## Monitoring & Debugging

### Log Patterns
```
[SCHEDULE] schedule_plan_ok episodeId=xxx showId=xxx instanceId=xxx playoutId=xxx
[SCHEDULE] schedule_plan_idempotent episodeId=xxx showId=xxx instanceId=xxx playoutId=xxx
[SCHEDULE] schedule_plan_conflict episodeId=xxx showId=xxx instanceId=xxx conflictId=xxx
[LT] Failed to ensure show/instance/playout: [error details]
```

### LibreTime API Verification
```bash
# Check shows
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "$LIBRETIME_API_URL/api/v2/shows"

# Check instances for show
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "$LIBRETIME_API_URL/api/v2/show-instances?show=13"

# Check playouts for instance  
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "$LIBRETIME_API_URL/api/v2/schedule?instance=15"
```

## Future Improvements

1. **Overlap Detection**: Improve overlap detection logic for better collision prevention
2. **Batch Operations**: Add support for planning multiple episodes at once
3. **Caching**: Add Redis caching for LibreTime show/instance lookups
4. **Webhooks**: Add LibreTime webhook support for real-time updates
5. **Metrics**: Add Prometheus metrics for scheduling operations

## Related Files

- `src/integrations/libretimeClient.ts` - LibreTime API client
- `src/app/api/schedule/planOne/route.ts` - Planning endpoint
- `src/app/api/schedule/unplanOne/route.ts` - Unplanning endpoint
- `src/collections/Episodes.ts` - Episode schema
- `src/collections/Shows.ts` - Show schema
