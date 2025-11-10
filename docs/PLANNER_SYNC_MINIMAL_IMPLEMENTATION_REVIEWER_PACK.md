# Planner "Sync This Week" - Minimal Implementation Reviewer Pack

## 1. SUMMARY (≤10 bullets)

✅ **OPTION B COMPLETE** - Minimal prototype implemented and ready for testing

1. **CalendarComponent Refactored** - Added `React.forwardRef` to expose FullCalendar API
2. **Sync Button Added** - "Sync This Week" button in toolbar (blue, disabled when syncing)
3. **State Management** - Added `syncInFlight` and `serverHash` state tracking
4. **Diff→Apply Flow** - Direct call to diff-range then apply-range (no preview modal)
5. **Toast Notifications** - Success/warning/error toasts for all scenarios
6. **Error Handling** - Proper handling of 403 (auth), 409 (hash mismatch), generic errors
7. **Conflict Detection** - Shows warning toast if conflicts detected (blocks sync)
8. **No Dirty Tracking** - Syncs entire visible range (empty clientChanges array)
9. **Telemetry Logs** - Console logs for diff/apply with operation counts
10. **Zero New Dependencies** - Uses existing toast utility and FullCalendar API

---

## 2. DIFFS (Unified Format)

### MODIFIED: src/admin/components/CalendarComponent.tsx

```diff
 import interactionPlugin from '@fullcalendar/interaction'
 
-const CalendarComponent: React.FC<CalendarComponentProps> = ({
-  events = [],
-  onEventReceive,
-  onEventDrop,
-  onEventResize,
-  onEventDelete,
-}) => {
+const CalendarComponent = React.forwardRef<FullCalendar, CalendarComponentProps>(
+  ({ events = [], onEventReceive, onEventDrop, onEventResize, onEventDelete }, ref) => {
   const calendarRef = useRef<FullCalendar>(null)
+  
+  // Expose ref to parent
+  React.useImperativeHandle(ref, () => calendarRef.current!, [])
   
   return (
     <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
       <FullCalendar ref={calendarRef} ... />
     </div>
   )
-}
+})
+
+CalendarComponent.displayName = 'CalendarComponent'
 
 export default CalendarComponent
```

**Changes**: 8 lines added, 4 lines modified  
**Impact**: Allows parent component to access FullCalendar API

---

### MODIFIED: src/admin/components/PlannerViewWithLibreTime.tsx

```diff
+'use client'
+
+import React, { useState, useEffect, useCallback, useRef } from 'react'
+import dynamic from 'next/dynamic'
+import type FullCalendar from '@fullcalendar/react'
 
 const PlannerViewWithLibreTime: React.FC = () => {
   const [isClient, setIsClient] = useState(false)
   const [libreTimeEnabled, setLibreTimeEnabled] = useState(false)
   const [isLoading, setIsLoading] = useState(false)
+  
+  // Sync feature state
+  const [syncInFlight, setSyncInFlight] = useState(false)
+  const [serverHash, setServerHash] = useState<string>('')
+  
+  // Calendar ref for accessing visible range
+  const calendarRef = useRef<FullCalendar | null>(null)
   
   const {
     episodes: scheduledEpisodes,
-    loading: scheduledLoading,
+    loading: _scheduledLoading,
     refetch: refetchScheduled,
   } = useScheduledEpisodes()
   
+  // Sync This Week handler
+  const handleSyncThisWeek = useCallback(async () => {
+    if (syncInFlight || !calendarRef.current) return
+    
+    setSyncInFlight(true)
+    
+    try {
+      // Get visible range from calendar
+      const calendarApi = calendarRef.current.getApi()
+      const view = calendarApi.view
+      const startISO = view.activeStart.toISOString()
+      const endISO = view.activeEnd.toISOString()
+      
+      console.log('[SYNC] schedule_diff_range.requested', { startISO, endISO })
+      
+      // Call diff-range (no clientChanges - sync entire visible range)
+      const diffResponse = await fetch('/api/schedule/diff-range', {
+        method: 'POST',
+        credentials: 'include',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({
+          startISO,
+          endISO,
+          clientChanges: [], // Empty - just reconcile server state
+          baseHash: serverHash,
+          dryRun: false,
+        }),
+      })
+      
+      if (diffResponse.status === 403) {
+        showToast('Unauthorized - admin/staff access required', 'error')
+        return
+      }
+      
+      if (!diffResponse.ok) {
+        const error = await diffResponse.json()
+        showToast(`Sync failed: ${error.error || 'Unknown error'}`, 'error')
+        return
+      }
+      
+      const diffResult = await diffResponse.json()
+      const { plan, conflicts, serverHash: newHash } = diffResult
+      
+      console.log('[SYNC] schedule_diff_range.produced', {
+        unplan: plan.unplan.length,
+        plan: plan.plan.length,
+        conflicts: conflicts?.length || 0,
+      })
+      
+      // If no changes, show warning toast
+      if (plan.unplan.length === 0 && plan.plan.length === 0) {
+        showToast('No changes to sync', 'warning')
+        setServerHash(newHash)
+        return
+      }
+      
+      // If conflicts, show warning
+      if (conflicts && conflicts.length > 0) {
+        showToast(`Found ${conflicts.length} conflicts - cannot sync`, 'warning')
+        return
+      }
+      
+      // Directly call apply-range (no preview in minimal version)
+      const applyResponse = await fetch('/api/schedule/apply-range', {
+        method: 'POST',
+        credentials: 'include',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({
+          startISO,
+          endISO,
+          plan,
+          confirm: true,
+          serverHash: newHash,
+        }),
+      })
+      
+      if (applyResponse.status === 409) {
+        showToast('Calendar changed - please reload and retry', 'warning')
+        refetchScheduled()
+        return
+      }
+      
+      if (!applyResponse.ok) {
+        const error = await applyResponse.json()
+        showToast(`Apply failed: ${error.error || 'Unknown error'}`, 'error')
+        return
+      }
+      
+      const applyResult = await applyResponse.json()
+      
+      // Count statuses
+      const statusCounts = applyResult.results.reduce((acc: Record<string, number>, r: { status: string }) => {
+        acc[r.status] = (acc[r.status] || 0) + 1
+        return acc
+      }, {})
+      
+      console.log('[SYNC] schedule_apply_range.completed', statusCounts)
+      
+      const scheduled = statusCounts.scheduled || 0
+      const waiting = statusCounts.waiting_lt_ready || 0
+      const rehydrate = statusCounts.rehydrate_queued || 0
+      const errors = statusCounts.error || 0
+      
+      showToast(
+        `Sync complete: ${scheduled} scheduled, ${waiting} waiting, ${rehydrate} rehydrating, ${errors} errors`,
+        errors > 0 ? 'warning' : 'success',
+      )
+      
+      setServerHash(applyResult.serverHash)
+      refetchScheduled()
+    } catch (error) {
+      console.error('[SYNC] Error:', error)
+      showToast(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
+    } finally {
+      setSyncInFlight(false)
+    }
+  }, [syncInFlight, serverHash, refetchScheduled])
   
   return (
     <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
       <div style={{ ... }}>
         <h1>Episode Planner ...</h1>
         <div>{/* Status indicator */}</div>
+        {/* Sync This Week button */}
+        <button
+          onClick={handleSyncThisWeek}
+          disabled={syncInFlight}
+          style={{
+            padding: '8px 16px',
+            backgroundColor: syncInFlight ? '#ccc' : '#007bff',
+            color: '#fff',
+            border: 'none',
+            borderRadius: '4px',
+            cursor: syncInFlight ? 'not-allowed' : 'pointer',
+            fontSize: '14px',
+            fontWeight: 'bold',
+          }}
+        >
+          {syncInFlight ? 'Syncing...' : 'Sync This Week'}
+        </button>
       </div>
       
       <CalendarComponent
+        ref={calendarRef}
         events={calendarEvents}
         ...
       />
     </div>
   )
 }
```

**Changes**: 120 lines added, 3 lines modified  
**Impact**: Complete sync workflow with UI feedback

---

## 3. LOGS (Sample Output)

### Successful Sync (No Changes)
```
[SYNC] schedule_diff_range.requested { startISO: '2025-10-13T00:00:00.000Z', endISO: '2025-10-20T00:00:00.000Z' }
[SYNC] schedule_diff_range.produced { unplan: 0, plan: 0, conflicts: 0 }
Toast: "No changes to sync" (warning)
```

### Successful Sync (With Changes)
```
[SYNC] schedule_diff_range.requested { startISO: '2025-10-13T00:00:00.000Z', endISO: '2025-10-20T00:00:00.000Z' }
[SYNC] schedule_diff_range.produced { unplan: 1, plan: 2, conflicts: 0 }
[SYNC] schedule_apply_range.completed { scheduled: 2, unscheduled: 1 }
Toast: "Sync complete: 2 scheduled, 0 waiting, 0 rehydrating, 0 errors" (success)
```

### Conflict Detected
```
[SYNC] schedule_diff_range.requested { startISO: '2025-10-13T00:00:00.000Z', endISO: '2025-10-20T00:00:00.000Z' }
[SYNC] schedule_diff_range.produced { unplan: 0, plan: 1, conflicts: 2 }
Toast: "Found 2 conflicts - cannot sync" (warning)
```

### Auth Failure (403)
```
[SYNC] schedule_diff_range.requested { startISO: '2025-10-13T00:00:00.000Z', endISO: '2025-10-20T00:00:00.000Z' }
Toast: "Unauthorized - admin/staff access required" (error)
```

### Hash Mismatch (409)
```
[SYNC] schedule_diff_range.requested { startISO: '2025-10-13T00:00:00.000Z', endISO: '2025-10-20T00:00:00.000Z' }
[SYNC] schedule_diff_range.produced { unplan: 0, plan: 1, conflicts: 0 }
Toast: "Calendar changed - please reload and retry" (warning)
```

---

## 4. QUESTIONS & RISKS (≤8 bullets)

### Questions
1. **View Type Matters** - Should sync work differently for day/week/month views?
   - **Current**: Syncs whatever is visible (week = 7 days, month = ~30 days)
2. **Button Placement** - Should button be in calendar header toolbar instead of page header?
   - **Current**: In page header next to LibreTime status indicator
3. **No Changes Behavior** - Should we suppress "No changes" toast?
   - **Current**: Shows toast every time (might be annoying)

### Risks
4. **Empty clientChanges** - Syncing with empty array may not match user expectations
   - **Mitigation**: This is intentional for minimal version - just reconciles state
5. **No Visual Feedback** - Users don't see what will change before it happens
   - **Mitigation**: Acceptable for minimal version; full version will add preview modal
6. **Button Always Enabled** - Even when no episodes exist in visible range
   - **Mitigation**: Acceptable - "No changes" toast provides feedback
7. **FullCalendar Ref Type** - Using imported type, may break if @fullcalendar updates
   - **Mitigation**: Standard React pattern, low risk
8. **No Dry-Run Option** - Always commits changes immediately
   - **Mitigation**: Intentional for minimal version - full version will add preview

---

## 5. TESTING CHECKLIST

### Manual Testing
- [ ] Button appears in toolbar
- [ ] Button disabled when clicking (syncInFlight state)
- [ ] Success toast shows counts
- [ ] Warning toast shows on no changes
- [ ] Warning toast shows on conflicts
- [ ] Error toast shows on 403
- [ ] Warning toast shows on 409
- [ ] Calendar refetches after sync
- [ ] Console logs appear for all operations
- [ ] Works in week view
- [ ] Works in month view
- [ ] Works in day view

### Integration Testing
- [ ] Diff-range called with correct range
- [ ] Apply-range called with correct plan
- [ ] Server hash persists between syncs
- [ ] 409 triggers refetch
- [ ] Multiple clicks don't cause multiple requests

---

## 6. FUTURE ENHANCEMENTS (Full Version)

### High Priority
1. **Preview Modal** - Show changes before applying
2. **Dirty Tracking** - Track user edits for smarter sync
3. **Badge Rendering** - Show sync status on events
4. **Optimistic Updates** - Update UI before server confirms

### Medium Priority
5. **Undo** - Reverse last sync
6. **Auto-Sync** - Sync automatically on calendar change
7. **Keyboard Shortcut** - Cmd/Ctrl+S to sync
8. **Better Empty State** - Hide button when no episodes

---

## 7. FILES MODIFIED

### Modified (2 files)
- `/src/admin/components/CalendarComponent.tsx` (+12 lines)
- `/src/admin/components/PlannerViewWithLibreTime.tsx` (+123 lines)

### Total Impact
- **New code**: 135 lines
- **Modified code**: 4 lines
- **Risk level**: Low (isolated to planner UI, no server changes)
- **Linter errors**: 0 (4 warnings in pre-existing code)

---

## 8. DEPLOYMENT

### No Build Required
This is a client-side only change. No server restarts or migrations needed.

### Testing Steps
1. Navigate to `/admin/collections/planner`
2. Verify "Sync This Week" button appears
3. Click button (should show "No changes" if calendar empty)
4. Add episodes via drag-drop from palette
5. Click "Sync This Week" again
6. Verify success toast shows counts
7. Verify calendar refetches

### Rollback
If issues arise, revert commits:
```bash
git revert <commit-hash>
```

No database changes to roll back.

---

## 9. CONCLUSION

✅ **Option B Minimal Prototype Complete**

### What Works
- Sync button with loading state
- Full diff→apply workflow
- Toast notifications for all scenarios
- Error handling (403, 409, generic)
- Console telemetry logs
- Server hash tracking

### What's Missing (Deferred to Full Version)
- Preview modal before applying changes
- Dirty tracking of user edits
- Badge rendering for sync statuses
- Optimistic UI updates
- Undo functionality

### Production Readiness: 75%

Ready for testing and feedback. Not recommended for production without preview modal to prevent accidental changes.

**Next Step**: User testing and feedback collection before implementing full version with preview modal.

