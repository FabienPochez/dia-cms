# Reviewer Pack: Planner "New" Tab Implementation

## SUMMARY

- Added "New" tab to Planner EventPalette that displays episodes with `airStatus="queued"`
- Created `useQueuedEpisodes` hook to fetch queued episodes (mirrors `useUnscheduledEpisodes` structure)
- Reused existing Archive episode card UI for New tab (same visuals, filters, drag-and-drop)
- Updated EventPalette to conditionally fetch episodes based on active tab (Archive vs New)
- Enhanced Draggable initialization to reinitialize on tab switch (includes `activeTab` in dependency array)
- No changes to drag-and-drop behavior or schedule-writing logic (uses existing FullCalendar Draggable)
- No changes to publishedStatus or airStatus mutation logic (episodes remain queued until scheduled by existing flow)

## DIFFS

### New File: `src/admin/hooks/useQueuedEpisodes.ts`
```diff
+ 'use client'
+
+ import { useState, useEffect, useRef } from 'react'
+ import { isLtReady, UnscheduledEpisode } from '../types/calendar'
+
+ interface UseQueuedEpisodesOptions {
+   limit?: number
+ }
+
+ interface UseQueuedEpisodesReturn {
+   episodes: UnscheduledEpisode[]
+   loading: boolean
+   error: string | null
+   refetch: () => void
+ }
+
+ export const useQueuedEpisodes = ({
+   limit = 2000,
+ }: UseQueuedEpisodesOptions = {}): UseQueuedEpisodesReturn => {
+   // ... implementation mirrors useUnscheduledEpisodes but filters for airStatus='queued'
+   // Query: 'where[airStatus][equals]': 'queued'
+   // Same LT-ready checks, duration slot filtering, and transformation logic
+ }
```

### Modified: `src/admin/components/EventPalette.tsx`

**Key Changes:**
1. **Import new hook:**
```diff
+ import { useQueuedEpisodes } from '../hooks/useQueuedEpisodes'
```

2. **Conditional episode fetching:**
```diff
-  // Fetch ALL LT-ready episodes (filter client-side) - only for archive tab
-  const {
-    episodes: allEpisodes,
-    loading,
-    error,
-    refetch,
-  } = useUnscheduledEpisodes({
-    limit: activeTab === 'archive' ? 2000 : 0,
-  })
+  // Fetch episodes based on active tab
+  const {
+    episodes: archiveEpisodes,
+    loading: archiveLoading,
+    error: archiveError,
+    refetch: archiveRefetch,
+  } = useUnscheduledEpisodes({
+    limit: activeTab === 'archive' ? 2000 : 0,
+  })
+
+  const {
+    episodes: queuedEpisodes,
+    loading: queuedLoading,
+    error: queuedError,
+    refetch: queuedRefetch,
+  } = useQueuedEpisodes({
+    limit: activeTab === 'new' ? 2000 : 0,
+  })
+
+  // Select episodes, loading, error, and refetch based on active tab
+  const allEpisodes = activeTab === 'archive' ? archiveEpisodes : activeTab === 'new' ? queuedEpisodes : []
+  const loading = activeTab === 'archive' ? archiveLoading : activeTab === 'new' ? queuedLoading : false
+  const error = activeTab === 'archive' ? archiveError : activeTab === 'new' ? queuedError : null
+  const refetch = activeTab === 'archive' ? archiveRefetch : activeTab === 'new' ? queuedRefetch : () => {}
```

3. **Draggable reinitialization on tab switch:**
```diff
-    const currentHash = episodes.map((ep) => ep.episodeId).join(',')
+    const currentHash = `${activeTab}:${episodes.map((ep) => ep.episodeId).join(',')}`
-  }, [episodes])
+  }, [episodes, activeTab])
```

4. **New tab content (replaces placeholder):**
```diff
-      {activeTab === 'new' && (
-        <div>Coming soon...</div>
-      )}
+      {activeTab === 'new' && (
+        <>
+          <EpisodeFilters ... />
+          {/* Loading/Error states */}
+          <div ref={containerRef}>
+            {episodes.map((episode) => {
+              // Same episode card rendering as Archive tab
+              // Same .fc-episode class, data attributes, styling
+            })}
+          </div>
+        </>
+      )}
```

**Full diff stats:**
- `EventPalette.tsx`: ~500 lines added (New tab implementation reusing Archive UI)
- `useQueuedEpisodes.ts`: ~200 lines (new file)

## VALIDATION CHECKLIST

- [x] Queued episode appears in New tab
- [x] Dragging from New into planner creates schedule entry (same as Archive)
- [x] Episode card UI matches Archive tab (cover, title, metadata, play button)
- [x] Filters work for New tab (search, mood, tone, energy, duration, play count)
- [x] Drag-and-drop reinitializes correctly when switching tabs
- [x] No regressions to Archive tab functionality
- [x] No changes to schedule-writing logic (uses existing `handleEventReceive` in PlannerView)
- [x] No changes to airStatus mutation (episodes remain queued until scheduled)

## QUESTIONS & RISKS

1. **AirStatus lifecycle**: Episodes with `airStatus="queued"` remain queued after scheduling. The existing scheduling logic writes `scheduledAt`/`scheduledEnd` but doesn't update `airStatus`. Is this expected, or should scheduling update `airStatus` to "scheduled"? (Not implemented per requirements - no state mutations)

2. **Filter persistence**: New tab filters are namespaced (`planner.filters.v1.new`) and persist separately from Archive filters. This is intentional and matches existing behavior.

3. **Performance**: Both hooks fetch up to 2000 episodes when their respective tabs are active. This matches Archive tab behavior. Consider pagination if performance becomes an issue.

4. **Empty state**: New tab shows "No queued episodes available" when empty (vs Archive's "No LT-ready episodes available"). This is intentional to differentiate the two tabs.

5. **Tab switching**: Draggable is reinitialized on tab switch (includes `activeTab` in dependency array). This ensures drag-and-drop works correctly when switching between Archive and New tabs.

6. **Duration slot filtering**: New tab uses the same duration slot filtering as Archive (30/60/90/120/180+ minutes). This ensures consistency across tabs.

