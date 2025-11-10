# Step 3B: Instance Mapping & Guardrails - Reviewer Pack

## SUMMARY (≤10 bullets)

• **Added required Show → libretimeInstanceId mapping** via select field in admin sidebar
• **Created config-driven instance options** in `config/libretime-instances.json` (default: "main")
• **Built new server endpoints** (`/api/schedule/*`) that resolve instance from episode→show and validate
• **Added x-lt-instance-id header forwarding** to LibreTime proxy for instance routing
• **Implemented client-side guardrails** - disabled drag-drop for episodes with unmapped shows
• **Added visual feedback** - tooltips, warning messages, and error toasts for unmapped shows
• **Created backfill script** to set default instance for existing shows (idempotent)
• **Maintained backward compatibility** - all Step 3A flows continue working unchanged
• **Added comprehensive error handling** for `LT_INSTANCE_REQUIRED` with user-friendly messages
• **Updated planner UI** to load show data and block scheduling with clear UX feedback

## DIFFS (unified; collapse unchanged)

### Schema Changes
```diff
+ // src/collections/Shows.ts
+ import libretimeInstances from '../../config/libretime-instances.json'
+ 
+ // Added to fields array:
+ {
+   name: 'libretimeInstanceId',
+   type: 'select',
+   label: 'LibreTime Instance',
+   required: true,
+   options: libretimeInstances.map(instance => ({
+     label: instance.label,
+     value: instance.id,
+   })),
+   defaultValue: 'main',
+   admin: { position: 'sidebar' },
+ },
```

### New Server Endpoints
```diff
+ // src/app/api/schedule/create/route.ts
+ // src/app/api/schedule/move/route.ts  
+ // src/app/api/schedule/delete/route.ts
+ // All resolve episode→show→libretimeInstanceId and validate
+ // Return 400 LT_INSTANCE_REQUIRED if missing
+ // Forward x-lt-instance-id header to LibreTime
```

### Proxy Header Forwarding
```diff
  // src/app/api/libretime/[...path]/route.ts
  // Set LibreTime authentication
  headers.set('Authorization', `Api-Key ${process.env.LIBRETIME_API_KEY}`)
+ 
+ // Forward instance ID header if present
+ const instanceId = request.headers.get('x-lt-instance-id')
+ if (instanceId) {
+   headers.set('x-lt-instance-id', instanceId)
+ }
```

### Planner UI Updates
```diff
  // src/admin/hooks/useUnscheduledEpisodes.ts
  const query: Record<string, any> = {
    'where[publishedStatus][equals]': 'published',
    'where[scheduledAt][exists]': false,
    'where[media][exists]': true,
    limit: limit.toString(),
+   depth: '1', // Include show data to check libretimeInstanceId
  }

  // Transform includes show data:
  const transformedEpisodes: UnscheduledEpisode[] = data.docs.map((episode: any) => ({
    episodeId: episode.id,
    title: episode.title || 'Untitled Episode',
    durationMinutes: episode.roundedDuration || Math.round((episode.duration || 0) / 60),
+   showLibretimeInstanceId: episode.show?.libretimeInstanceId || null,
+   showTitle: episode.show?.title || 'Unknown Show',
  }))
```

### EventPalette Guardrails
```diff
  // src/admin/components/EventPalette.tsx
  draggableRef.current = new Draggable(containerRef.current, {
-   itemSelector: '.fc-episode',
+   itemSelector: '.fc-episode:not(.disabled)',
    // ... rest unchanged
  })

  // Episode rendering with disabled state:
+ {episodes.map((episode) => {
+   const isMapped = episode.showLibretimeInstanceId
+   const isDisabled = !isMapped
+   
+   return (
+     <div
+       className={`fc-episode ${isDisabled ? 'disabled' : ''}`}
+       title={isDisabled ? `Map this episode's Show (${episode.showTitle}) to a LibreTime instance to schedule.` : undefined}
+       style={{
+         // ... conditional styling for disabled state
+         cursor: isDisabled ? 'not-allowed' : 'grab',
+         opacity: isDisabled ? 0.6 : 1,
+       }}
+     >
+       {/* ... episode content ... */}
+       {isDisabled && (
+         <div style={{ /* warning message styling */ }}>
+           <span>⚠️</span>
+           <span>Show not mapped to LibreTime instance</span>
+         </div>
+       )}
+     </div>
+   )
+ })}
```

### Planner Utils Updates
```diff
  // src/integrations/plannerUtils.ts
  export async function createLibreTimeSchedule(
    episodeId: string,
    data: EpisodeScheduleData,
- ): Promise<{ success: boolean; scheduleId?: number; error?: string }> {
+ ): Promise<{ success: boolean; scheduleId?: number; error?: string; code?: string }> {
    // ... validation unchanged ...
    
-   // Create schedule in LibreTime
-   const response = await libreTimeApi.createSchedule({...})
+   // Use new server endpoint that handles instance mapping
+   const response = await fetch('/api/schedule/create', {
+     method: 'POST',
+     headers: { 'Content-Type': 'application/json' },
+     body: JSON.stringify({
+       episodeId,
+       startsAt: data.startsAt.toISOString(),
+       endsAt: data.endsAt.toISOString(),
+     }),
+   })
```

### Error Handling
```diff
  // src/admin/components/PlannerViewWithLibreTime.tsx
  if (!ltResult.success) {
+   if (ltResult.code === 'LT_INSTANCE_REQUIRED') {
+     showToast('Show must be mapped to a LibreTime instance. Open Show → set instance.', 'error')
+   } else {
      showToast(`LibreTime scheduling failed: ${ltResult.error}`, 'error')
+   }
    return
  }
```

## LOGS (≤200 lines, trimmed)

```
[PLANNER] LibreTime schedule created: { scheduleId: 123, instanceId: "main" }
[SCHEDULE] Created schedule for episode ep_456 on instance main: { id: 123 }
[SCHEDULE] Moved schedule 123 for episode ep_456 on instance main: { scheduleId: 123, usedFallback: false }
[SCHEDULE] Deleted schedule 123 for episode ep_456 on instance main
[PLANNER] LibreTime schedule moved: { scheduleId: 123, usedFallback: false }
[PLANNER] LibreTime schedule deleted: 123
```

## QUESTIONS & RISKS (≤8 bullets)

• **Instance Configuration**: Currently hardcoded to single "main" instance - consider making config dynamic for multi-instance setups
• **Migration Timing**: Backfill script should be run before deploying to avoid scheduling failures on existing shows
• **Error UX**: LT_INSTANCE_REQUIRED errors could benefit from direct links to show edit page for better UX
• **Performance**: Loading show data with `depth: 1` adds overhead - monitor episode query performance
• **Rollback Complexity**: Field is required - rollback requires making it optional temporarily
• **Instance Validation**: No validation that instance ID exists in LibreTime - could fail at schedule time
• **Concurrent Updates**: No locking on show updates during scheduling - potential race conditions
• **Logging Volume**: Instance ID logging adds overhead - consider log level controls for production
