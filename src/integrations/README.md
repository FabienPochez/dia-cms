# LibreTime Integration

This directory contains the LibreTime v2 API integration for the Payload Planner.

## Files

- `libretimeClient.ts` - Server-side LibreTime API client with full v2 support
- `libretimeApi.ts` - Client-side API wrapper for secure communication
- `plannerUtils.ts` - Utility functions for Planner integration
- `README.md` - This documentation

## Features

### Server-side Client (`libretimeClient.ts`)
- Full LibreTime v2 API support
- Robust error handling with retries
- UTC timezone handling
- File validation and overlap checking
- Type-safe interfaces

### Client-side API (`libretimeApi.ts`)
- Secure API proxy through Next.js API routes
- No API keys exposed to client
- Error handling and response formatting
- Type-safe request/response handling

### Planner Utilities (`plannerUtils.ts`)
- Timezone conversion (Paris to UTC)
- Schedule validation and conflict detection
- Episode update helpers
- Toast notifications
- Debounced operations

## Usage

### In the Planner Component

```typescript
import { PlannerViewWithLibreTime } from '@/admin/components/PlannerViewWithLibreTime'

// Use the LibreTime-enabled planner
<PlannerViewWithLibreTime />
```

### Direct API Usage

```typescript
import { libreTimeApi } from '@/integrations/libretimeApi'

// Create a schedule
const result = await libreTimeApi.createSchedule({
  file: 123,
  instance: 1,
  starts_at: '2025-09-18T15:00:00Z',
  ends_at: '2025-09-18T17:00:00Z',
})

if (result.success) {
  console.log('Schedule created:', result.data?.schedule)
} else {
  console.error('Error:', result.error)
}
```

### Utility Functions

```typescript
import { 
  validateScheduleWindow, 
  updateEpisodeSchedule,
  showToast 
} from '@/integrations/plannerUtils'

// Validate a schedule window
const validation = await validateScheduleWindow(startDate, endDate)
if (!validation.valid) {
  validation.conflicts.forEach(conflict => {
    showToast(conflict.message, 'error')
  })
}

// Update episode in Payload
await updateEpisodeSchedule(episodeId, {
  scheduledAt: startDate.toISOString(),
  scheduledEnd: endDate.toISOString(),
  airStatus: 'scheduled'
})
```

## Environment Variables

Required server-side environment variables:

```bash
LIBRETIME_BASE_URL=http://api:9001  # LibreTime API base URL
LIBRETIME_API_KEY=your_api_key      # LibreTime API key
```

## API Endpoints

The integration provides a secure API proxy at `/api/libretime`:

### GET Parameters
- `action=test` - Test LibreTime connection
- `action=files` - Get files (with optional q, limit, offset, hidden, scheduled params)
- `action=shows` - Get shows (with optional limit, offset, search params)
- `action=instances` - Get instances (with optional limit, offset, show, starts, ends params)
- `action=schedule` - Get schedule (with optional limit, offset, starts, ends params)

### POST Actions
- `action=create-schedule` - Create new schedule entry
- `action=update-schedule` - Update existing schedule entry
- `action=delete-schedule` - Delete schedule entry
- `action=validate-file` - Validate file exists and is available
- `action=check-overlaps` - Check for schedule conflicts

## Error Handling

The integration provides comprehensive error handling:

- **Network errors**: Automatic retry with exponential backoff
- **Authentication errors**: Clear error messages for API key issues
- **Validation errors**: Detailed feedback for invalid schedules
- **Conflict errors**: Overlap detection and reporting
- **Toast notifications**: User-friendly error messages

## Testing

Run the integration test:

```bash
npm run tsx scripts/test-libretime-integration.ts
```

This will test:
- LibreTime connection
- File retrieval and validation
- Show and instance retrieval
- Schedule operations
- Overlap checking

## Security

- API keys are never exposed to the client
- All LibreTime communication goes through server-side proxy
- Request validation and sanitization
- Error messages don't leak sensitive information

## Timezone Handling

- All times are converted to UTC before sending to LibreTime
- Planner UI can display in local timezone
- Conversion utilities handle Paris to UTC conversion
- LibreTime stores and returns times in UTC

## Future Enhancements

- Batch operations for multiple episodes
- Real-time sync with LibreTime changes
- Advanced conflict resolution
- Schedule templates and presets
- Integration with LibreTime playlists
