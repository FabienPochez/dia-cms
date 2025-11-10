'use client'

import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useScheduledEpisodes } from '../hooks/useScheduledEpisodes'
import { CalendarEvent, ScheduledEpisode } from '../types/calendar'

// Dynamically import CalendarComponent only on client side
const CalendarComponent = dynamic(() => import('./CalendarComponent'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontSize: '16px',
        color: '#666',
      }}
    >
      Loading calendar...
    </div>
  ),
})

// Also dynamically import EventPalette to ensure it's client-side only
const DynamicEventPalette = dynamic(() => import('./EventPalette'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontSize: '16px',
        color: '#666',
      }}
    >
      Loading palette...
    </div>
  ),
})

const PlannerView: React.FC = () => {
  // Client-side only state to prevent hydration issues
  const [isClient, setIsClient] = useState(false)

  // Fetch scheduled episodes
  const {
    episodes: scheduledEpisodes,
    loading: scheduledLoading,
    refetch: refetchScheduled,
  } = useScheduledEpisodes()

  // Local state for newly added episodes (to show them immediately)
  const [newlyAddedEpisodes, setNewlyAddedEpisodes] = useState<ScheduledEpisode[]>([])

  useEffect(() => {
    setIsClient(true)
  }, [])

  // Combine scheduled episodes with newly added episodes
  const allEpisodes = [...scheduledEpisodes, ...newlyAddedEpisodes]

  // Convert episodes to calendar events
  const calendarEvents: CalendarEvent[] = allEpisodes.map((episode) => ({
    id: `ev:${episode.episodeId}`,
    title: episode.title,
    start: episode.start,
    end: episode.end,
    extendedProps: {
      episodeId: episode.episodeId,
      durationMinutes: episode.durationMinutes,
    },
  }))

  // Debug logging
  console.log('📊 Scheduled episodes count:', scheduledEpisodes.length)
  console.log('📊 Newly added episodes count:', newlyAddedEpisodes.length)
  console.log('📊 Total episodes count:', allEpisodes.length)
  console.log('📊 Calendar events count:', calendarEvents.length)

  // Persistence functions
  const persistEpisodeSchedule = useCallback(
    async (episodeId: string, start: Date, end: Date, title?: string) => {
      try {
        const response = await fetch(`/api/episodes/${episodeId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scheduledAt: start.toISOString(),
            scheduledEnd: end.toISOString(),
            airStatus: 'scheduled',
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to schedule episode: ${response.status} ${response.statusText}`)
        }

        console.log('✅ Episode scheduled successfully:', episodeId)

        // Add to local state immediately for instant feedback
        const newEpisode: ScheduledEpisode = {
          episodeId,
          title: title || 'New Episode',
          start,
          end,
          durationMinutes: Math.round((end.getTime() - start.getTime()) / (1000 * 60)),
        }
        setNewlyAddedEpisodes((prev) => [...prev, newEpisode])

        // Refetch scheduled episodes to update the calendar (with small delay to ensure DB is updated)
        setTimeout(() => {
          refetchScheduled()
          // Clear newly added episodes after refetch (they should now be in scheduledEpisodes)
          setNewlyAddedEpisodes([])
        }, 1000)
      } catch (error) {
        console.error('❌ Failed to schedule episode:', error)
        throw error
      }
    },
    [refetchScheduled],
  )

  const updateEpisodeSchedule = useCallback(
    async (episodeId: string, start: Date, end: Date) => {
      try {
        const response = await fetch(`/api/episodes/${episodeId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scheduledAt: start.toISOString(),
            scheduledEnd: end.toISOString(),
          }),
        })

        if (!response.ok) {
          throw new Error(
            `Failed to update episode schedule: ${response.status} ${response.statusText}`,
          )
        }

        console.log('✅ Episode schedule updated successfully:', episodeId)
        // Refetch scheduled episodes to update the calendar (with small delay to ensure DB is updated)
        setTimeout(() => {
          refetchScheduled()
        }, 500)
      } catch (error) {
        console.error('❌ Failed to update episode schedule:', error)
        throw error
      }
    },
    [refetchScheduled],
  )

  // Handle event receive (drop from palette)
  const handleEventReceive = useCallback(
    async (info: any) => {
      const episodeId = info.event.extendedProps?.episodeId
      const start = info.event.start
      const durationMinutes = info.event.extendedProps?.durationMinutes || 60
      const title = info.event.title

      if (!episodeId || !start) {
        console.error('❌ Missing episodeId or start time')
        info.event.remove()
        return
      }

      try {
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
        await persistEpisodeSchedule(episodeId, start, end, title)

        // Set the event ID to match our pattern
        info.event.setProp('id', `ev:${episodeId}`)
      } catch (error) {
        console.error('❌ Failed to persist episode schedule:', error)
        info.event.remove()
      }
    },
    [persistEpisodeSchedule],
  )

  // Handle event drop (move existing event)
  const handleEventDrop = useCallback(
    async (info: any) => {
      const episodeId = info.event.extendedProps?.episodeId
      const start = info.event.start
      const durationMinutes = info.event.extendedProps?.durationMinutes || 60

      if (!episodeId || !start) {
        console.error('❌ Missing episodeId or start time')
        info.revert()
        return
      }

      try {
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
        await updateEpisodeSchedule(episodeId, start, end)
      } catch (error) {
        console.error('❌ Failed to update episode schedule:', error)
        info.revert()
      }
    },
    [updateEpisodeSchedule],
  )

  // Handle event resize (resize existing event)
  const handleEventResize = useCallback(
    async (info: any) => {
      const episodeId = info.event.extendedProps?.episodeId
      const start = info.event.start
      const end = info.event.end

      if (!episodeId || !start || !end) {
        console.error('❌ Missing episodeId, start, or end time')
        info.revert()
        return
      }

      try {
        await updateEpisodeSchedule(episodeId, start, end)
      } catch (error) {
        console.error('❌ Failed to update episode schedule after resize:', error)
        info.revert()
      }
    },
    [updateEpisodeSchedule],
  )

  // Handle event delete (remove from schedule)
  const handleEventDelete = useCallback(
    async (episodeId: string) => {
      try {
        const response = await fetch(`/api/episodes/${episodeId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scheduledAt: null,
            scheduledEnd: null,
            airStatus: 'draft',
          }),
        })

        if (!response.ok) {
          throw new Error(
            `Failed to clear episode schedule: ${response.status} ${response.statusText}`,
          )
        }

        console.log('✅ Episode schedule cleared successfully:', episodeId)

        // Refetch scheduled episodes to update the calendar
        setTimeout(() => {
          refetchScheduled()
        }, 500)
      } catch (error) {
        console.error('❌ Failed to clear episode schedule:', error)
        throw error
      }
    },
    [refetchScheduled],
  )

  // Don't render anything on server side to prevent hydration issues
  if (!isClient) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ margin: '0 0 20px 0', padding: '0 20px' }}>Episode Planner</h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 120px)',
            fontSize: '16px',
            color: '#666',
          }}
        >
          Loading planner...
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ margin: '0 0 20px 0', padding: '0 20px' }}>Episode Planner</h1>

      {!isClient ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 120px)',
            fontSize: '16px',
            color: '#666',
          }}
        >
          Loading planner...
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            height: 'calc(100vh - 120px)',
            gap: '0',
          }}
        >
          {/* Episode Palette - Left Column */}
          <div style={{ width: '25%', minWidth: '250px' }}>
            <DynamicEventPalette />
          </div>

          {/* Calendar - Right Column */}
          <div
            style={{
              width: '75%',
              padding: '0 20px 20px 20px',
              backgroundColor: '#fff',
            }}
          >
            <CalendarComponent
              events={calendarEvents}
              onEventReceive={handleEventReceive}
              onEventDrop={handleEventDrop}
              onEventResize={handleEventResize}
              onEventDelete={handleEventDelete}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default PlannerView
