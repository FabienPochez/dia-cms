# Planner UI Guide

## Overview
This document covers the Planner UI implementation and user experience for episode scheduling with LibreTime integration.

## UI Components

### 1. Planner View (`PlannerView.tsx`)
**Purpose**: Non-LibreTime version of the Planner
**Features**:
- Episode list with drag-and-drop scheduling
- Visual calendar display
- Local scheduling (no LibreTime integration)

### 2. LibreTime-Enabled Planner (`PlannerViewWithLibreTime.tsx`)
**Purpose**: Full LibreTime integration for episode scheduling
**Features**:
- Episode list with LibreTime track data filtering
- Calendar with LibreTime scheduling
- Delete functionality with LibreTime cleanup
- Visual indicators for planned episodes

### 3. Event Palette (`EventPalette.tsx`)
**Purpose**: Episode selection and filtering
**Features**:
- LT-ready episode filtering
- Visual indicators for planned episodes
- Disabled state for non-LT-ready episodes

### 4. Calendar Component (`CalendarComponent.tsx`)
**Purpose**: Calendar display and interaction
**Features**:
- FullCalendar integration
- Custom event rendering with delete buttons
- Keyboard shortcuts (Delete key)
- Visual feedback for selected events

## User Experience Flow

### 1. Episode Filtering
**LT-Ready Filtering**:
- Only episodes with both `libretimeTrackId` and `libretimeFilepathRelative` are shown
- Non-LT-ready episodes are hidden from the Planner
- Server-side filtering for performance

**Visual Indicators**:
- Planned episodes: Light green background (`#f0f8f0`)
- "Planned" badge for scheduled episodes
- Warning message for non-LT-ready episodes

### 2. Scheduling Process
**Drag & Drop**:
1. User drags episode from palette to calendar
2. System validates episode is LT-ready
3. System creates LibreTime show (if needed)
4. System creates LibreTime instance for time window
5. System creates LibreTime playout
6. System updates Payload episode with LibreTime IDs

**Visual Feedback**:
- Episode appears on calendar immediately
- Background color changes to indicate planned status
- Success/error messages via toast notifications

### 3. Delete Process
**Delete Methods**:
1. **Red 'X' Button**: Click the red X in top-right corner of event
2. **Keyboard**: Select event and press Delete key
3. **Context Menu**: Right-click (if implemented)

**Delete Flow**:
1. User clicks delete button or presses Delete key
2. System removes playout from LibreTime
3. System clears episode schedule in Payload
4. System updates UI to remove event from calendar

## Visual Design

### Color Scheme
```css
/* Planned episodes */
.planned-episode {
  background-color: #f0f8f0;
}

/* Delete button */
.delete-button {
  background: rgba(255, 0, 0, 0.8);
  color: white;
  border-radius: 50%;
}

/* Selected event */
.selected-event {
  border: 2px solid #007bff;
  box-shadow: 0 0 5px rgba(0, 123, 255, 0.5);
}
```

### Typography
- **Episode Titles**: 12px, line-height 1.2
- **Badges**: 10px, bold
- **Help Text**: 11px, italic

### Layout
- **Event Palette**: Left sidebar with episode list
- **Calendar**: Main area with FullCalendar
- **Event Cards**: Flex layout with title and delete button

## Keyboard Shortcuts

### Available Shortcuts
- **Delete Key**: Delete selected event
- **Escape**: Deselect event
- **Arrow Keys**: Navigate calendar (FullCalendar default)

### Implementation
```typescript
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Delete' && selectedEvent) {
      handleDeleteClick(event, selectedEvent.episodeId, selectedEvent.libretimeScheduleId)
    }
  }
  
  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [selectedEvent, handleDeleteClick])
```

## Error Handling

### User-Facing Errors
1. **Not LT-Ready**: "Missing LibreTime track data"
2. **Scheduling Failed**: Toast notification with error details
3. **Delete Failed**: Toast notification with error details
4. **Network Error**: Generic error message with retry option

### Error States
- **Loading**: Spinner during API calls
- **Disabled**: Grayed out for non-LT-ready episodes
- **Error**: Red border and error message
- **Success**: Green background and success message

## Performance Considerations

### Data Loading
- **Server-Side Filtering**: Only LT-ready episodes loaded
- **Client-Side Safety**: Double-check filtering before display
- **Debounced Operations**: Prevent duplicate API calls

### UI Responsiveness
- **Immediate Feedback**: UI updates before API calls complete
- **Optimistic Updates**: Show changes immediately
- **Rollback on Error**: Revert UI changes if API fails

## Accessibility

### Keyboard Navigation
- **Tab Order**: Logical tab sequence through interface
- **Focus Management**: Clear focus indicators
- **Keyboard Shortcuts**: Standard shortcuts for common actions

### Screen Reader Support
- **ARIA Labels**: Proper labels for all interactive elements
- **Role Attributes**: Correct roles for custom components
- **Live Regions**: Announce dynamic content changes

### Visual Accessibility
- **Color Contrast**: Sufficient contrast for all text
- **Focus Indicators**: Clear visual focus indicators
- **Error States**: Multiple ways to indicate errors

## Mobile Responsiveness

### Breakpoints
- **Desktop**: Full calendar with sidebar
- **Tablet**: Collapsible sidebar
- **Mobile**: Stacked layout with modal calendar

### Touch Interactions
- **Touch Targets**: Minimum 44px touch targets
- **Swipe Gestures**: Swipe to navigate calendar
- **Long Press**: Context menu for events

## Testing

### Unit Tests
- Component rendering
- Event handlers
- State management
- Error handling

### Integration Tests
- API integration
- User workflows
- Error scenarios
- Performance testing

### E2E Tests
- Complete user journeys
- Cross-browser testing
- Mobile device testing
- Accessibility testing

## Configuration

### Environment Variables
```bash
# LibreTime Integration
LIBRETIME_URL=https://schedule.diaradio.live
LIBRETIME_API_URL=https://schedule.diaradio.live
LIBRETIME_API_KEY=your_api_key

# UI Configuration
NEXT_PUBLIC_PLANNER_ENABLED=true
NEXT_PUBLIC_LIBRETIME_ENABLED=true
```

### Feature Flags
```typescript
// Enable/disable features
const features = {
  libreTimeIntegration: process.env.NEXT_PUBLIC_LIBRETIME_ENABLED === 'true',
  deleteFunctionality: true,
  keyboardShortcuts: true,
  dragAndDrop: true,
}
```

## Troubleshooting

### Common UI Issues

#### 1. Episodes Not Showing
**Symptoms**: Empty episode list
**Causes**:
- No LT-ready episodes
- Server-side filtering too strict
- API connection issues

**Solutions**:
- Check episode has `libretimeTrackId` and `libretimeFilepathRelative`
- Verify API connectivity
- Check browser console for errors

#### 2. Delete Button Not Working
**Symptoms**: Click delete button, nothing happens
**Causes**:
- Event not selected
- API error
- Permission issues

**Solutions**:
- Ensure event is selected (has blue border)
- Check browser console for errors
- Verify API permissions

#### 3. Calendar Not Loading
**Symptoms**: Blank calendar area
**Causes**:
- FullCalendar initialization error
- Missing dependencies
- CSS conflicts

**Solutions**:
- Check browser console for errors
- Verify FullCalendar is loaded
- Check CSS imports

### Debug Tools

#### Browser Console
```javascript
// Check Planner state
window.plannerState

// Check LibreTime integration
window.libreTimeEnabled

// Check selected event
window.selectedEvent
```

#### Network Tab
- Monitor API calls to `/api/schedule/*`
- Check LibreTime API calls
- Verify request/response data

#### React DevTools
- Inspect component state
- Check props and hooks
- Monitor re-renders

## Future Enhancements

### Planned Features
1. **Bulk Operations**: Select multiple episodes
2. **Advanced Filtering**: Filter by show, genre, etc.
3. **Timeline View**: Alternative calendar view
4. **Conflict Resolution**: Visual conflict indicators
5. **Undo/Redo**: Action history

### UI Improvements
1. **Dark Mode**: Theme switching
2. **Customizable Layout**: User preferences
3. **Keyboard Shortcuts**: More shortcuts
4. **Touch Gestures**: Mobile gestures
5. **Animations**: Smooth transitions

### Performance Optimizations
1. **Virtual Scrolling**: Large episode lists
2. **Lazy Loading**: Load episodes on demand
3. **Caching**: Client-side caching
4. **Web Workers**: Background processing
5. **Service Workers**: Offline support

## Related Documentation

- [Step 4D Integration Guide](./STEP_4D_INTEGRATION_GUIDE.md)
- [LibreTime API Troubleshooting](./LIBRETIME_API_TROUBLESHOOTING.md)
- [Planner Integration Status](./PLANNER_INTEGRATION_STATUS.md)
