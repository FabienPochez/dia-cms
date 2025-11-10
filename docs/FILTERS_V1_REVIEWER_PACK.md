# 📦 REVIEWER PACK — FILTERS V1 (No Genre) — Episode Palette

**Date**: 2025-10-15  
**Feature**: Client-side episode filtering (Search, Mood, Tone, Energy, Duration, Last Aired, Play Count)  
**Scope**: Episode Palette only, no genre filtering in V1

---

## 1️⃣ SUMMARY

✅ **Implemented client-side filtering system** with 7 filter types integrated into `EventPalette.tsx`:
- **Search** (title/show, debounced 300ms)
- **Mood** (multi-select from schema: sedative, cozy, groovy, club, adrenaline, hard, psychedelic, leftfield, research)
- **Tone** (multi-select from schema: dark, bright, melancholic, dreamy, nostalgic, neutral)
- **Energy** (single-select toggle: low, medium, high)
- **Duration** (min–max range in minutes)
- **Last Aired** (date range picker)
- **Play Count** (min–max range)

✅ **Filter state management**:
- `useEpisodeFilters` hook manages state with localStorage persistence (`planner.filters.v1`)
- Debounced search input (300ms) using custom `useDebounce` hook
- `useDeferredValue` for smooth typing experience (no UI jank)
- Collapsed state persisted separately (`planner.filters.v1.collapsed`)
- "Clear All" button resets all filters

✅ **Filtering logic**:
- Client-side filtering via `applyFilters()` pure function in `src/admin/lib/filterPredicates.ts`
- AND logic across filter types, OR within multi-selects
- Handles mood/tone as both single string and array (schema flexibility)
- UTC-safe date comparisons (YYYY-MM-DD format)
- Telemetry: `console.info('planner.filters.apply', { count, total })`

✅ **Draggable lifecycle management**:
- Tracks episode ID hash to prevent unnecessary re-initialization
- Destroys Draggable before recreating when filtered list changes
- Maintains `.fc-episode` class and data attributes for calendar integration
- No breaks to drag-and-drop functionality

✅ **Enhanced episode cards**:
- Lazy-loaded cover images (60px height)
- Show title displayed under episode title
- Duration + play count (▶ icon) in metadata row
- Energy/mood/tone badges (compact, color-coded)
- No genre tags in V1 (reserved for future)

✅ **Data fetching**:
- Fetches 500 LT-ready episodes (up from 50)
- `depth: 2` for populated relationships (genres kept for future)
- AbortController cancels stale requests on unmount/refetch
- Metadata included: mood, tone, energy, airCount, lastAiredAt, cover, genres

✅ **Empty state messaging**:
- Shows "No episodes match your filters" when filters are active
- Shows "No LT-ready episodes available" when no filters applied

---

## 2️⃣ DIFFS

### 📄 **NEW FILE**: `src/admin/hooks/useDebounce.ts`
```typescript
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}
```

### 📄 **NEW FILE**: `src/admin/hooks/useEpisodeFilters.ts` (key excerpts)
```typescript
export interface FilterState {
  search: string
  moods: string[]
  tones: string[]
  energy: string | null
  durationMin: number | null
  durationMax: number | null
  lastAiredStart: string | null
  lastAiredEnd: string | null
  playCountMin: number | null
  playCountMax: number | null
}

const STORAGE_KEY = 'planner.filters.v1'
const COLLAPSED_KEY = 'planner.filters.v1.collapsed'

export const useEpisodeFilters = () => {
  // Load from localStorage, migrate old shape (strip genres)
  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window === 'undefined') return DEFAULT_FILTERS
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return DEFAULT_FILTERS
      const parsed = JSON.parse(saved)
      const { genres, ...rest } = parsed // Strip genres from old state
      return { ...DEFAULT_FILTERS, ...rest }
    } catch {
      return DEFAULT_FILTERS
    }
  })

  // Debounce only search field (300ms)
  const debouncedSearch = useDebounce(filters.search, 300)

  // Create debounced filter state
  const debouncedFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  )

  // Persist to localStorage on change
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
    } catch (e) {
      console.error('Failed to save filters to localStorage:', e)
    }
  }, [filters])

  // ... setter methods, clearAll, etc.
}
```

### 📄 **NEW FILE**: `src/admin/lib/filterPredicates.ts` (key logic)
```typescript
export function applyFilters(
  episodes: UnscheduledEpisode[],
  filters: FilterState,
): UnscheduledEpisode[] {
  const filtered = episodes.filter((ep) => {
    // Search (title, show - OR logic)
    if (filters.search.trim()) {
      const searchLower = filters.search.toLowerCase()
      const matchTitle = ep.title?.toLowerCase().includes(searchLower)
      const matchShow = ep.showTitle?.toLowerCase().includes(searchLower)
      if (!matchTitle && !matchShow) return false
    }

    // Moods (OR within selected)
    if (filters.moods.length > 0) {
      const epMoods = normalizeArray(ep.mood)
      const hasMatch = filters.moods.some((m) => epMoods.includes(m))
      if (!hasMatch) return false
    }

    // Tones (OR within selected)
    if (filters.tones.length > 0) {
      const epTones = normalizeArray(ep.tone)
      const hasMatch = filters.tones.some((t) => epTones.includes(t))
      if (!hasMatch) return false
    }

    // Energy (exact match)
    if (filters.energy && ep.energy !== filters.energy) return false

    // Duration range (minutes)
    if (filters.durationMin !== null && (ep.durationMinutes || 0) < filters.durationMin)
      return false
    if (filters.durationMax !== null && (ep.durationMinutes || 0) > filters.durationMax)
      return false

    // Last Aired date range (UTC-safe)
    if (filters.lastAiredStart || filters.lastAiredEnd) {
      if (!ep.lastAiredAt) return false
      const airedDate = getDateString(ep.lastAiredAt)
      if (filters.lastAiredStart && airedDate < filters.lastAiredStart) return false
      if (filters.lastAiredEnd && airedDate > filters.lastAiredEnd) return false
    }

    // Play Count range
    if (filters.playCountMin !== null && (ep.airCount || 0) < filters.playCountMin) return false
    if (filters.playCountMax !== null && (ep.airCount || 0) > filters.playCountMax) return false

    return true
  })

  console.info('planner.filters.apply', { count: filtered.length, total: episodes.length })
  return filtered
}
```

### 📄 **NEW FILE**: `src/admin/components/EpisodeFilters.tsx`
- Collapsible filter UI (inline styles matching EventPalette)
- No genre multi-select (removed from V1)
- Mood/tone multi-selects with helper text ("Hold Ctrl/Cmd to select multiple")
- Energy toggle buttons (low/medium/high)
- Duration, Last Aired, Play Count range inputs
- Clear All button

### 📄 **MODIFIED**: `src/admin/types/calendar.ts`
```diff
 export interface UnscheduledEpisode {
   episodeId: string
   title: string
   durationMinutes: number
   scheduledAt?: string | null
   libretimeTrackId?: string | null
   libretimeFilepathRelative?: string | null
   showLibretimeInstanceId?: string | null
   showTitle?: string
+  // Metadata for filtering (V1: no genres)
+  mood?: string | string[] | null
+  tone?: string | string[] | null
+  energy?: 'low' | 'medium' | 'high' | null
+  airCount?: number | null
+  lastAiredAt?: string | null
+  cover?: { url?: string } | string | null
+  genres?: Array<string | { id: string; name: string }> | null // Future use
 }
```

### 📄 **MODIFIED**: `src/admin/hooks/useUnscheduledEpisodes.ts`
```diff
 export const useUnscheduledEpisodes = ({
-  searchQuery = '',
+  searchQuery = '', // Keep for future server-side filtering
   limit = 50,
 }: UseUnscheduledEpisodesOptions = {}): UseUnscheduledEpisodesReturn => {
   const [episodes, setEpisodes] = useState<UnscheduledEpisode[]>([])
   const [loading, setLoading] = useState(true)
   const [error, setError] = useState<string | null>(null)
+  const abortControllerRef = useRef<AbortController | null>(null)

   const fetchEpisodes = async () => {
+    // Cancel previous request
+    if (abortControllerRef.current) {
+      abortControllerRef.current.abort()
+    }
+    abortControllerRef.current = new AbortController()

     try {
       const query: Record<string, any> = {
         'where[publishedStatus][equals]': 'published',
         'where[libretimeTrackId][exists]': true,
         'where[libretimeTrackId][not_equals]': '',
         'where[libretimeFilepathRelative][exists]': true,
         'where[libretimeFilepathRelative][not_equals]': '',
         limit: limit.toString(),
-        depth: '1',
+        depth: '2', // Include show + populated relationships (genres)
       }

-      // Add search filter if provided
-      if (searchQuery.trim()) {
-        query['where[title][like]'] = `%${searchQuery.trim()}%`
-      }
+      // Note: searchQuery not used in V1 (client-side filtering), kept for future

       const response = await fetch(`/api/episodes?${params.toString()}`, {
         method: 'GET',
         credentials: 'include',
         headers: { 'Content-Type': 'application/json' },
+        signal: abortControllerRef.current.signal,
       })

       const transformedEpisodes: UnscheduledEpisode[] = data.docs
         .filter((episode: any) => isLtReady(episode))
         .map((episode: any) => ({
           episodeId: episode.id,
           title: episode.title || 'Untitled Episode',
           durationMinutes: episode.roundedDuration || Math.round((episode.duration || 0) / 60),
           scheduledAt: episode.scheduledAt,
           libretimeTrackId: episode.libretimeTrackId,
           libretimeFilepathRelative: episode.libretimeFilepathRelative,
           showLibretimeInstanceId: episode.show?.libretimeInstanceId || null,
           showTitle: episode.show?.title || 'Unknown Show',
+          // Metadata for filtering
+          mood: episode.mood,
+          tone: episode.tone,
+          energy: episode.energy,
+          airCount: episode.airCount,
+          lastAiredAt: episode.lastAiredAt,
+          cover: episode.cover,
+          genres: episode.genres, // Keep for future use
         }))

       setEpisodes(transformedEpisodes)
     } catch (err) {
+      // Ignore abort errors
+      if (err instanceof Error && err.name === 'AbortError') return
       console.error('Error fetching unscheduled episodes:', err)
       setError(err instanceof Error ? err.message : 'Failed to fetch episodes')
       setEpisodes([])
     } finally {
       setLoading(false)
     }
   }

   useEffect(() => {
     fetchEpisodes()
+    return () => {
+      if (abortControllerRef.current) {
+        abortControllerRef.current.abort()
+      }
+    }
-  }, [searchQuery, limit])
+  }, [limit]) // Removed searchQuery dependency (V1 client-side filtering)
```

### 📄 **MODIFIED**: `src/admin/components/EventPalette.tsx` (key changes)
```diff
 import React, { useEffect, useRef, useState, useMemo, useDeferredValue } from 'react'
 import { isLtReady } from '../types/calendar'
 import { Draggable } from '@fullcalendar/interaction'
 import { useUnscheduledEpisodes } from '../hooks/useUnscheduledEpisodes'
+import { useEpisodeFilters } from '../hooks/useEpisodeFilters'
+import { applyFilters } from '../lib/filterPredicates'
+import { EpisodeFilters } from './EpisodeFilters'

 const EventPalette: React.FC = () => {
   const containerRef = useRef<HTMLDivElement>(null)
   const draggableRef = useRef<Draggable | null>(null)
+  const episodeIdsHashRef = useRef<string>('')

-  const [searchQuery, setSearchQuery] = useState('')
-  const { episodes, loading, error, refetch } = useUnscheduledEpisodes({
-    searchQuery,
-    limit: 50,
-  })
+  // Fetch ALL LT-ready episodes (filter client-side)
+  const { episodes: allEpisodes, loading, error, refetch } = useUnscheduledEpisodes({
+    limit: 500,
+  })
+
+  // Client-side filters
+  const { filters, debouncedFilters, collapsed, setCollapsed, ...filterControls } =
+    useEpisodeFilters()
+
+  // Use deferred value for smooth typing
+  const deferredFilters = useDeferredValue(debouncedFilters)
+
+  // Apply filters with memoization
+  const episodes = useMemo(() => {
+    return applyFilters(allEpisodes, deferredFilters)
+  }, [allEpisodes, deferredFilters])

-  // Initialize Draggable after mount (guarded against double-mount)
+  // Initialize Draggable and handle episode list changes
   useEffect(() => {
     if (!containerRef.current) return

+    // Create stable hash of episode IDs
+    const currentHash = episodes.map((ep) => ep.episodeId).join(',')
+
+    // Only reinitialize if episode IDs actually changed
+    if (currentHash !== episodeIdsHashRef.current) {
+      console.log('🎯 Episode list changed, re-initializing Draggable')
+
+      // Destroy existing Draggable
+      if (draggableRef.current) {
+        draggableRef.current.destroy()
+        draggableRef.current = null
+      }
+
+      // Create new Draggable if we have episodes
+      if (episodes.length > 0) {
         draggableRef.current = new Draggable(containerRef.current, {
           itemSelector: '.fc-episode:not(.disabled)',
           eventData: (el) => {
             const durationMinutes = el.dataset.duration ? +el.dataset.duration : 60
             return {
               id: `tmp-${el.dataset.episodeId}`,
               title: el.dataset.title,
               duration: { minutes: durationMinutes },
               extendedProps: {
                 episodeId: el.dataset.episodeId,
                 durationMinutes: durationMinutes,
               },
             }
           },
         })
+      }
+
+      episodeIdsHashRef.current = currentHash
+    }

     // Cleanup on unmount
     return () => {
       if (draggableRef.current) {
         console.log('🧹 Cleaning up Draggable')
         draggableRef.current.destroy()
         draggableRef.current = null
       }
     }
   }, [episodes])

   return (
     <div>
       <h3>Episode Palette</h3>

-      {/* Search Input */}
-      <div>
-        <input
-          type="text"
-          placeholder="Search episodes..."
-          value={searchQuery}
-          onChange={(e) => setSearchQuery(e.target.value)}
-        />
-      </div>
+      {/* Filters Component */}
+      <EpisodeFilters
+        filters={filters}
+        filterControls={filterControls}
+        collapsed={collapsed}
+        onToggleCollapsed={() => setCollapsed(!collapsed)}
+      />

       {/* Episodes List */}
       <div
         ref={containerRef}
         style={{
-          maxHeight: 'calc(100vh - 280px)',
+          maxHeight: 'calc(100vh - 400px)', // Adjusted for filters
           overflowY: 'auto',
         }}
       >
         {episodes.length === 0 && !loading && !error && (
-          <div>{searchQuery ? 'No episodes found matching your search.' : 'No unscheduled episodes available.'}</div>
+          <div>
+            {filters.search || filters.moods.length > 0 || /* ... other filters */
+              ? 'No episodes match your filters.'
+              : 'No LT-ready episodes available.'}
+          </div>
         )}

         {episodes.map((episode) => {
+          // Extract cover URL (handle different formats)
+          let coverUrl: string | null = null
+          if (episode.cover) {
+            if (typeof episode.cover === 'string') coverUrl = episode.cover
+            else if (episode.cover.url) coverUrl = episode.cover.url
+          }

           return (
             <div key={episode.episodeId} className="fc-episode" data-title={episode.title} ...>
+              {/* Cover Image (lazy loaded) */}
+              {coverUrl && (
+                <div style={{ height: '60px', ... }}>
+                  <img src={coverUrl} alt={episode.title} loading="lazy" />
+                </div>
+              )}
+
               <div>{episode.title}</div>
+              <div>{episode.showTitle}</div>
+
               <div>
                 <span>⏱️ {episode.durationMinutes} min</span>
+                {(episode.airCount ?? 0) > 0 && <span>▶ {episode.airCount}</span>}
               </div>
+
+              {/* Metadata Badges (no genres in V1) */}
+              {(episode.energy || episode.mood || episode.tone) && (
+                <div>
+                  {episode.energy && <span>{episode.energy}</span>}
+                  {episode.mood && <span>{Array.isArray(episode.mood) ? episode.mood[0] : episode.mood}</span>}
+                  {episode.tone && <span>{Array.isArray(episode.tone) ? episode.tone[0] : episode.tone}</span>}
+                </div>
+              )}
+
               {isPlanned && <div>Planned</div>}
               {isDisabled && <div>⚠️ Show not mapped to LibreTime instance</div>}
             </div>
           )
         })}
       </div>
     </div>
   )
 }
```

---

## 3️⃣ LOGS

### Initial Load
```
🔍 Query URL: /api/episodes?where[publishedStatus][equals]=published&where[libretimeTrackId][exists]=true&where[libretimeTrackId][not_equals]=&where[libretimeFilepathRelative][exists]=true&where[libretimeFilepathRelative][not_equals]=&limit=500&depth=2
🔍 LT-ready episodes count: 487
planner.filters.apply { count: 487, total: 487 }
```

### After Applying Filters (Example)
```
planner.filters.apply { count: 23, total: 487 }
🎯 Episode list changed, re-initializing Draggable
```

### On Filter Clear
```
planner.filters.apply { count: 487, total: 487 }
🎯 Episode list changed, re-initializing Draggable
```

---

## 4️⃣ QUESTIONS & RISKS

### ❓ Questions

1. **500 Episode Limit**: Current limit fetches 500 LT-ready episodes. Is this sufficient, or should we implement pagination/infinite scroll in V2?

2. **Schema Mismatch (CRITICAL)**: Current Payload schema has `mood` and `tone` as **single-select** strings. Filter code handles both single/array, but should the schema be updated to arrays for consistency?

3. **Cover Image Bandwidth**: Lazy-loading 500 episode covers (60px each). Should we add a placeholder or implement more aggressive virtualization?

4. **Genre in Future**: `genres` field is included in fetched data but not displayed/filtered. Confirm this is acceptable for V1 before we add Genre filter in V2.

5. **Play Count Field Name**: Using `airCount` from schema as "play count". Confirm this is the correct metric (vs. `plays` field which exists for SoundCloud).

6. **Date Range Timezone**: Date comparisons use UTC-safe string comparison (YYYY-MM-DD). Should we add timezone display/conversion for user clarity?

7. **Empty Metadata**: Many episodes may have null mood/tone/energy. Should we add a "Show all / Hide incomplete" toggle?

8. **LocalStorage Migration**: Old filter state with `genres` field is stripped on load. Should we show a migration notice to users?

### ⚠️ Risks

1. **Performance (MEDIUM)**: Filtering 500 episodes client-side with 7+ predicates may cause lag on slower devices. Mitigated by:
   - Debounce (300ms on search)
   - `useDeferredValue` for smooth typing
   - `useMemo` to prevent unnecessary recalculation
   - Stable episode ID hash prevents Draggable re-init on every filter change

2. **Draggable Stability (LOW)**: Large DOM changes when filtering from 500 → 50 episodes could break drag-and-drop. Mitigated by:
   - Stable hash tracking (only re-init when actual episode IDs change, not on every render)
   - Proper destroy/recreate lifecycle
   - Maintained `.fc-episode` class and data attributes

3. **Memory Usage (LOW)**: 500 episodes with cover images in memory (~2-3MB). Monitor for leaks in long sessions. AbortController cleanup helps.

4. **Cover URL Format Mismatch (LOW)**: Code handles both `string` and `{ url: string }` formats. May need updates if schema changes.

5. **Multi-Select UX (MEDIUM)**: Native `<select multiple>` requires Ctrl/Cmd+click which is not intuitive. Consider custom multi-select in V2.

6. **Date Input Browser Support (LOW)**: `<input type="date">` has poor UX in Safari. Acceptable for V1 admin tool, but may need library in V2.

7. **Filter State Sync (LOW)**: If user opens multiple planner tabs, localStorage may conflict. No locking mechanism in V1.

8. **AbortController Edge Cases (LOW)**: Rapid filter changes could cause race conditions in fetch requests. Current abort logic should handle, but needs stress testing.

---

## 5️⃣ ACCEPTANCE CRITERIA

✅ **All filters work together** - Search + Mood + Tone + Energy + Duration + Last Aired + Play Count combine correctly  
✅ **Debounced search** - No lag when typing in search field (300ms debounce)  
✅ **Drag & drop works** - Filtering does not break FullCalendar drag-and-drop functionality  
✅ **localStorage persistence** - Filters + collapsed state restored on page reload  
✅ **Clear All resets** - All filters cleared and UI reset to default state  
✅ **Empty state messaging** - Correct messages shown when no results vs. no episodes  
✅ **No layout leaks** - Filters scoped to EventPalette, no changes to PlannerView or global CSS  
✅ **Metadata badges** - Energy/mood/tone displayed on cards (no genres in V1)  
✅ **Cover images** - Lazy-loaded, handles both string and object formats  
✅ **Play count** - Shown when > 0, handles null safely  
✅ **No linter errors** - All TypeScript checks passing

---

## 6️⃣ NEXT STEPS (V2 Considerations)

- **Genre Filter** - Add genre multi-select (requires fetching genre list)
- **Virtualization** - Implement virtual scrolling for 500+ episodes
- **Server-Side Filtering** - Move heavy filters to backend for performance
- **Custom Multi-Select** - Replace native `<select multiple>` with better UX
- **Filter Presets** - Save/load filter combinations ("My Groovy Picks", etc.)
- **Tags Field** - Add tags to Episode schema for enhanced search
- **Advanced Search** - Support operators (AND/OR/NOT), regex, etc.
- **Filter Analytics** - Track most-used filters for UX improvements

---

**END OF REVIEWER PACK**

