'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import type FullCalendar from '@fullcalendar/react'
import { useScheduledEpisodes } from '../hooks/useScheduledEpisodes'
import { CalendarEvent, ScheduledEpisode } from '../types/calendar'
import {
  createLibreTimeSchedule,
  updateLibreTimeSchedule,
  deleteLibreTimeSchedule,
  updateEpisodeSchedule,
  showToast,
  debounce,
  EpisodeScheduleData,
} from '@/integrations/plannerUtils'
import { libreTimeApi } from '@/integrations/libretimeApi'
import { plannerBus } from '../lib/plannerBus'
import type { SyncWindowResult } from '@/lib/schedule/syncWindow'
import FixedAudioPlayer from './FixedAudioPlayer'
import type { Episode } from '../../../payload-types'

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

type EnvelopeSummary = {
  created: number
  updated: number
  deleted: number
  skippedMissing: number
  missingIds: string[]
  protectedNow: number
  partial: boolean
}

type EnvelopeWindow = SyncWindowResult & {
  nowUtc: string
  nowParis: string
}

const PlannerViewWithLibreTime: React.FC = () => {
  // Client-side only state to prevent hydration issues
  const [isClient, setIsClient] = useState(false)

  // LibreTime integration state
  const [libreTimeEnabled, setLibreTimeEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Sync feature state
  const [syncInFlight, setSyncInFlight] = useState(false)
  const [pendingSync, setPendingSync] = useState<{ summary: EnvelopeSummary; window: EnvelopeWindow } | null>(null)
  const [confirmAcknowledged, setConfirmAcknowledged] = useState(false)
  const [lastSyncSummary, setLastSyncSummary] = useState<{
    summary: EnvelopeSummary
    feedStatus: string
    windowLabel: string
    snapshotId?: string | null
  } | null>(null)

  // Rehydrate feature state
  const [rehydrateInFlight, setRehydrateInFlight] = useState(false)

  // Audio player state
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null)

  // Calendar ref for accessing visible range
  const calendarRef = useRef<FullCalendar | null>(null)

  // Debounced operations to prevent duplicate calls
  const debouncedCreateSchedule = useRef(debounce(handleCreateSchedule, 500))
  const debouncedUpdateSchedule = useRef(debounce(handleUpdateSchedule, 500))
  const debouncedDeleteSchedule = useRef(debounce(handleDeleteSchedule, 500))

  // Fetch scheduled episodes
  const {
    episodes: scheduledEpisodes,
    loading: _scheduledLoading,
    refetch: refetchScheduled,
  } = useScheduledEpisodes()

  // Local state for newly added episodes (to show them immediately)
  const [newlyAddedEpisodes, setNewlyAddedEpisodes] = useState<ScheduledEpisode[]>([])

  useEffect(() => {
    setIsClient(true)
    checkLibreTimeConnection()
  }, [])

  // Check LibreTime connection on mount
  const checkLibreTimeConnection = async () => {
    // Force LibreTime mode for testing Step 3B functionality
    const forceLibreTimeMode =
      process.env.NODE_ENV === 'development' || process.env.PAYLOAD_FORCE_LIBRETIME_MODE === 'true'

    if (forceLibreTimeMode) {
      console.log('[PLANNER] Forcing LibreTime mode for testing')
      setLibreTimeEnabled(true)
      showToast('LibreTime mode forced for testing', 'warning')
      return
    }

    try {
      const response = await libreTimeApi.testConnection()
      setLibreTimeEnabled(response.data || false)

      if (response.data) {
        showToast('LibreTime connected successfully', 'success')
      } else {
        showToast('LibreTime connection failed - scheduling disabled', 'warning')
      }
    } catch (error) {
      console.error('[PLANNER] LibreTime connection check failed:', error)
      showToast('LibreTime connection failed - scheduling disabled', 'warning')
    }
  }

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
      libretimeScheduleId: episode.libretimeScheduleId, // Store LT schedule ID
      libretimeTrackId: episode.libretimeTrackId, // Store LT file ID
      libretimeInstanceId: episode.libretimeInstanceId || 1, // Use episode's instance ID or default
      energy: episode.energy,
      mood: episode.mood,
      tone: episode.tone,
      publishedStatus: episode.publishedStatus, // Include to identify New tab episodes
      isLive: episode.isLive === true, // Include to identify Live episodes
    },
  }))

  // Debug logging
  console.log('📊 Scheduled episodes count:', scheduledEpisodes.length)
  console.log('📊 Newly added episodes count:', newlyAddedEpisodes.length)
  console.log('📊 Total episodes count:', allEpisodes.length)
  console.log('📊 Calendar events count:', calendarEvents.length)
  console.log('📊 LibreTime enabled:', libreTimeEnabled)

  // Handle creating a new schedule (drop from palette)
  async function handleCreateSchedule(episodeId: string, start: Date, end: Date, title?: string) {
    // Always try Step 3B flow first, fall back to local if it fails
    if (!libreTimeEnabled) {
      console.log('[PLANNER] LibreTime not enabled, trying Step 3B flow anyway...')
    }

    setIsLoading(true)

    try {
      // Get episode data to find libretimeTrackId (with retry on 429)
      const fetchEpisodeWithRetry = async (retryCount = 0): Promise<Response> => {
        const response = await fetch(`/api/episodes/${episodeId}`)
        if (response.status === 429 && retryCount < 1) {
          const retryAfter = response.headers.get('Retry-After')
          const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : 2000
          console.warn(`[PLANNER] Rate limited (429) fetching episode, retrying after ${retryMs}ms`)
          await new Promise((resolve) => setTimeout(resolve, retryMs))
          return fetchEpisodeWithRetry(retryCount + 1)
        }
        if (!response.ok) {
          throw new Error(`Failed to fetch episode data: ${response.status} ${response.statusText}`)
        }
        return response
      }
      const episodeResponse = await fetchEpisodeWithRetry()

      const episodeData = await episodeResponse.json()
      const isLive = episodeData.isLive === true
      const libretimeTrackId = episodeData.libretimeTrackId

      console.log('[PLANNER] Episode data:', {
        episodeId,
        isLive,
        isLiveValue: episodeData.isLive,
        libretimeTrackId,
        hasLibretimeTrackId: !!libretimeTrackId,
      })

      // Live episodes don't require LibreTime track ID (they're live broadcasts, not pre-recorded files)
      if (!isLive && !libretimeTrackId) {
        showToast('Episode has no LibreTime track ID - cannot schedule', 'error')
        return
      }

      // For Live episodes, use Payload-only scheduling (no LibreTime track needed)
      if (isLive) {
        console.log('[PLANNER] Scheduling Live episode (Payload-only, no LibreTime track required)')
        return await persistEpisodeScheduleLocal(episodeId, start, end, title)
      }

      const scheduleData: EpisodeScheduleData = {
        episodeId,
        libretimeTrackId,
        durationMinutes: Math.round((end.getTime() - start.getTime()) / (1000 * 60)),
        startsAt: start,
        endsAt: end,
      }

      // Create schedule in LibreTime
      const ltResult = await createLibreTimeSchedule(episodeId, scheduleData)

      if (!ltResult.success) {
        if (ltResult.code === 'LT_INSTANCE_REQUIRED') {
          showToast(
            'Show must be mapped to a LibreTime instance. Open Show → set instance.',
            'error',
          )
          return
        } else {
          console.log(
            '[PLANNER] Step 3B flow failed, falling back to local scheduling:',
            ltResult.error,
          )
          showToast(
            `LibreTime scheduling failed, using local scheduling: ${ltResult.error}`,
            'warning',
          )
          // Fall back to local scheduling
          return await persistEpisodeScheduleLocal(episodeId, start, end, title)
        }
      }

      // Update episode in Payload with schedule data
      const updateResult = await updateEpisodeSchedule(episodeId, {
        scheduledAt: start.toISOString(),
        scheduledEnd: end.toISOString(),
        airStatus: 'scheduled',
        libretimeScheduleId: ltResult.scheduleId,
      })

      if (!updateResult.success) {
        showToast(`Failed to update episode: ${updateResult.error}`, 'error')
        // Try to clean up LibreTime schedule
        if (ltResult.scheduleId) {
          await deleteLibreTimeSchedule(ltResult.scheduleId)
        }
        return
      }

      showToast('Episode scheduled successfully in LibreTime', 'success')

      // Add to local state immediately for instant feedback
      const newEpisode: ScheduledEpisode = {
        episodeId,
        title: title || 'New Episode',
        start,
        end,
        durationMinutes: Math.round((end.getTime() - start.getTime()) / (1000 * 60)),
        ...(ltResult.scheduleId && { libretimeScheduleId: ltResult.scheduleId }),
      }
      setNewlyAddedEpisodes((prev) => [...prev, newEpisode])

      // Refetch scheduled episodes to update the calendar
      setTimeout(() => {
        refetchScheduled()
        setNewlyAddedEpisodes([])
      }, 1000)
    } catch (error) {
      console.error('[PLANNER] Failed to create schedule:', error)
      showToast(
        `Scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Handle updating an existing schedule (move/resize)
  async function handleUpdateSchedule(
    episodeId: string,
    start: Date,
    end: Date,
    libretimeScheduleId?: number,
    libretimeTrackId?: number,
    libretimeInstanceId?: number,
  ) {
    if (!libreTimeEnabled) {
      showToast('LibreTime not available - using local scheduling only', 'warning')
      return await updateEpisodeScheduleLocal(episodeId, start, end)
    }

    if (!libretimeScheduleId) {
      showToast('No LibreTime schedule ID found - cannot update', 'error')
      return
    }

    setIsLoading(true)

    try {
      // Update schedule in LibreTime with fallback
      const ltResult = await updateLibreTimeSchedule(
        libretimeScheduleId,
        start,
        end,
        episodeId,
        libretimeTrackId,
        libretimeInstanceId,
      )

      if (!ltResult.success) {
        if (ltResult.code === 'LT_INSTANCE_REQUIRED') {
          showToast(
            'Show must be mapped to a LibreTime instance. Open Show → set instance.',
            'error',
          )
        } else {
          showToast(`LibreTime update failed: ${ltResult.error}`, 'error')
        }
        return
      }

      // Update episode in Payload
      const updateData: any = {
        scheduledAt: start.toISOString(),
        scheduledEnd: end.toISOString(),
      }

      // If we got a new schedule ID (fallback was used), update it
      if (ltResult.scheduleId && ltResult.scheduleId !== libretimeScheduleId) {
        updateData.libretimeScheduleId = ltResult.scheduleId
      }

      const updateResult = await updateEpisodeSchedule(episodeId, updateData)

      if (!updateResult.success) {
        showToast(`Failed to update episode: ${updateResult.error}`, 'error')
        return
      }

      const message = ltResult.usedFallback
        ? 'Schedule moved successfully (using fallback method)'
        : 'Schedule updated successfully in LibreTime'
      showToast(message, 'success')

      // Refetch scheduled episodes to update the calendar
      setTimeout(() => {
        refetchScheduled()
      }, 500)
    } catch (error) {
      console.error('[PLANNER] Failed to update schedule:', error)
      showToast(
        `Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Handle deleting a schedule
  async function handleDeleteSchedule(episodeId: string, libretimeScheduleId?: number) {
    console.log('🗑️ handleDeleteSchedule called with:', {
      episodeId,
      libretimeScheduleId,
      libreTimeEnabled,
    })

    if (!libreTimeEnabled) {
      console.log('🗑️ LibreTime not enabled, using local scheduling')
      showToast('LibreTime not available - using local scheduling only', 'warning')
      return await clearEpisodeScheduleLocal(episodeId)
    }

    if (!libretimeScheduleId) {
      console.log('🗑️ No LibreTime schedule ID found, falling back to local deletion')
      showToast('No LibreTime schedule ID found - clearing local schedule', 'warning')
      return await clearEpisodeScheduleLocal(episodeId)
    }

    setIsLoading(true)

    try {
      // Delete schedule from LibreTime
      const ltResult = await deleteLibreTimeSchedule(libretimeScheduleId, episodeId)

      if (!ltResult.success) {
        if (ltResult.code === 'LT_INSTANCE_REQUIRED') {
          showToast(
            'Show must be mapped to a LibreTime instance. Open Show → set instance.',
            'error',
          )
        } else {
          showToast(`LibreTime deletion failed: ${ltResult.error}`, 'error')
        }
        return
      }

      // Fetch episode first to determine target airStatus when unscheduling
      const episodeResponse = await fetch(`/api/episodes/${episodeId}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!episodeResponse.ok) {
        throw new Error(`Failed to fetch episode: ${episodeResponse.status} ${episodeResponse.statusText}`)
      }

      const episodeData = await episodeResponse.json()
      
      // Determine target airStatus when unscheduling:
      // - Live episodes (isLive=true): always revert to 'draft' (never delete)
      // - Episodes with publishedStatus='submitted' (New tab) should revert to 'queued'
      // - Episodes with publishedStatus='published' (Archive tab) should go to 'draft'
      // This ensures New tab episodes reappear in the list, while Archive episodes don't leak into New tab
      // (New tab filter requires publishedStatus='submitted', so Archive episodes won't appear there)
      const isLive = episodeData.isLive === true
      const isLtReady = episodeData.libretimeTrackId && episodeData.libretimeFilepathRelative
      const isSubmitted = episodeData.publishedStatus === 'submitted'
      // Live episodes always go to 'draft', otherwise restore to 'queued' for submitted LT-ready episodes (New tab), 'draft' otherwise
      const targetAirStatus = isLive ? 'draft' : isSubmitted && isLtReady ? 'queued' : 'draft'

      // Clear episode schedule in Payload
      const updateResult = await updateEpisodeSchedule(episodeId, {
        scheduledAt: undefined,
        scheduledEnd: undefined,
        airStatus: targetAirStatus,
        libretimeScheduleId: undefined,
      })

      if (!updateResult.success) {
        showToast(`Failed to clear episode schedule: ${updateResult.error}`, 'error')
        return
      }

      showToast('Schedule deleted successfully from LibreTime', 'success')

      // Refetch scheduled episodes to update the calendar
      setTimeout(() => {
        refetchScheduled()
      }, 500)
    } catch (error) {
      console.error('[PLANNER] Failed to delete schedule:', error)
      showToast(
        `Deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Fallback local scheduling (without LibreTime)
  const persistEpisodeScheduleLocal = useCallback(
    async (episodeId: string, start: Date, end: Date, title?: string) => {
      console.log('[PLANNER] Attempting local schedule update:', { episodeId, start, end })
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
          const errorText = await response.text().catch(() => response.statusText)
          const errorData = (() => {
            try {
              return JSON.parse(errorText)
            } catch {
              return { message: errorText }
            }
          })()
          console.error('[PLANNER] Schedule update failed:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData,
          })
          throw new Error(
            `Failed to schedule episode: ${response.status} ${response.statusText} - ${errorData.message || errorData.error || errorText}`,
          )
        }

        console.log('[PLANNER] Episode scheduled locally:', episodeId)

        // Fetch episode data to get isLive status for visual indicator
        let isLive = false
        try {
          const episodeResponse = await fetch(`/api/episodes/${episodeId}`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          })
          if (episodeResponse.ok) {
            const episodeData = await episodeResponse.json()
            isLive = episodeData.isLive === true
          }
        } catch (err) {
          console.warn('[PLANNER] Failed to fetch episode data for isLive, continuing without it:', err)
        }

        // Add to local state immediately for instant feedback
        const newEpisode: ScheduledEpisode = {
          episodeId,
          title: title || 'New Episode',
          start,
          end,
          durationMinutes: Math.round((end.getTime() - start.getTime()) / (1000 * 60)),
          isLive: isLive || undefined,
        }
        setNewlyAddedEpisodes((prev) => [...prev, newEpisode])

        // Refetch scheduled episodes to update the calendar
        setTimeout(() => {
          refetchScheduled()
          setNewlyAddedEpisodes([])
        }, 1000)
      } catch (error) {
        console.error('[PLANNER] Failed to schedule episode locally:', error)
        throw error
      }
    },
    [refetchScheduled],
  )

  const updateEpisodeScheduleLocal = useCallback(
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

        console.log('[PLANNER] Episode schedule updated locally:', episodeId)

        // Refetch scheduled episodes to update the calendar
        setTimeout(() => {
          refetchScheduled()
        }, 500)
      } catch (error) {
        console.error('[PLANNER] Failed to update episode schedule locally:', error)
        throw error
      }
    },
    [refetchScheduled],
  )

  const clearEpisodeScheduleLocal = useCallback(
    async (episodeId: string) => {
      try {
        // Fetch episode first to check if it was originally queued (from New tab)
        const episodeResponse = await fetch(`/api/episodes/${episodeId}`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!episodeResponse.ok) {
          throw new Error(`Failed to fetch episode: ${episodeResponse.status} ${episodeResponse.statusText}`)
        }

        const episodeData = await episodeResponse.json()
        
        // Determine target airStatus when unscheduling:
        // - Live episodes (isLive=true): always revert to 'draft' (never delete)
        // - Episodes with publishedStatus='submitted' (New tab) should revert to 'queued'
        // - Episodes with publishedStatus='published' (Archive tab) should go to 'draft'
        // This ensures New tab episodes reappear in the list, while Archive episodes don't leak into New tab
        // (New tab filter requires publishedStatus='submitted', so Archive episodes won't appear there)
        const isLive = episodeData.isLive === true
        const isLtReady = episodeData.libretimeTrackId && episodeData.libretimeFilepathRelative
        const isSubmitted = episodeData.publishedStatus === 'submitted'
        // Live episodes always go to 'draft', otherwise restore to 'queued' for submitted LT-ready episodes (New tab), 'draft' otherwise
        const targetAirStatus = isLive ? 'draft' : isSubmitted && isLtReady ? 'queued' : 'draft'

        const response = await fetch(`/api/episodes/${episodeId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scheduledAt: null,
            scheduledEnd: null,
            airStatus: targetAirStatus,
          }),
        })

        if (!response.ok) {
          throw new Error(
            `Failed to clear episode schedule: ${response.status} ${response.statusText}`,
          )
        }

        console.log('[PLANNER] Episode schedule cleared locally:', episodeId)

        // Refetch scheduled episodes to update the calendar
        setTimeout(() => {
          refetchScheduled()
        }, 500)
      } catch (error) {
        console.error('[PLANNER] Failed to clear episode schedule locally:', error)
        throw error
      }
    },
    [refetchScheduled],
  )

  // Handle event receive (drop from palette)
  const handleEventReceive = useCallback(async (info: any) => {
    const episodeId = info.event.extendedProps?.episodeId
    const showId = info.event.extendedProps?.showId
    const isShow = info.event.extendedProps?.isShow
    const start = info.event.start
    const durationMinutes = info.event.extendedProps?.durationMinutes || 60
    const title = info.event.title

    // Handle show drops (Live tab) - find/reuse or create Live Draft episode, then schedule
    if (isShow && showId) {
      if (!start) {
        console.error('[PLANNER] Missing start time for show drop')
        info.event.remove()
        return
      }

      try {
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000)

        // Step 1: Look for existing Live Draft episode for this show
        // Criteria: isLive=true, no media (not from upload form), draft/scheduled, not yet aired
        console.log('[PLANNER] Looking for existing Live Draft episode for show:', showId)
        const searchParams = new URLSearchParams({
          where: JSON.stringify({
            and: [
              { show: { equals: showId } },
              { isLive: { equals: true } },
              {
                or: [
                  { airStatus: { equals: 'draft' } },
                  { airStatus: { equals: 'scheduled' } },
                ],
              },
              { firstAiredAt: { exists: false } },
              // Exclude episodes with media (upload form episodes have media)
              { media: { exists: false } },
              // Exclude episodes with LibreTime track ID (upload form episodes have this)
              { libretimeTrackId: { exists: false } },
              // Ensure it's a draft (not submitted from upload form)
              { publishedStatus: { equals: 'draft' } },
              // Ensure it's not pending review (upload form episodes have this)
              { pendingReview: { equals: false } },
            ],
          }),
          limit: '1',
        })
        const searchResponse = await fetch(`/api/episodes?${searchParams.toString()}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!searchResponse.ok) {
          throw new Error(`Failed to search for Live Draft episode: ${searchResponse.status}`)
        }

        const searchData = await searchResponse.json()
        let targetEpisodeId: string | null = null

        if (searchData.docs && searchData.docs.length > 0) {
          // Found a potential match - validate it before reusing
          const candidateEpisode = searchData.docs[0]
          const candidateId = candidateEpisode.id
          
          console.log('[PLANNER] Found potential Live Draft episode, validating:', candidateId)
          
          // Fetch full episode data to validate
          const validateResponse = await fetch(`/api/episodes/${candidateId}`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          })
          
          if (!validateResponse.ok) {
            console.log('[PLANNER] Failed to fetch candidate episode for validation, will create new one')
          } else {
            const episodeData = await validateResponse.json()
            
            // Validate it's a true Live Draft episode (not from upload form)
            const isValidLiveDraft =
              episodeData.isLive === true &&
              !episodeData.media &&
              !episodeData.libretimeTrackId &&
              episodeData.publishedStatus === 'draft' &&
              episodeData.pendingReview === false &&
              (episodeData.airStatus === 'draft' || episodeData.airStatus === 'scheduled')
            
            if (isValidLiveDraft) {
              // Valid Live Draft episode - reuse it
              targetEpisodeId = candidateId
              console.log('[PLANNER] Validated Live Draft episode, reusing:', targetEpisodeId)
            } else {
              console.log('[PLANNER] Candidate episode failed validation (not a true Live Draft), will create new one:', {
                isLive: episodeData.isLive,
                hasMedia: !!episodeData.media,
                hasLibretimeTrackId: !!episodeData.libretimeTrackId,
                publishedStatus: episodeData.publishedStatus,
                pendingReview: episodeData.pendingReview,
                airStatus: episodeData.airStatus,
              })
            }
          }
        }
        
        if (!targetEpisodeId) {
          // No valid Live Draft episode found - create new one
          // Create new Live Draft episode
          console.log('[PLANNER] No existing Live Draft episode found, creating new one')
          const createResponse = await fetch('/api/episodes', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              show: showId,
              title: title || 'Live Episode',
              publishedStatus: 'draft',
              airStatus: 'draft', // Will be set to 'scheduled' by scheduling logic
              isLive: true,
              pendingReview: false,
              publishedAt: start.toISOString(), // Required field
            }),
          })

          if (!createResponse.ok) {
            const errorText = await createResponse.text().catch(() => createResponse.statusText)
            let errorData: any = {}
            try {
              errorData = JSON.parse(errorText)
            } catch {
              errorData = { message: errorText }
            }
            console.error('[PLANNER] Failed to create Live Draft episode:', {
              status: createResponse.status,
              statusText: createResponse.statusText,
              error: errorData,
              headers: Object.fromEntries(createResponse.headers.entries()),
            })
            throw new Error(
              `Failed to create Live Draft episode: ${createResponse.status} ${createResponse.statusText} - ${errorData.message || errorData.error || errorText}`,
            )
          }

          const newEpisode = await createResponse.json()
          targetEpisodeId = newEpisode.id || newEpisode.doc?.id

          if (!targetEpisodeId) {
            throw new Error('Live Draft episode created but no ID returned')
          }

          console.log('[PLANNER] Created new Live Draft episode:', targetEpisodeId)
        }

        // Step 2: Schedule the episode using existing logic
        await debouncedCreateSchedule.current(targetEpisodeId, start, end, title)

        // Set the event ID to match our pattern
        info.event.setProp('id', `ev:${targetEpisodeId}`)
        info.event.setExtendedProp('episodeId', targetEpisodeId) // Update extendedProps for consistency

        // Emit SCHEDULED event for palette sync
        plannerBus.emitScheduled(targetEpisodeId, start.toISOString())
      } catch (error) {
        console.error('[PLANNER] Failed to create/reuse and schedule Live Draft episode:', error)
        showToast(
          `Failed to schedule live episode: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'error',
        )
        info.event.remove()
      }
      return
    }

    // Handle episode drops (Archive/New tabs) - existing logic
    if (!episodeId || !start) {
      console.error('[PLANNER] Missing episodeId or start time')
      info.event.remove()
      return
    }

    try {
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
      await debouncedCreateSchedule.current(episodeId, start, end, title)

      // Set the event ID to match our pattern
      info.event.setProp('id', `ev:${episodeId}`)

      // Emit SCHEDULED event for palette sync
      plannerBus.emitScheduled(episodeId, start.toISOString())
    } catch (error) {
      console.error('[PLANNER] Failed to persist episode schedule:', error)
      info.event.remove()
    }
  }, [])

  // Handle event drop (move existing event)
  const handleEventDrop = useCallback(async (info: any) => {
    const episodeId = info.event.extendedProps?.episodeId
    const start = info.event.start
    const durationMinutes = info.event.extendedProps?.durationMinutes || 60
    const libretimeScheduleId = info.event.extendedProps?.libretimeScheduleId
    const libretimeTrackId = info.event.extendedProps?.libretimeTrackId
    const libretimeInstanceId = info.event.extendedProps?.libretimeInstanceId

    if (!episodeId || !start) {
      console.error('[PLANNER] Missing episodeId or start time')
      info.revert()
      return
    }

    try {
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
      await debouncedUpdateSchedule.current(
        episodeId,
        start,
        end,
        libretimeScheduleId,
        libretimeTrackId,
        libretimeInstanceId,
      )

      // Emit RESCHEDULED event for palette sync
      plannerBus.emitRescheduled(episodeId, start.toISOString())
    } catch (error) {
      console.error('[PLANNER] Failed to update episode schedule:', error)
      info.revert()
    }
  }, [])

  // Handle event resize (resize existing event)
  const handleEventResize = useCallback(async (info: any) => {
    const episodeId = info.event.extendedProps?.episodeId
    const start = info.event.start
    const end = info.event.end
    const libretimeScheduleId = info.event.extendedProps?.libretimeScheduleId
    const libretimeTrackId = info.event.extendedProps?.libretimeTrackId
    const libretimeInstanceId = info.event.extendedProps?.libretimeInstanceId

    if (!episodeId || !start || !end) {
      console.error('[PLANNER] Missing episodeId, start, or end time')
      info.revert()
      return
    }

    try {
      await debouncedUpdateSchedule.current(
        episodeId,
        start,
        end,
        libretimeScheduleId,
        libretimeTrackId,
        libretimeInstanceId,
      )

      // Emit RESCHEDULED event for palette sync (resize = reschedule)
      plannerBus.emitRescheduled(episodeId, start.toISOString())
    } catch (error) {
      console.error('[PLANNER] Failed to update episode schedule after resize:', error)
      info.revert()
    }
  }, [])

  // Handle event delete (right-click or delete key)
  const handleEventDelete = useCallback(async (episodeId: string, libretimeScheduleId?: number) => {
    console.log('🗑️ handleEventDelete called with:', { episodeId, libretimeScheduleId })
    try {
      // Call the debounced function directly
      debouncedDeleteSchedule.current(episodeId, libretimeScheduleId)

      // Emit UNSCHEDULED event for palette sync
      plannerBus.emitUnscheduled(episodeId)
    } catch (error) {
      console.error('[PLANNER] Failed to delete episode schedule:', error)
    }
  }, [])

  const applyEnvelopeSync = useCallback(
    async (dryRun: boolean): Promise<boolean> => {
      setSyncInFlight(true)
      try {
        const response = await fetch('/api/schedule/apply-range', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'envelope', dryRun }),
        })

        if (response.status === 403) {
          showToast('Unauthorized - admin/staff access required', 'error')
          return false
        }

        const result = await response.json()

        if (!response.ok || !result.success) {
          const message =
            result.error ||
            (Array.isArray(result.errors) ? result.errors.join('; ') : 'Unknown error')
          showToast(`Sync failed: ${message}`, 'error')
          return false
        }

        const summary: EnvelopeSummary = result.summary
        const feedStatus: string = result.feed?.status ?? 'ok'
        const prefix = dryRun ? 'Dry-run' : 'Sync'

        const parts: string[] = []
        parts.push(`+${summary.created} create`)
        parts.push(`+${summary.updated} update`)
        parts.push(`-${summary.deleted} delete`)
        if (summary.skippedMissing > 0) {
          parts.push(`${summary.skippedMissing} skipped`)
        }
        if (summary.protectedNow > 0) {
          parts.push(`${summary.protectedNow} protected`)
        }

        showToast(
          `${prefix}: ${parts.join(', ')} · feed=${feedStatus} · snapshot=${
            result.snapshotId ?? 'n/a'
          }`,
          summary.partial || feedStatus === 'partial' ? 'warning' : 'success',
        )

        setLastSyncSummary({
          summary,
          feedStatus,
          windowLabel: result.window?.weeksLabel ?? '',
          snapshotId: result.snapshotId ?? null,
        })

        if (!dryRun) {
          refetchScheduled()
        }

        return true
      } catch (error) {
        console.error('[SYNC] Apply error:', error)
        showToast(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
        return false
      } finally {
        setSyncInFlight(false)
      }
    },
    [refetchScheduled],
  )

  const handleSyncEnvelope = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (syncInFlight) return

      const dryRun = event.altKey
      setConfirmAcknowledged(false)
      setSyncInFlight(true)

      try {
        const diffResponse = await fetch('/api/schedule/diff-range', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'envelope' }),
        })

        if (diffResponse.status === 403) {
          setSyncInFlight(false)
          showToast('Unauthorized - admin/staff access required', 'error')
          return
        }

        if (!diffResponse.ok) {
          setSyncInFlight(false)
          const error = await diffResponse.json()
          showToast(`Sync failed: ${error.error || 'Unknown error'}`, 'error')
          return
        }

        const diffResult = await diffResponse.json()
        const summary: EnvelopeSummary = diffResult.summary
        const window: EnvelopeWindow = diffResult.window

        console.log('[SYNC] envelope_diff', summary, window)

        const totalChanges = summary.created + summary.updated + summary.deleted
        if (totalChanges === 0 && summary.skippedMissing === 0) {
          setSyncInFlight(false)
          showToast('No changes detected in the 3-week envelope', 'info')
          return
        }

        if (dryRun) {
          setSyncInFlight(false)
          await applyEnvelopeSync(true)
          return
        }

        if (summary.deleted > 0) {
          setSyncInFlight(false)
          setPendingSync({ summary, window })
          showToast(
            `Review required: ${summary.deleted} deletions detected (${summary.protectedNow} protected within now±60m).`,
            'warning',
          )
          return
        }

        setSyncInFlight(false)
        const success = await applyEnvelopeSync(false)
        if (success) {
          setPendingSync(null)
          setConfirmAcknowledged(false)
        }
      } catch (error) {
        console.error('[SYNC] Diff error:', error)
        showToast(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
        setSyncInFlight(false)
      }
    },
    [syncInFlight, applyEnvelopeSync],
  )

  const handleCancelSync = useCallback(() => {
    setPendingSync(null)
    setConfirmAcknowledged(false)
  }, [])

  const handleConfirmSync = useCallback(async () => {
    if (!pendingSync) return
    const success = await applyEnvelopeSync(false)
    if (success) {
      setPendingSync(null)
      setConfirmAcknowledged(false)
    }
  }, [pendingSync, applyEnvelopeSync])

  // Manual Rehydrate handler
  const handleManualRehydrate = useCallback(async () => {
    if (rehydrateInFlight) return

    setRehydrateInFlight(true)

    try {
      console.log('[REHYDRATE] Manual trigger requested')

      const response = await fetch('/api/lifecycle/preair-rehydrate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (response.status === 403) {
        showToast('Unauthorized - admin/staff access required', 'error')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        showToast(`Rehydrate failed: ${error.message || 'Unknown error'}`, 'error')
        return
      }

      const result = await response.json()
      const { found, copied, errors } = result.results

      console.log('[REHYDRATE] Complete', result.results)

      if (copied > 0) {
        showToast(
          `Rehydrate complete: ${copied} files copied, ${found - copied - errors} already ready, ${errors} errors`,
          errors > 0 ? 'warning' : 'success',
        )
      } else if (errors > 0) {
        showToast(
          `Rehydrate complete: ${errors} errors, ${found - errors} already ready`,
          'warning',
        )
      } else {
        showToast(`All ${found} scheduled episodes already have files ready`, 'success')
      }
    } catch (error) {
      console.error('[REHYDRATE] Error:', error)
      showToast(
        `Rehydrate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      )
    } finally {
      setRehydrateInFlight(false)
    }
  }, [rehydrateInFlight])

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
      <div
        style={{
          margin: '0 0 20px 0',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        <h1 style={{ margin: 0 }}>
          Episode Planner{' '}
          <span style={{ fontSize: '12px', color: '#007bff', fontWeight: 'bold' }}>
            [PlannerWithLibreTime v3B]
          </span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: libreTimeEnabled ? '#4CAF50' : '#F44336',
            }}
          />
          <span style={{ fontSize: '14px', color: '#666' }}>
            {libreTimeEnabled ? 'LibreTime Connected' : 'LibreTime Disconnected'}
          </span>
          {isLoading && <span style={{ fontSize: '14px', color: '#666' }}>Loading...</span>}
        </div>
        {/* Sync 3-Week Envelope button */}
        <button
          onClick={handleSyncEnvelope}
          disabled={syncInFlight}
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
          title="Hold Alt/Option to perform a dry-run without changes"
        >
          {syncInFlight ? 'Syncing...' : 'Sync 3-Week Envelope'}
        </button>
        <span style={{ fontSize: '12px', color: '#666' }}>Hold Alt/Option for dry-run</span>
        {lastSyncSummary && (
          <div
            style={{
              fontSize: '12px',
              color: '#333',
              backgroundColor: '#f8f9fa',
              border: '1px solid #e0e0e0',
              borderRadius: '4px',
              padding: '6px 10px',
            }}
          >
            Last sync {lastSyncSummary.windowLabel || '—'} · +{lastSyncSummary.summary.created} create, +
            {lastSyncSummary.summary.updated} update, -{lastSyncSummary.summary.deleted} delete · feed=
            {lastSyncSummary.feedStatus} · snapshot={lastSyncSummary.snapshotId ?? 'n/a'}
          </div>
        )}
        {/* Manual Rehydrate button */}
        <button
          onClick={handleManualRehydrate}
          disabled={rehydrateInFlight}
          style={{
            padding: '8px 16px',
            backgroundColor: rehydrateInFlight ? '#ccc' : '#28a745',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: rehydrateInFlight ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
          title="Manually trigger pre-air rehydrate to ensure files are ready for scheduled shows"
        >
          {rehydrateInFlight ? 'Rehydrating...' : 'Rehydrate Files'}
        </button>
      </div>

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
            <DynamicEventPalette onEpisodePlay={setPlayingEpisode} />
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
              ref={calendarRef}
              events={calendarEvents}
              onEventReceive={handleEventReceive}
              onEventDrop={handleEventDrop}
              onEventResize={handleEventResize}
              onEventDelete={handleEventDelete}
              onEpisodePlay={setPlayingEpisode}
            />
          </div>
        </div>
      )}
      {pendingSync && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: '24px',
              borderRadius: '8px',
              width: '420px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>
              Confirm Sync · {pendingSync.window.weeksLabel}
            </h3>
            <p style={{ margin: '0 0 12px 0', color: '#444' }}>
              The envelope sync will apply the following changes. Items inside now±60 minutes are
              protected automatically.
            </p>
            <ul style={{ margin: '0 0 16px 20px', padding: 0, color: '#333', fontSize: '14px' }}>
              <li>Creates: {pendingSync.summary.created}</li>
              <li>Updates: {pendingSync.summary.updated}</li>
              <li style={{ color: pendingSync.summary.deleted > 0 ? '#d9534f' : '#333' }}>
                Deletes: {pendingSync.summary.deleted}
              </li>
              <li>Skipped (missing media): {pendingSync.summary.skippedMissing}</li>
              <li>Protected near now: {pendingSync.summary.protectedNow}</li>
            </ul>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={confirmAcknowledged}
                onChange={(event) => setConfirmAcknowledged(event.target.checked)}
              />
              <span>I understand these deletions are outside now±60 minutes.</span>
            </label>
            {pendingSync.summary.missingIds.length > 0 && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: '#a94442' }}>
                Missing media for episodes: {pendingSync.summary.missingIds.join(', ')}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                marginTop: '20px',
              }}
            >
              <button
                onClick={handleCancelSync}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  background: '#fff',
                  cursor: syncInFlight ? 'not-allowed' : 'pointer',
                }}
                disabled={syncInFlight}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSync}
                disabled={!confirmAcknowledged || syncInFlight}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  background: !confirmAcknowledged || syncInFlight ? '#ccc' : '#d9534f',
                  color: '#fff',
                  cursor:
                    !confirmAcknowledged || syncInFlight ? 'not-allowed' : ('pointer' as const),
                }}
              >
                Confirm &amp; Sync
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Fixed Audio Player */}
      <FixedAudioPlayer episode={playingEpisode} onClose={() => setPlayingEpisode(null)} />
    </div>
  )
}

export default PlannerViewWithLibreTime
