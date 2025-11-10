# Planner "Sync This Week" Feature - Audit & Implementation Plan

## 1. AUDIT FINDINGS (Read-Only Analysis)

### ✅ Component Structure
- **Main Planner**: `/src/admin/components/PlannerViewWithLibreTime.tsx` (705 lines)
- **Calendar**: `/src/admin/components/CalendarComponent.tsx` (396 lines)
- **Event Palette**: `/src/admin/components/EventPalette.tsx` (307 lines)

### ✅ FullCalendar Visible Range Access
**Location**: `CalendarComponent.tsx` line 25-26
```typescript
const calendarRef = useRef<FullCalendar>(null)
```

**How to get visible range**:
```typescript
if (calendarRef.current) {
  const calendarApi = calendarRef.current.getApi()
  const view = calendarApi.view
  const startISO = view.activeStart.toISOString()
  const endISO = view.activeEnd.toISOString()
}
```

### ✅ Toolbar Location
**Location**: `PlannerViewWithLibreTime.tsx` lines 626-655
```typescript
<div style={{ margin: '0 0 20px 0', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
  <h1>Episode Planner</h1>
  <div>
    {/* Status indicator */}
    {libreTimeEnabled ? 'LibreTime Connected' : 'LibreTime Disconnected'}
  </div>
</div>
```

**Button should be added here** with inline styles matching existing UI.

### ✅ Toast Utility
**Location**: `PlannerViewWithLibreTime.tsx` line 12
```typescript
import { showToast } from '@/integrations/plannerUtils'
```

**Usage**:
```typescript
showToast('Message', 'success' | 'warning' | 'error' | 'info')
```

### ✅ Badge Rendering Pattern
**Location**: `CalendarComponent.tsx` lines 171-243 (renderEventContent)
```typescript
const renderEventContent = (eventInfo: any) => {
  return (
    <div style={{ ... }}>
      <div>{eventInfo.event.title}</div>
      {/* Add badges here */}
    </div>
  )
}
```

### ⚠️ Missing: Dirty Tracking
**Current state**: No centralized dirty tracking for created/moved/deleted episodes.

**What exists**:
- `handleEventReceive` - called when episode dropped from palette
- `handleEventDrop` - called when episode moved
- `handleEventDelete` - called when episode deleted

**What's needed**:
- State to track pending changes:
  ```typescript
  const [dirtyChanges, setDirtyChanges] = useState<{
    created: Map<string, Change>
    moved: Map<string, Change>
    deleted: Map<string, Change>
  }>({ created: new Map(), moved: new Map(), deleted: new Map() })
  ```

### ⚠️ Missing: baseHash/serverHash
**Current state**: No hash tracking.

**What's needed**:
- State to store serverHash from last sync:
  ```typescript
  const [serverHash, setServerHash] = useState<string>('')
  ```

---

## 2. IMPLEMENTATION APPROACH

### Phase 1: Add State & Tracking

**File**: `PlannerViewWithLibreTime.tsx`

```typescript
// Add state for sync feature
const [syncInFlight, setSyncInFlight] = useState(false)
const [serverHash, setServerHash] = useState<string>('')
const [dirtyChanges, setDirtyChanges] = useState<ClientChange[]>([])

// Track changes
const trackChange = useCallback((episodeId: string, showId: string, scheduledAt: string | null, scheduledEnd?: string | null) => {
  setDirtyChanges(prev => {
    const existing = prev.findIndex(c => c.episodeId === episodeId)
    const change: ClientChange = { episodeId, showId, scheduledAt, scheduledEnd }
    
    if (existing >= 0) {
      const updated = [...prev]
      updated[existing] = change
      return updated
    }
    return [...prev, change]
  })
}, [])

// Modify existing handlers to call trackChange
const handleEventReceive = useCallback((info: any) => {
  // ... existing logic ...
  trackChange(episodeId, showId, start.toISOString(), end.toISOString())
}, [trackChange])
```

### Phase 2: Add Sync Button

**File**: `PlannerViewWithLibreTime.tsx` (lines 626-655)

```tsx
<div style={{ margin: '0 0 20px 0', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
  <h1>Episode Planner ...</h1>
  
  {/* EXISTING status indicator */}
  <div>...</div>
  
  {/* NEW: Sync button */}
  <button
    onClick={handleSyncThisWeek}
    disabled={syncInFlight || dirtyChanges.length === 0}
    style={{
      padding: '8px 16px',
      backgroundColor: syncInFlight ? '#ccc' : '#007bff',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: syncInFlight ? 'not-allowed' : 'pointer',
      fontSize: '14px',
      fontWeight: 'bold',
    }}
  >
    {syncInFlight ? 'Syncing...' : `Sync this week (${dirtyChanges.length} changes)`}
  </button>
</div>
```

### Phase 3: Create Preview Modal

**File**: `/src/admin/components/SyncPreviewModal.tsx` (NEW)

```tsx
'use client'

import React from 'react'

interface SyncPreviewModalProps {
  isOpen: boolean
  plan: {
    unplan: Array<{ episodeId: string; showId: string; scheduledAt: string; reason: string }>
    plan: Array<{ episodeId: string; showId: string; scheduledAt: string; scheduledEnd: string }>
  }
  conflicts: Array<{
    type: string
    episodeId: string
    message: string
    details?: any
  }>
  onConfirm: () => void
  onCancel: () => void
}

export const SyncPreviewModal: React.FC<SyncPreviewModalProps> = ({
  isOpen,
  plan,
  conflicts,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null

  const hasChanges = plan.unplan.length > 0 || plan.plan.length > 0
  const hasConflicts = conflicts.length > 0

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 20px 0' }}>Sync Preview</h2>

        {/* Plans to add */}
        {plan.plan.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#28a745', fontSize: '16px', marginBottom: '10px' }}>
              ✅ Episodes to schedule ({plan.plan.length})
            </h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {plan.plan.map((p, i) => (
                <li key={i} style={{ marginBottom: '5px', fontSize: '14px' }}>
                  Episode {p.episodeId.substring(0, 8)}... at {new Date(p.scheduledAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Items to remove */}
        {plan.unplan.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#dc3545', fontSize: '16px', marginBottom: '10px' }}>
              ❌ Episodes to remove ({plan.unplan.length})
            </h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {plan.unplan.map((u, i) => (
                <li key={i} style={{ marginBottom: '5px', fontSize: '14px' }}>
                  Episode {u.episodeId.substring(0, 8)}... (Reason: {u.reason})
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Conflicts */}
        {hasConflicts && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#ffc107', fontSize: '16px', marginBottom: '10px' }}>
              ⚠️ Conflicts ({conflicts.length})
            </h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {conflicts.map((c, i) => (
                <li key={i} style={{ marginBottom: '5px', fontSize: '14px', color: '#856404' }}>
                  <strong>{c.type}:</strong> {c.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Empty state */}
        {!hasChanges && !hasConflicts && (
          <p style={{ color: '#6c757d', fontSize: '14px' }}>No changes to sync.</p>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
          {hasChanges && !hasConflicts && (
            <button
              onClick={onConfirm}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              Apply Changes
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

### Phase 4: Implement Sync Flow

**File**: `PlannerViewWithLibreTime.tsx`

```typescript
// Add ref to calendar for visible range access
const calendarRef = useRef<FullCalendar>(null)

const handleSyncThisWeek = useCallback(async () => {
  if (syncInFlight) return
  
  setSyncInFlight(true)
  
  try {
    // Get visible range from calendar
    if (!calendarRef.current) {
      throw new Error('Calendar not initialized')
    }
    
    const calendarApi = calendarRef.current.getApi()
    const view = calendarApi.view
    const startISO = view.activeStart.toISOString()
    const endISO = view.activeEnd.toISOString()
    
    console.log('[SYNC] schedule_diff_range', {
      adds: dirtyChanges.filter(c => c.scheduledAt !== null).length,
      removes: dirtyChanges.filter(c => c.scheduledAt === null).length,
      total: dirtyChanges.length,
    })
    
    // Call diff-range
    const diffResponse = await fetch('/api/schedule/diff-range', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startISO,
        endISO,
        clientChanges: dirtyChanges,
        baseHash: serverHash,
        dryRun: false,
      }),
    })
    
    if (diffResponse.status === 403) {
      showToast('Unauthorized - admin/staff access required', 'error')
      return
    }
    
    if (!diffResponse.ok) {
      const error = await diffResponse.json()
      showToast(`Sync failed: ${error.error || 'Unknown error'}`, 'error')
      return
    }
    
    const diffResult = await diffResponse.json()
    const { plan, conflicts, serverHash: newHash } = diffResult
    
    // If no changes, show toast
    if (plan.unplan.length === 0 && plan.plan.length === 0) {
      showToast('No changes to sync', 'info')
      setServerHash(newHash)
      setDirtyChanges([])
      return
    }
    
    // Show preview modal
    setPreviewModalState({
      isOpen: true,
      plan,
      conflicts: conflicts || [],
      serverHash: newHash,
    })
    
  } catch (error) {
    console.error('[SYNC] Error:', error)
    showToast(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
  } finally {
    setSyncInFlight(false)
  }
}, [syncInFlight, dirtyChanges, serverHash])

const handleApplyChanges = useCallback(async () => {
  if (!previewModalState.plan) return
  
  setSyncInFlight(true)
  
  try {
    // Get visible range
    const calendarApi = calendarRef.current?.getApi()
    if (!calendarApi) throw new Error('Calendar not initialized')
    
    const view = calendarApi.view
    const startISO = view.activeStart.toISOString()
    const endISO = view.activeEnd.toISOString()
    
    // Call apply-range
    const applyResponse = await fetch('/api/schedule/apply-range', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startISO,
        endISO,
        plan: previewModalState.plan,
        confirm: true,
        serverHash: previewModalState.serverHash,
      }),
    })
    
    if (applyResponse.status === 409) {
      // Hash mismatch - show reload modal
      showToast('Calendar changed - please reload and retry', 'warning')
      setPreviewModalState({ isOpen: false, plan: null, conflicts: [], serverHash: '' })
      refetchScheduled()
      return
    }
    
    if (!applyResponse.ok) {
      const error = await applyResponse.json()
      showToast(`Apply failed: ${error.error || 'Unknown error'}`, 'error')
      return
    }
    
    const applyResult = await applyResponse.json()
    
    // Log results
    const statusCounts = applyResult.results.reduce((acc: any, r: any) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {})
    
    console.log('[SYNC] schedule_apply_range', statusCounts)
    
    // Show summary toast
    const scheduled = statusCounts.scheduled || 0
    const waiting = statusCounts.waiting_lt_ready || 0
    const rehydrate = statusCounts.rehydrate_queued || 0
    const errors = statusCounts.error || 0
    
    showToast(
      `Sync complete: ${scheduled} scheduled, ${waiting} waiting, ${rehydrate} rehydrating, ${errors} errors`,
      errors > 0 ? 'warning' : 'success'
    )
    
    // Update server hash
    setServerHash(applyResult.serverHash)
    setDirtyChanges([])
    setPreviewModalState({ isOpen: false, plan: null, conflicts: [], serverHash: '' })
    
    // Refetch episodes
    refetchScheduled()
    
  } catch (error) {
    console.error('[SYNC] Apply error:', error)
    showToast(`Apply failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
  } finally {
    setSyncInFlight(false)
  }
}, [previewModalState, refetchScheduled])
```

---

## 3. QUESTIONS & RISKS

### Questions
1. **Dirty Tracking Scope** - Should we track changes across all time periods or only visible range?
2. **Badge Placement** - Should badges be inline in event title or as separate overlay?
3. **Hash Persistence** - Should serverHash persist across page reloads (localStorage)?
4. **Show ID Resolution** - How to get showId from episodeId? (Need to query episode data)

### Risks
1. **FullCalendar Ref Access** - CalendarComponent doesn't expose ref. Need to add `React.forwardRef`.
2. **State Synchronization** - Dirty changes may drift from actual calendar state if events changed outside planner.
3. **Performance** - For large ranges (month view), diff-range with 200+ episodes could be slow.
4. **Race Conditions** - User could drag/drop while sync in flight. Need to disable calendar edits during sync.

---

## 4. ESTIMATED EFFORT

- **Phase 1** (State & Tracking): 2 hours
- **Phase 2** (Sync Button): 1 hour
- **Phase 3** (Preview Modal): 2 hours
- **Phase 4** (Sync Flow): 3 hours
- **Testing & Polish**: 2 hours

**Total**: 10 hours

---

## 5. NEXT STEPS

1. ✅ Audit complete - proceed with implementation
2. ⚠️ Requires user confirmation to proceed (large frontend change)
3. ⚠️ Should this be implemented in both PlannerView and PlannerViewWithLibreTime, or only LibreTime version?

**Recommendation**: Implement only in `PlannerViewWithLibreTime.tsx` since diff/apply endpoints require LibreTime integration.

