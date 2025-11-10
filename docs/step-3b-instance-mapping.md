# Step 3B: Instance Mapping & Guardrails

## Overview

Step 3B adds required mapping from **Show → libretimeInstanceId** and blocks scheduling when the mapped instance is missing. This ensures all episodes can only be scheduled to the correct LibreTime instance.

## Architecture

- **Planner schedules Episodes** in Payload Admin
- **Server proxies to LibreTime v2** to create/update/delete schedules  
- **Payload stores** resulting schedule metadata on the Episode
- **Show mapping** determines which LibreTime instance to use

## Implementation

### 1. Payload Schema (Shows)

Added `libretimeInstanceId` field to Shows collection:
- **Type**: Select field (required)
- **Options**: Sourced from `config/libretime-instances.json`
- **Default**: "main"
- **Location**: Admin sidebar

```json
// config/libretime-instances.json
[
  { "id": "main", "label": "Main Station" }
]
```

### 2. Server/Proxy

New API endpoints handle instance resolution:
- `/api/schedule/create` - Create schedule with instance mapping
- `/api/schedule/move` - Move schedule with instance mapping  
- `/api/schedule/delete` - Delete schedule with instance mapping

**Instance Resolution Flow**:
1. Get episode from Payload
2. Resolve parent show's `libretimeInstanceId`
3. Return `400 LT_INSTANCE_REQUIRED` if missing
4. Forward `x-lt-instance-id` header to LibreTime proxy

**Error Response**:
```json
{
  "error": "Show must be mapped to a LibreTime instance",
  "code": "LT_INSTANCE_REQUIRED", 
  "message": "Show must be mapped to a LibreTime instance."
}
```

### 3. Planner UI (Episodes)

**Episode Loading**:
- Unscheduled episodes include show data (`depth: 1`)
- Show `libretimeInstanceId` exposed in episode data

**Guardrails**:
- Episodes with unmapped shows are **disabled** for drag-drop
- Visual indicators: grayed out, warning message, tooltip
- Error toast for `LT_INSTANCE_REQUIRED` with CTA

**User Feedback**:
- Tooltip: "Map this episode's Show to a LibreTime instance to schedule"
- Error toast: "Show must be mapped to a LibreTime instance. Open Show → set instance."

## Migration

### Backfill Script

Run to set default instance for existing shows:

```bash
# Set default instance (uses env var or "main")
node scripts/backfill-libretime-instances.js

# With custom default
LIBRETIME_INSTANCE_DEFAULT=main node scripts/backfill-libretime-instances.js
```

### Rollback

1. Make `libretimeInstanceId` field optional in Shows schema
2. Remove client-side drag-drop blocking
3. Remove `x-lt-instance-id` header forwarding

## Acceptance Criteria

✅ Shows have visible, required **LibreTime Instance** select in admin  
✅ Unmapped Show → Episode cannot be scheduled (client blocked + server 400)  
✅ Mapped Show → Episode schedules normally; server logs include instance id  
✅ Payload Episode updated with `scheduledAt`, `scheduledEnd`, `airStatus`, `libretimeScheduleId`  
✅ Non-breaking: All Step 3A flows continue working  
✅ Timezone behavior unchanged (Planner: Europe/Paris; writes: UTC)

## Files Modified

### Schema & Config
- `src/collections/Shows.ts` - Added libretimeInstanceId field
- `config/libretime-instances.json` - Instance configuration

### Server Endpoints  
- `src/app/api/schedule/create/route.ts` - Create with instance mapping
- `src/app/api/schedule/move/route.ts` - Move with instance mapping
- `src/app/api/schedule/delete/route.ts` - Delete with instance mapping
- `src/app/api/libretime/[...path]/route.ts` - Forward x-lt-instance-id header

### Planner UI
- `src/admin/hooks/useUnscheduledEpisodes.ts` - Load show data
- `src/admin/types/calendar.ts` - Add show fields to UnscheduledEpisode
- `src/admin/components/EventPalette.tsx` - Disable unmapped episodes
- `src/integrations/plannerUtils.ts` - Use new server endpoints

### Migration
- `scripts/backfill-libretime-instances.js` - Backfill existing shows

## Testing

### Happy Path
1. Create show with `libretimeInstanceId: "main"`
2. Create episode for that show
3. Drag episode to calendar → schedules successfully
4. Check server logs show instance ID

### Guardrails
1. Create show without `libretimeInstanceId`
2. Create episode for that show  
3. Episode appears disabled in palette with warning
4. Attempt to schedule → server returns `LT_INSTANCE_REQUIRED`
5. Error toast shows with CTA

### Backfill
1. Run backfill script on shows without instance mapping
2. Verify all shows get default instance
3. Episodes become schedulable
