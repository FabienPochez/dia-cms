# 📦 REVIEWER PACK — Time-Aware Planned Status

**Date**: 2025-10-15  
**Feature**: Replace binary "planned" styling with time-aware status badges  
**Scope**: Episode cards display logic only, no filter/drag changes

---

## 1️⃣ SUMMARY

✅ **Time-aware plan status system** with 4 states:
- **Recent** (scheduled within last 30 days): Green card background + green badge "Planned • X ago"
- **Future** (scheduled after now): White background + blue badge "Scheduled • in X"
- **Old** (scheduled >30 days ago): White background + grey badge "Planned • X ago"
- **None** (not scheduled): White background + no badge

✅ **Enhanced relative time formatting**:
- Future dates now display "in X" (e.g., "in 5 days", "in 2 hours")
- Past dates display "X ago" (existing behavior preserved)
- No external libraries, mirrors existing thresholds

✅ **New plan status utility** (`planStatus.ts`):
- Pure function `getPlanStatus()` determines status from scheduledAt timestamp
- Configurable `PLANNED_RECENT_DAYS = 30` constant for easy tuning
- Type-safe with `PlanStatus` union type

✅ **Badge styling tokens** (inline):
- Green (recent): `#28a745` text, `#d4edda` bg, `#c3e6cb` border
- Blue (future): `#0d6efd` text, `#e7f1ff` bg, `#b3d7ff` border
- Grey (old): `#6c757d` text, `#f8f9fa` bg, `#dee2e6` border

✅ **Background color logic updated**:
- Only "recent" status gets green background (`#f0f8f0`)
- Future/old/none use white background (cleaner visual hierarchy)
- Disabled episodes maintain grey background

✅ **Badge placement**: Positioned after play count, before energy/mood/tone badges

✅ **No breaking changes**: Drag-and-drop, filters, grid layout all unchanged

✅ **Preserves existing behavior**: `.fc-episode` class and data attributes intact

---

## 2️⃣ DIFFS

### 📄 **MODIFIED**: `src/admin/lib/formatRelativeTime.ts`

```diff
 /**
- * Format ISO date string to relative time (e.g., "23 days ago", "3 months ago")
+ * Format ISO date string to relative time (e.g., "23 days ago", "in 5 days")
  * @param isoString - ISO date string
  * @param now - Current timestamp (default: Date.now())
  * @returns Relative time string in English
  */
 export function formatRelativeTime(isoString: string, now: number = Date.now()): string {
   const date = new Date(isoString)
-  const diffMs = now - date.getTime()
-  const diffSec = Math.floor(diffMs / 1000)
-  const diffMin = Math.floor(diffSec / 60)
-  const diffHour = Math.floor(diffMin / 60)
-  const diffDay = Math.floor(diffHour / 24)
-  const diffWeek = Math.floor(diffDay / 7)
-  const diffMonth = Math.floor(diffDay / 30)
-  const diffYear = Math.floor(diffDay / 365)
+  const diffMs = date.getTime() - now
+  const absDiffMs = Math.abs(diffMs)
+  const isFuture = diffMs > 0
+
+  const diffSec = Math.floor(absDiffMs / 1000)
+  const diffMin = Math.floor(diffSec / 60)
+  const diffHour = Math.floor(diffMin / 60)
+  const diffDay = Math.floor(diffHour / 24)
+  const diffWeek = Math.floor(diffDay / 7)
+  const diffMonth = Math.floor(diffDay / 30)
+  const diffYear = Math.floor(diffDay / 365)
+
+  // Future dates: "in X"
+  if (isFuture) {
+    if (diffSec < 60) return 'in moments'
+    if (diffMin < 60) return `in ${diffMin} min`
+    if (diffHour < 24) return `in ${diffHour} hour${diffHour > 1 ? 's' : ''}`
+    if (diffDay < 7) return `in ${diffDay} day${diffDay > 1 ? 's' : ''}`
+    if (diffWeek < 5) return `in ${diffWeek} week${diffWeek > 1 ? 's' : ''}`
+    if (diffMonth < 12) return `in ${diffMonth} month${diffMonth > 1 ? 's' : ''}`
+    return `in ${diffYear} year${diffYear > 1 ? 's' : ''}`
+  }

+  // Past dates: "X ago"
   if (diffSec < 60) return 'just now'
   if (diffMin < 60) return `${diffMin} min ago`
   if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`
   if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`
   if (diffWeek < 5) return `${diffWeek} week${diffWeek > 1 ? 's' : ''} ago`
   if (diffMonth < 12) return `${diffMonth} month${diffMonth > 1 ? 's' : ''} ago`
   return `${diffYear} year${diffYear > 1 ? 's' : ''} ago`
 }
```

### 📄 **NEW FILE**: `src/admin/lib/planStatus.ts`

```typescript
export type PlanStatus = 'recent' | 'future' | 'old' | 'none'

export const PLANNED_RECENT_DAYS = 30

/**
 * Determine the plan status of an episode based on its scheduledAt timestamp
 * @param scheduledAt - ISO date string of when episode is/was scheduled
 * @param now - Current timestamp (default: Date.now())
 * @returns Plan status: recent (last 30 days), future, old (>30 days ago), or none
 */
export function getPlanStatus(scheduledAt?: string | null, now: number = Date.now()): PlanStatus {
  if (!scheduledAt) return 'none'

  const ts = new Date(scheduledAt).getTime()
  if (isNaN(ts)) return 'none'

  const diffMs = now - ts
  const days = diffMs / (1000 * 60 * 60 * 24)

  // Future: scheduled after now
  if (ts > now) return 'future'

  // Recent: scheduled within last 30 days
  if (days <= PLANNED_RECENT_DAYS) return 'recent'

  // Old: scheduled more than 30 days ago
  return 'old'
}
```

### 📄 **MODIFIED**: `src/admin/components/EventPalette.tsx`

```diff
 import { formatRelativeTime, formatDate } from '../lib/formatRelativeTime'
+import { getPlanStatus, type PlanStatus } from '../lib/planStatus'

 const EventPalette: React.FC = () => {
   // ... existing code ...

   {episodes.map((episode) => {
     const isMapped = episode.showLibretimeInstanceId
     const ltReady = isLtReady(episode)
-    const isPlanned = !!episode.scheduledAt
     const isDisabled = !isMapped || !ltReady
+    const planStatus = getPlanStatus(episode.scheduledAt)

     // Extract cover URL (handle different formats)
     let coverUrl: string | null = null
     if (episode.cover) {
       if (typeof episode.cover === 'string') {
         coverUrl = episode.cover
       } else if (episode.cover.url) {
         coverUrl = episode.cover.url
       }
     }

+    // Determine background color based on plan status
+    let backgroundColor = '#fff'
+    if (isDisabled) {
+      backgroundColor = '#f8f9fa'
+    } else if (planStatus === 'recent') {
+      backgroundColor = '#f0f8f0' // Green for recently planned
+    }
+    // future, old, and none all use white background

     return (
       <div
         key={episode.episodeId}
         className={`fc-episode ${isDisabled ? 'disabled' : ''}`}
         data-title={episode.title}
         data-duration={episode.durationMinutes}
         data-episode-id={episode.episodeId}
         style={{
           padding: '10px',
-          backgroundColor: isDisabled ? '#f8f9fa' : isPlanned ? '#f0f8f0' : '#fff',
+          backgroundColor,
           border: isDisabled ? '1px solid #dee2e6' : '1px solid #ddd',
           borderRadius: '4px',
           cursor: isDisabled ? 'not-allowed' : 'grab',
           transition: 'all 0.2s ease',
           boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
           userSelect: 'none',
           opacity: isDisabled ? 0.6 : 1,
         }}
         onMouseEnter={(e) => {
           if (!isDisabled) {
             e.currentTarget.style.backgroundColor = '#f0f8ff'
             e.currentTarget.style.borderColor = '#007bff'
           }
         }}
         onMouseLeave={(e) => {
           if (!isDisabled) {
-            e.currentTarget.style.backgroundColor = isPlanned ? '#f0f8f0' : '#fff'
+            e.currentTarget.style.backgroundColor = backgroundColor
             e.currentTarget.style.borderColor = '#ddd'
           }
         }}
       >
         {/* ... cover, title, show, duration, lastAired, playCount ... */}

-        {/* Metadata Badges (no genres in V1) */}
+        {/* Plan Status Badge */}
+        {planStatus !== 'none' && episode.scheduledAt && (
+          <div
+            style={{
+              fontSize: '10px',
+              color:
+                planStatus === 'recent'
+                  ? '#28a745'
+                  : planStatus === 'future'
+                    ? '#0d6efd'
+                    : '#6c757d',
+              backgroundColor:
+                planStatus === 'recent'
+                  ? '#d4edda'
+                  : planStatus === 'future'
+                    ? '#e7f1ff'
+                    : '#f8f9fa',
+              border: `1px solid ${
+                planStatus === 'recent'
+                  ? '#c3e6cb'
+                  : planStatus === 'future'
+                    ? '#b3d7ff'
+                    : '#dee2e6'
+              }`,
+              borderRadius: '10px',
+              padding: '2px 6px',
+              display: 'inline-block',
+              marginBottom: '4px',
+              fontWeight: '600',
+            }}
+          >
+            {planStatus === 'future' ? 'Scheduled' : 'Planned'} •{' '}
+            {formatRelativeTime(episode.scheduledAt)}
+          </div>
+        )}
+
+        {/* Metadata Badges (no genres in V1) */}
         {(episode.energy || episode.mood || episode.tone) && (
           // ... existing badges ...
         )}

-        {isPlanned && (
-          <div
-            style={{
-              fontSize: '10px',
-              color: '#28a745',
-              backgroundColor: '#d4edda',
-              border: '1px solid #c3e6cb',
-              borderRadius: '12px',
-              padding: '2px 8px',
-              display: 'inline-block',
-              marginTop: '4px',
-            }}
-          >
-            Planned
-          </div>
-        )}
         
         {isDisabled && (
           // ... existing warning badge ...
         )}
       </div>
     )
   })}
```

---

## 3️⃣ LOGS

_(No issues during implementation)_

---

## 4️⃣ QUESTIONS & RISKS

### ❓ Questions

1. **30-day threshold**: Is `PLANNED_RECENT_DAYS = 30` the right cutoff? Easy to adjust if needed (e.g., 7 days, 14 days).

2. **Badge wording**: Confirm "Scheduled" vs "Planned" distinction:
   - Future episodes: "Scheduled • in X"
   - Past episodes: "Planned • X ago"
   - Is this semantically correct for your workflow?

3. **Old episodes visibility**: Should "old" planned episodes (>30 days ago) be filtered/hidden by default, or is current display-all approach correct?

4. **Future date handling**: Should episodes scheduled far in the future (>1 year) get special treatment or badge styling?

5. **Timezone handling**: `Date.now()` uses browser timezone. Should we consider UTC-only comparison for consistency?

6. **Badge order**: Currently: Duration → Last Aired → Play Count → **Plan Status** → Energy/Mood/Tone. Is this the right visual hierarchy?

7. **Color accessibility**: Are the blue/grey colors sufficiently distinguishable for colorblind users?

### ⚠️ Risks

1. **Client-side time calculation (LOW)**:
   - Plan status uses browser's current time (`Date.now()`)
   - May differ from server time, causing status to be slightly off
   - Mitigation: Acceptable for admin tool; status updates on page refresh

2. **Relative time accuracy for future dates (LOW)**:
   - "in 30 days" may become stale if user leaves browser tab open
   - Mitigation: Status recalculates on page refresh; acceptable for admin tool

3. **Visual clutter (LOW)**:
   - Plan status badge adds another line to cards
   - May feel crowded on narrow cards
   - Mitigation: Badge only shows when episode is scheduled (most are not)

4. **30-day threshold magic number (LOW)**:
   - Hardcoded constant may not suit all workflows
   - Mitigation: Exported constant `PLANNED_RECENT_DAYS` easily configurable

5. **Background color change for old episodes (LOW)**:
   - Old planned episodes lose green background
   - May confuse users expecting all planned episodes to be green
   - Mitigation: Badge still clearly indicates "Planned" status

6. **Future date edge case (LOW)**:
   - Episodes scheduled in distant future (years) show "in X years"
   - May look odd in UI
   - Mitigation: Unlikely scenario for most workflows

7. **Badge text overflow (LOW)**:
   - Long relative time strings ("in 11 months") may wrap awkwardly
   - Mitigation: Badge uses `inline-block` which wraps naturally

8. **No server-side status (LOW)**:
   - Plan status not stored in database, calculated client-side
   - Cannot filter/sort by status
   - Mitigation: V2 could add server-side status field if needed

---

## 5️⃣ ACCEPTANCE CRITERIA

✅ **Recent planned** (e.g., scheduled 5 days ago): Green background + green badge "Planned • 5 days ago"  
✅ **Future scheduled** (e.g., tomorrow): White background + blue badge "Scheduled • in 1 day"  
✅ **Old planned** (e.g., 60 days ago): White background + grey badge "Planned • 2 months ago"  
✅ **Unplanned**: White background + no plan status badge  
✅ **Disabled episodes**: Grey background preserved regardless of plan status  
✅ **Drag-and-drop**: No changes to `.fc-episode` class or data attributes  
✅ **Filters**: No changes to filter logic  
✅ **Grid layout**: No changes to 2-column grid  
✅ **Hover behavior**: Background color on hover respects plan status  
✅ **Badge styling**: Three distinct color schemes (green/blue/grey)  
✅ **Future time formatting**: "in X" format working for all units (min/hours/days/weeks/months/years)

---

## 6️⃣ IMPLEMENTATION NOTES

**Files Changed**:
- **Modified** (2): `formatRelativeTime.ts`, `EventPalette.tsx`
- **New** (1): `planStatus.ts`

**Lines Changed**: ~120 lines (estimated)

**Breaking Changes**: None

**Backward Compatibility**: Full (existing behavior preserved for unscheduled episodes)

**Tunable Constants**:
- `PLANNED_RECENT_DAYS = 30` in `planStatus.ts`

**Color Tokens** (inline styles):
```typescript
// Recent (green)
color: '#28a745'
backgroundColor: '#d4edda'
border: '#c3e6cb'

// Future (blue)
color: '#0d6efd'
backgroundColor: '#e7f1ff'
border: '#b3d7ff'

// Old (grey)
color: '#6c757d'
backgroundColor: '#f8f9fa'
border: '#dee2e6'
```

---

**END OF REVIEWER PACK**

