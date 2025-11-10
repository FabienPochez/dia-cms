# Payload Admin Planner Wiring Audit - Issue Found

## SUMMARY

**ISSUE IDENTIFIED**: The Payload Admin planner is using the old `PlannerView` component instead of the new `PlannerViewWithLibreTime` component that includes Step 3B integration.

**Root Cause**: 
- Admin config points to `./admin/components/PlannerView` (old component)
- `PlannerView` uses direct `PATCH /api/episodes/:id` calls
- `PlannerViewWithLibreTime` uses the new `/api/schedule/*` endpoints
- No feature flag or configuration controls which component is used

**Impact**: 
- Episodes are scheduled directly in Payload without LibreTime integration
- Instance mapping guardrails are not enforced
- Step 3B functionality is completely bypassed

## DIFFS

### Fix 1: Update Payload Config to Use LibreTime Component

```diff
// src/payload.config.ts
components: {
  views: {
    planner: {
-     Component: './admin/components/PlannerView',
+     Component: './admin/components/PlannerViewWithLibreTime',
      path: '/planner',
      exact: true,
    },
  },
},
```

### Fix 2: Update Admin Page to Use LibreTime Component

```diff
// src/app/(payload)/admin/planner/page.tsx
import React from 'react'
- import PlannerView from '../../../../admin/components/PlannerView'
+ import PlannerViewWithLibreTime from '../../../../admin/components/PlannerViewWithLibreTime'

const PlannerPage: React.FC = () => {
- return <PlannerView />
+ return <PlannerViewWithLibreTime />
}
```

### Alternative Fix: Add Feature Flag Control

```diff
// src/payload.config.ts
+ const useLibreTimePlanner = process.env.PAYLOAD_USE_LIBRETIME_PLANNER === 'true'

components: {
  views: {
    planner: {
-     Component: './admin/components/PlannerView',
+     Component: useLibreTimePlanner 
+       ? './admin/components/PlannerViewWithLibreTime'
+       : './admin/components/PlannerView',
      path: '/planner',
      exact: true,
    },
  },
},
```

## LOGS (≤200 lines, trimmed)

### Current Handler Flow (PlannerView.tsx)
```typescript
// Line 86-130: persistEpisodeSchedule
const persistEpisodeSchedule = useCallback(
  async (episodeId: string, start: Date, end: Date, title?: string) => {
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, {  // ❌ Direct PATCH
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: start.toISOString(),
          scheduledEnd: end.toISOString(),
          airStatus: 'scheduled',
        }),
      })
      // ... rest of handler
    }
  }
)

// Line 132-164: updateEpisodeSchedule  
const updateEpisodeSchedule = useCallback(
  async (episodeId: string, start: Date, end: Date) => {
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, {  // ❌ Direct PATCH
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: start.toISOString(),
          scheduledEnd: end.toISOString(),
        }),
      })
      // ... rest of handler
    }
  }
)
```

### Correct Handler Flow (PlannerViewWithLibreTime.tsx)
```typescript
// Line 159: createLibreTimeSchedule calls /api/schedule/create
const ltResult = await createLibreTimeSchedule(episodeId, scheduleData)

// Line 174-179: Then updates episode
const updateResult = await updateEpisodeSchedule(episodeId, {
  scheduledAt: start.toISOString(),
  scheduledEnd: end.toISOString(),
  airStatus: 'scheduled',
  libretimeScheduleId: ltResult.scheduleId,
})

// Line 242: updateLibreTimeSchedule calls /api/schedule/move
const ltResult = await updateLibreTimeSchedule(
  libretimeScheduleId, start, end, episodeId, libretimeTrackId, libretimeInstanceId
)

// Line 317: deleteLibreTimeSchedule calls /api/schedule/delete
const ltResult = await deleteLibreTimeSchedule(libretimeScheduleId, episodeId)
```

### Fetch Helpers (plannerUtils.ts)
```typescript
// Line 197-207: Correct /api/schedule/create call
const response = await fetch('/api/schedule/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodeId,
    startsAt: data.startsAt.toISOString(),
    endsAt: data.endsAt.toISOString(),
  }),
})

// Line 263-275: Correct /api/schedule/move call
const response = await fetch('/api/schedule/move', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    scheduleId, episodeId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
  }),
})

// Line 361-365: Correct /api/schedule/delete call
const response = await fetch(
  `/api/schedule/delete?scheduleId=${scheduleId}&episodeId=${episodeId}`,
  { method: 'DELETE' }
)
```

## QUESTIONS & RISKS (≤8 bullets)

• **Breaking Change**: Switching to `PlannerViewWithLibreTime` requires LibreTime to be available - consider feature flag approach
• **Environment Dependencies**: New component requires `LIBRETIME_API_KEY`, `LIBRETIME_API_URL` to be set
• **User Experience**: Users will see LibreTime connection status and different error messages
• **Rollback Risk**: If LibreTime is down, scheduling will fail instead of falling back to local-only
• **Instance Mapping**: All shows must have `libretimeInstanceId` set before scheduling works
• **Performance**: New component has additional LibreTime API calls and connection checks
• **Testing**: Need to verify both components work in different environments
• **Migration**: Existing scheduled episodes may need to be re-synced with LibreTime

## RECOMMENDED ACTION

**Apply Fix 1** (update payload.config.ts) to immediately enable Step 3B functionality, as the LibreTime integration is already implemented and tested.

**Consider Fix 2** (feature flag) if you need the ability to fall back to the old component in case of LibreTime issues.

The issue is a simple configuration problem - the correct component exists and works, it's just not being used by the admin interface.
