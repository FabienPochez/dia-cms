'use client'

import React, { useRef, useEffect, useCallback, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'

interface CalendarComponentProps {
  events?: any[]
  onEventReceive?: (info: any) => void
  onEventDrop?: (info: any) => void
  onEventResize?: (info: any) => void
  onEventDelete?: (episodeId: string, libretimeScheduleId?: number) => void
  onEpisodePlay?: (episode: any) => void
}

const CalendarComponent = React.forwardRef<FullCalendar, CalendarComponentProps>(
  ({ events = [], onEventReceive, onEventDrop, onEventResize, onEventDelete, onEpisodePlay }, ref) => {
    const calendarRef = useRef<FullCalendar>(null)

    // Expose ref to parent
    React.useImperativeHandle(ref, () => calendarRef.current!, [])

    const eventReceiveCountRef = useRef(0)

    console.log('📅 CalendarComponent rendered')

    // Keep a Set ref of recent drop keys to ignore duplicates caused by double-mount
    const seenDrops = useRef(new Set<string>())

    // Add debugging for event receive (this is the key one for external drag-drop)
    const handleEventReceive = useCallback(
      (info: any) => {
        console.log('📥 CalendarComponent eventReceive called (external drop):', info)
        console.log('📥 Event data:', info.event)
        console.log('📥 Event start:', info.event.start)
        console.log('📥 Event end:', info.event.end)

        // Create a unique key for this drop
        const dropKey = `${info.event.extendedProps?.episodeId || 'unknown'}|${info.event.start?.toISOString()}`

        if (seenDrops.current.has(dropKey)) {
          console.log('⚠️ Duplicate drop detected, removing:', dropKey)
          info.event.remove()
          return
        }

        seenDrops.current.add(dropKey)
        console.log('✅ Event added successfully')

        // Call the parent handler if provided
        if (onEventReceive) {
          onEventReceive(info)
        }
      },
      [onEventReceive],
    )

    // Add debugging for event drop (internal drag-drop within calendar)
    const handleEventDrop = useCallback(
      (info: any) => {
        console.log('🔄 CalendarComponent eventDrop called (internal move):', info)
        console.log('🔄 Event data:', info.event)
        console.log('🔄 Event start:', info.event.start)
        console.log('🔄 Event end:', info.event.end)

        // Call the parent handler if provided
        if (onEventDrop) {
          onEventDrop(info)
        }
      },
      [onEventDrop],
    )

    // Add debugging for drag over events
    const handleDragOver = (info: any) => {
      console.log('🔄 Drag over calendar:', info)
    }

    // Add debugging for drag enter events
    const handleDragEnter = (info: any) => {
      console.log('🔄 Drag enter calendar:', info)
    }

    // Add debugging for drag leave events
    const handleDragLeave = (info: any) => {
      console.log('🔄 Drag leave calendar:', info)
    }

    // Handle event allow with duration constraints for resize operations only
    const handleEventAllow = (dropInfo: any, draggedEvent: any) => {
      console.log('✅ Event allow check:', dropInfo, draggedEvent)

      // Only apply duration constraints for resize operations (not for drops or moves)
      // Resize operations have both draggedEvent and dropInfo.start/end
      // Drop operations from external palette don't have draggedEvent.extendedProps.durationMinutes
      if (
        draggedEvent &&
        dropInfo.start &&
        dropInfo.end &&
        draggedEvent.extendedProps?.durationMinutes
      ) {
        const originalDurationMinutes = draggedEvent.extendedProps.durationMinutes
        const newDurationMinutes = Math.round(
          (dropInfo.end.getTime() - dropInfo.start.getTime()) / (1000 * 60),
        )

        console.log(
          '🔍 Resize allow check - Original:',
          originalDurationMinutes,
          'New:',
          newDurationMinutes,
        )

        // Only allow if new duration is less than or equal to original
        if (newDurationMinutes > originalDurationMinutes) {
          console.log('❌ Resize not allowed: exceeds original duration')
          return false
        }
      } else {
        console.log('🔍 Allow check - Not a resize operation, allowing')
      }

      return true
    }

    // Handle event overlap - prevent overlapping events
    const handleEventOverlap = (stillEvent: any, movingEvent: any) => {
      console.log('🔍 Overlap check:', { stillEvent, movingEvent })

      // Check if the moving event would overlap with any existing event
      const movingStart = movingEvent.start
      const movingEnd = movingEvent.end

      if (!movingStart || !movingEnd) {
        console.log('❌ Overlap check failed: missing start/end times')
        return false
      }

      // Check against all existing events
      const calendarApi = calendarRef.current?.getApi()
      if (!calendarApi) {
        console.log('❌ Overlap check failed: no calendar API')
        return false
      }

      const allEvents = calendarApi.getEvents()

      for (const event of allEvents) {
        // Skip the moving event itself
        if (event.id === movingEvent.id) {
          continue
        }

        const eventStart = event.start
        const eventEnd = event.end

        if (!eventStart || !eventEnd) {
          continue
        }

        // Check for overlap: events overlap if one starts before the other ends
        const overlaps = movingStart < eventEnd && movingEnd > eventStart

        if (overlaps) {
          console.log('❌ Overlap detected with event:', event.title, eventStart, eventEnd)
          return false
        }
      }

      console.log('✅ No overlap detected')
      return true
    }

    // Handle event resize (constraints are handled by eventAllow)
    const handleEventResize = useCallback(
      (info: any) => {
        console.log('📏 CalendarComponent eventResize called:', info)
        console.log('📏 Event data:', info.event)
        console.log('📏 Event start:', info.event.start)
        console.log('📏 Event end:', info.event.end)

        // Call the parent handler if provided
        if (onEventResize) {
          onEventResize(info)
        }
      },
      [onEventResize],
    )

    // Handle event click for context menu and selection
    const handleEventClick = useCallback((info: any) => {
      console.log('🖱️ Event clicked:', info.event)
      console.log('🖱️ Event extendedProps:', info.event.extendedProps)
      // Store the clicked event for potential deletion
      setSelectedEvent(info.event)
    }, [])

    // Handle delete button click
    const handleDeleteClick = useCallback(
      (event: React.MouseEvent, episodeId: string, libretimeScheduleId?: number) => {
        event.stopPropagation() // Prevent event click from firing
        console.log('❌ Delete button clicked:', { episodeId, libretimeScheduleId })

        if (window.confirm(`Delete "${episodeId}" from the schedule?`)) {
          console.log('❌ Confirmed deletion, calling onEventDelete')
          if (onEventDelete) {
            onEventDelete(episodeId, libretimeScheduleId)
          } else {
            console.error('❌ onEventDelete function not provided')
          }
        }
      },
      [onEventDelete],
    )

    // State for selected event
    const [selectedEvent, setSelectedEvent] = useState<any>(null)

    // Add energy class to events
    const getEventClassNames = useCallback(
      (arg: any) => {
        const classes = []

        // Selected state
        if (selectedEvent && selectedEvent.id === arg.event.id) {
          classes.push('fc-event-selected')
        }

        // Energy class
        const energy = arg.event.extendedProps?.energy
        if (energy) {
          classes.push(`energy-${energy}`)
        } else {
          classes.push('energy-none')
        }

        return classes
      },
      [selectedEvent],
    )

    // Append mood/tone badges on event mount
    const handleEventDidMount = useCallback((arg: any) => {
      const { mood, tone } = arg.event.extendedProps || {}
      if (!mood && !tone) return

      // Find the event's main content container
      const fcEventMain = arg.el.querySelector('.fc-event-main')
      if (!fcEventMain) return

      // Check if badges already exist (prevent duplicates on re-render)
      if (fcEventMain.querySelector('.fc-badges')) return

      // Create badges container
      const badgesContainer = document.createElement('div')
      badgesContainer.className = 'fc-badges'

      // Add mood badge(s) - max 2
      if (mood) {
        const moods = Array.isArray(mood) ? mood.slice(0, 2) : [mood]
        moods.forEach((m: string) => {
          if (!m) return
          const badge = document.createElement('span')
          badge.className = 'fc-badge fc-badge-mood'
          badge.textContent = m
          badge.title = m // Tooltip
          badgesContainer.appendChild(badge)
        })
      }

      // Add tone badge - max 1
      if (tone) {
        const toneValue = Array.isArray(tone) ? tone[0] : tone
        if (toneValue) {
          const badge = document.createElement('span')
          badge.className = 'fc-badge fc-badge-tone'
          badge.textContent = toneValue
          badge.title = toneValue // Tooltip
          badgesContainer.appendChild(badge)
        }
      }

      // Append at the end (bottom) of event content
      fcEventMain.appendChild(badgesContainer)
    }, [])

    // Custom event content renderer with delete button and play button
    const renderEventContent = useCallback(
      (eventInfo: any) => {
        const episodeId = eventInfo.event.extendedProps?.episodeId
        const libretimeScheduleId = eventInfo.event.extendedProps?.libretimeScheduleId

        const handlePlayClick = async (e: React.MouseEvent) => {
          e.stopPropagation()
          if (!episodeId || !onEpisodePlay) return

          try {
            // Fetch full episode data with depth=1 to populate media relationship
            const response = await fetch(`/api/episodes/${episodeId}?depth=1`, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
            })

            if (!response.ok) {
              throw new Error(`Failed to fetch episode: ${response.status}`)
            }

            const episodeData = await response.json()
            onEpisodePlay(episodeData)
          } catch (error) {
            console.error('[CalendarComponent] Error fetching episode for playback:', error)
          }
        }

        return (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              height: '100%',
              padding: '2px 4px',
              gap: '4px',
            }}
          >
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                fontSize: '12px',
                lineHeight: '1.2',
              }}
            >
              {eventInfo.event.title}
            </div>
            <div
              style={{
                display: 'flex',
                gap: '2px',
                flexShrink: 0,
              }}
            >
              {onEpisodePlay && episodeId && (
                <button
                  onClick={handlePlayClick}
                  style={{
                    background: 'rgba(0, 123, 255, 0.8)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                    color: 'white',
                    fontSize: '9px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  title="Play episode"
                >
                  ▶
                </button>
              )}
              <button
                onClick={(e) => handleDeleteClick(e, episodeId, libretimeScheduleId)}
                style={{
                  background: 'rgba(255, 0, 0, 0.8)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  color: 'white',
                  fontSize: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  lineHeight: 1,
                }}
                title="Delete event"
              >
                ×
              </button>
            </div>
          </div>
        )
      },
      [handleDeleteClick, onEpisodePlay],
    )

    // Handle keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        console.log('⌨️ Key pressed:', event.key, 'Selected event:', selectedEvent)
        // Only handle if an event is selected and Delete key is pressed
        if (event.key === 'Delete' && selectedEvent) {
          const episodeId = selectedEvent.extendedProps?.episodeId
          const libretimeScheduleId = selectedEvent.extendedProps?.libretimeScheduleId

          console.log(
            '⌨️ Delete key pressed, EpisodeId:',
            episodeId,
            'LibreTimeScheduleId:',
            libretimeScheduleId,
          )

          if (episodeId && window.confirm(`Delete "${selectedEvent.title}" from the schedule?`)) {
            console.log('⌨️ Confirmed deletion, calling onEventDelete')
            if (onEventDelete) {
              onEventDelete(episodeId, libretimeScheduleId)
            } else {
              console.error('❌ onEventDelete function not provided')
            }
            setSelectedEvent(null) // Clear selection
          }
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [selectedEvent, onEventDelete])

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Help text */}
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: '#f8f9fa',
            borderBottom: '1px solid #dee2e6',
            fontSize: '12px',
            color: '#6c757d',
          }}
        >
          💡 <strong>Tip:</strong> Click the red × button on any event to delete it, or select an
          event and press Delete key
        </div>

        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          firstDay={1}
          height="100%"
          events={events}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          editable={true}
          selectable={true}
          selectMirror={true}
          dayMaxEvents={true}
          weekends={true}
          nowIndicator={true}
          droppable={true}
          eventResize={true} // Enable resizing
          eventStartEditable={true}
          eventDurationEditable={true} // Enable duration editing
          eventResizeFromStart={false} // Disable resizing from start (only from end)
          eventResizeFromEnd={true} // Only allow resizing from the end
          eventReceive={handleEventReceive}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          eventContent={renderEventContent}
          eventAllow={handleEventAllow}
          eventOverlap={handleEventOverlap}
          eventClassNames={getEventClassNames}
          eventDidMount={handleEventDidMount}
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }}
          slotLabelFormat={{
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }}
          slotDuration="00:15:00" // 15-minute slots for better precision
          snapDuration="00:05:00" // 5-minute snap intervals for resizing
        />

        <style jsx>{`
          :global(.fc-event-selected) {
            box-shadow: 0 0 0 2px #007bff !important;
            border: 2px solid #007bff !important;
          }

          /* Ensure white X in red close button stays visible */
          :global(.fc-event button) {
            color: white !important;
          }

          :global(.fc-event button *) {
            color: white !important;
          }

          :global(.fc-event button svg) {
            fill: white !important;
          }

          /* Override any energy color inheritance for delete button */
          :global(.fc-event.energy-low button),
          :global(.fc-event.energy-medium button),
          :global(.fc-event.energy-high button) {
            color: white !important;
          }

          :global(.fc-event.energy-low button *),
          :global(.fc-event.energy-medium button *),
          :global(.fc-event.energy-high button *) {
            color: white !important;
          }

          /* Energy color classes - light backgrounds with single dark text color */
          :global(.fc-event.energy-low) {
            background-color: #e8f5e9 !important;
            border-color: #a5d6a7 !important;
            color: #171717 !important;
          }

          :global(.fc-event.energy-low *) {
            color: #171717 !important;
          }

          :global(.fc-event.energy-low .fc-event-title),
          :global(.fc-event.energy-low .fc-event-title *) {
            color: #171717 !important;
          }

          :global(.fc-event.energy-medium) {
            background-color: #fff8e1 !important;
            border-color: #ffd54f !important;
            color: #171717 !important;
          }

          :global(.fc-event.energy-medium *) {
            color: #171717 !important;
          }

          :global(.fc-event.energy-medium .fc-event-title),
          :global(.fc-event.energy-medium .fc-event-title *) {
            color: #171717 !important;
          }

          :global(.fc-event.energy-high) {
            background-color: #ffebee !important;
            border-color: #ef9a9a !important;
            color: #171717 !important;
          }

          :global(.fc-event.energy-high *) {
            color: #171717 !important;
          }

          :global(.fc-event.energy-high .fc-event-title),
          :global(.fc-event.energy-high .fc-event-title *) {
            color: #171717 !important;
          }

          :global(.fc-event.energy-none) {
            /* No override - use FullCalendar defaults (blue) */
          }

          /* Mood/Tone badges - positioned at bottom */
          :global(.fc-badges) {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
            margin-top: auto;
            padding-top: 3px;
            order: 2; /* Force to bottom */
          }

          :global(.fc-event-main) {
            display: flex !important;
            flex-direction: column !important;
            height: 100% !important;
          }

          :global(.fc-event-title) {
            order: 1; /* Force title to top */
          }

          :global(.fc-badge) {
            font-size: 9px;
            padding: 1px 4px;
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(0, 0, 0, 0.15);
            border-radius: 8px;
            color: #495057;
            font-weight: 600;
            text-transform: capitalize;
            white-space: nowrap;
            max-width: 60px;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          :global(.fc-badge-mood) {
            background: rgba(255, 255, 255, 0.8);
          }

          :global(.fc-badge-tone) {
            background: rgba(255, 255, 255, 0.6);
          }
        `}</style>
      </div>
    )
  },
)

CalendarComponent.displayName = 'CalendarComponent'

export default CalendarComponent
