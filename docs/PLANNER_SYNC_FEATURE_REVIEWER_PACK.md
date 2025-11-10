# Planner "Sync This Week" Feature - Reviewer Pack

## 1. SUMMARY (≤10 bullets)

✅ **AUDIT COMPLETE** - Ready for implementation approval

1. **Toolbar Location Found** - `PlannerViewWithLibreTime.tsx` lines 626-655 (ideal spot for button)
2. **FullCalendar Access** - `calendarRef.current.getApi().view.activeStart/activeEnd` provides visible range
3. **Toast Utility Available** - `showToast()` imported from `plannerUtils` (success/warning/error/info)
4. **No Dirty Tracking** - Need to add state to track created/moved/deleted episodes
5. **No Hash Management** - Need to add `serverHash` state for optimistic locking
6. **Badge Rendering** - Exists in `renderEventContent()` at CalendarComponent line 171-243
7. **Modal Pattern** - No existing modal, need to create `SyncPreviewModal.tsx` (inline styles)
8. **API Integration** - `/api/schedule/diff-range` and `/api/schedule/apply-range` ready to use
9. **Implementation Scope** - ~400 lines across 3 files (PlannerView, CalendarComponent, new Modal)
10. **Estimated Effort** - 10 hours total (includes testing & polish)

---

## 2. DIFFS (Conceptual - Not Yet Implemented)

### NEW FILE: src/admin/components/SyncPreviewModal.tsx (~150 lines)

```diff
+export const SyncPreviewModal: React.FC<Props> = ({ isOpen, plan, conflicts, onConfirm, onCancel }) => {
+  // Minimal modal with inline styles matching PLANNER_UI_GUIDE
+  // Sections:
+  // - ✅ Episodes to schedule (plan.plan[])
+  // - ❌ Episodes to remove (plan.unplan[])
+  // - ⚠️ Conflicts (conflicts[])
+  // Footer: Apply / Cancel buttons
+}
```

### MODIFIED: src/admin/components/PlannerViewWithLibreTime.tsx (~200 lines changed)

```diff
+// Add state for sync feature
+const [syncInFlight, setSyncInFlight] = useState(false)
+const [serverHash, setServerHash] = useState<string>('')
+const [dirtyChanges, setDirtyChanges] = useState<ClientChange[]>([])
+const [previewModalState, setPreviewModalState] = useState({ isOpen: false, plan: null, ... })
+
+// Track changes in existing handlers
 const handleEventReceive = useCallback((info: any) => {
+  trackChange(episodeId, showId, start.toISOString(), end.toISOString())
   // ... existing logic ...
 }, [])

+// Add sync handler
+const handleSyncThisWeek = useCallback(async () => {
+  // 1. Get visible range from calendar
+  // 2. POST /api/schedule/diff-range
+  // 3. Handle errors (403 → auth toast)
+  // 4. If no changes → info toast
+  // 5. Show preview modal
+}, [])

+// Add apply handler
+const handleApplyChanges = useCallback(async () => {
+  // 1. POST /api/schedule/apply-range
+  // 2. Handle 409 → reload modal
+  // 3. Map results to badges
+  // 4. Show summary toast
+  // 5. Refetch episodes
+}, [])

 return (
   <div>
     <div style={{ /* toolbar */ }}>
       <h1>Episode Planner</h1>
+      <button onClick={handleSyncThisWeek} disabled={syncInFlight || dirtyChanges.length === 0}>
+        {syncInFlight ? 'Syncing...' : `Sync this week (${dirtyChanges.length} changes)`}
+      </button>
     </div>
     
+    <SyncPreviewModal
+      isOpen={previewModalState.isOpen}
+      plan={previewModalState.plan}
+      conflicts={previewModalState.conflicts}
+      onConfirm={handleApplyChanges}
+      onCancel={() => setPreviewModalState({ ...previewModalState, isOpen: false })}
+    />
   </div>
 )
```

### MODIFIED: src/admin/components/CalendarComponent.tsx (~50 lines changed)

```diff
+// Add forwardRef to expose calendar ref
-const CalendarComponent: React.FC<Props> = ({ events, ... }) => {
+const CalendarComponent = React.forwardRef<FullCalendar, Props>(({ events, ... }, ref) => {
   const calendarRef = useRef<FullCalendar>(null)
+  
+  // Expose ref to parent
+  React.useImperativeHandle(ref, () => calendarRef.current!, [])

   return (
     <FullCalendar
       ref={calendarRef}
+      // Add custom badge rendering in eventContent
+      eventContent={(args) => renderEventWithBadge(args)}
     />
   )
-}
+})
+
+// Helper to render badges
+function renderEventWithBadge(eventInfo: any) {
+  const status = eventInfo.event.extendedProps?.syncStatus
+  return (
+    <div>
+      <div>{eventInfo.event.title}</div>
+      {status === 'waiting_lt_ready' && <span style={{ badge-blue }}>Waiting LT</span>}
+      {status === 'rehydrate_queued' && <span style={{ badge-yellow }}>Rehydrate</span>}
+      {status === 'error' && <span style={{ badge-red }}>Error</span>}
+    </div>
+  )
+}
```

---

## 3. LOGS (None - Frontend Only)

No server-side logs. Client-side console logs:

```javascript
[SYNC] schedule_diff_range { adds: 2, removes: 1, total: 3 }
[SYNC] schedule_apply_range { scheduled: 2, waiting: 0, rehydrate: 1, error: 0 }
```

---

## 4. QUESTIONS & RISKS (≤8 bullets)

### Questions
1. **Implementation Target** - Should this be added to both `PlannerView.tsx` and `PlannerViewWithLibreTime.tsx`, or only LibreTime version?
   - **Recommendation**: Only LibreTime version (diff/apply endpoints require LT integration)

2. **Badge Persistence** - Should sync status badges persist after page reload?
   - **Recommendation**: No, badges are transient (cleared on refetch)

3. **Hash Storage** - Should `serverHash` persist in localStorage across sessions?
   - **Recommendation**: No, always refetch on page load

4. **Show ID Resolution** - How to get `showId` from `episodeId` in dirty tracking?
   - **Solution**: Query episode data when building clientChanges

### Risks
5. **FullCalendar Ref** - CalendarComponent doesn't expose ref. Need to add `React.forwardRef`.
   - **Mitigation**: Well-documented React pattern, low risk

6. **State Drift** - Dirty changes may not match actual calendar state if user refreshes during editing.
   - **Mitigation**: Clear dirty changes on page load, verify with diff-range before apply

7. **Performance** - Month view with 200+ episodes could slow diff-range request.
   - **Mitigation**: Server already has 200 ops batch limit, acceptable for UI

8. **UX Confusion** - User might not understand difference between "drag to calendar" vs "sync this week".
   - **Mitigation**: Add tooltip: "Sync commits pending changes to LibreTime"

---

## 5. IMPLEMENTATION DECISION REQUIRED

### Option A: Full Implementation Now (~10 hours)
- Add sync button, preview modal, dirty tracking
- Implement full diff→preview→apply flow
- Add badge rendering for sync statuses
- Test with real LibreTime integration

### Option B: Minimal Prototype First (~4 hours)
- Add sync button (no dirty tracking, always syncs all visible range)
- Skip preview modal (directly call diff→apply)
- Add basic toast notifications only
- Test happy path, defer edge cases

### Option C: Audit Only (Complete ✅)
- Provide detailed implementation plan
- User reviews and approves approach
- Implement in next iteration

**CURRENT STATUS**: Option C completed. Awaiting user decision on Option A vs B.

---

## 6. FILES TO CREATE/MODIFY

### Create (1 file)
- `/src/admin/components/SyncPreviewModal.tsx` (~150 lines)

### Modify (3 files)
- `/src/admin/components/PlannerViewWithLibreTime.tsx` (+~200 lines)
- `/src/admin/components/CalendarComponent.tsx` (+~50 lines)
- `/src/admin/types/calendar.ts` (+~30 lines for types)

### Total Impact
- **New code**: ~430 lines
- **Modified code**: ~50 lines
- **Risk level**: Medium-Low (isolated to planner UI, no server changes)

---

## 7. NEXT STEPS

1. ✅ **Audit Complete** - All required information gathered
2. ⚠️ **Awaiting User Approval** - Which implementation option (A, B, or defer)?
3. ⏸️ **No Code Changes Made** - Per "SAFE, SURGICAL" requirement

**User Decision Required**:
- Proceed with Option A (full implementation)?
- Proceed with Option B (minimal prototype)?
- Review audit and request changes to approach?

