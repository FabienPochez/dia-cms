'use client'

import { useState, useEffect, useRef } from 'react'
import { isLtReady } from '../types/calendar'
import { UnscheduledEpisode } from '../types/calendar'

interface UseUnscheduledEpisodesOptions {
  searchQuery?: string // Keep for future server-side filtering
  limit?: number
}

interface UseUnscheduledEpisodesReturn {
  episodes: UnscheduledEpisode[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useUnscheduledEpisodes = ({
  searchQuery = '',
  limit = 50,
}: UseUnscheduledEpisodesOptions = {}): UseUnscheduledEpisodesReturn => {
  const [episodes, setEpisodes] = useState<UnscheduledEpisode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchEpisodes = async () => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController()

    try {
      setLoading(true)
      setError(null)

      // Build query parameters for LT-ready episodes only
      const query: Record<string, any> = {
        'where[publishedStatus][equals]': 'published',
        'where[libretimeTrackId][exists]': true,
        'where[libretimeTrackId][not_equals]': '',
        'where[libretimeFilepathRelative][exists]': true,
        'where[libretimeFilepathRelative][not_equals]': '',
        limit: limit.toString(),
        depth: '2', // Include show + populated relationships (genres)
      }

      // Note: searchQuery not used in V1 (client-side filtering), kept for future

      const params = new URLSearchParams(query)

      console.log('🔍 Query URL:', `/api/episodes?${params.toString()}`)
      console.log('🔍 Query params:', query)

      // Helper function to fetch with retry on 429
      const fetchWithRetry = async (retryCount = 0): Promise<Response> => {
        const response = await fetch(`/api/episodes?${params.toString()}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: abortControllerRef.current.signal,
        })

        if (response.status === 429 && retryCount < 1) {
          const retryAfter = response.headers.get('Retry-After')
          const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000
          console.warn(`[useUnscheduledEpisodes] Rate limited (429), retrying after ${retryMs}ms`)
          await new Promise((resolve) => setTimeout(resolve, retryMs))
          return fetchWithRetry(retryCount + 1)
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch episodes: ${response.status} ${response.statusText}`)
        }

        return response
      }

      const response = await fetchWithRetry()
      const data = await response.json()

      console.log('🔍 LT-ready episodes query response:', data)
      console.log('🔍 Number of LT-ready episodes found:', data.docs?.length || 0)
      console.log('🔍 Sample episode data:', data.docs?.[0])

      // Debug: Check LT readiness and planning status
      const ltReadyEpisodes = data.docs?.filter((ep: any) => isLtReady(ep)) || []
      const plannedEpisodes = data.docs?.filter((ep: any) => ep.scheduledAt) || []
      const draftEpisodes = data.docs?.filter((ep: any) => ep.publishedStatus === 'draft') || []

      console.log('🔍 LT-ready episodes:', ltReadyEpisodes.length)
      console.log('🔍 Planned episodes:', plannedEpisodes.length)
      console.log('🔍 Draft episodes (should be 0):', draftEpisodes.length)

      // Show detailed info for first few episodes
      console.log(
        '🔍 First 3 episodes details:',
        data.docs?.slice(0, 3).map((ep: any) => ({
          id: ep.id,
          title: ep.title,
          publishedStatus: ep.publishedStatus,
          libretimeTrackId: ep.libretimeTrackId,
          libretimeFilepathRelative: ep.libretimeFilepathRelative,
          scheduledAt: ep.scheduledAt,
        })),
      )

      // Transform the data to our expected format
      const transformedEpisodes: UnscheduledEpisode[] = data.docs
        .filter((episode: any) => isLtReady(episode)) // Client-side safety check
        .filter((episode: any) => {
          // Duration slot filter: allow episodes that can fit into standard slots
          // Standard slots: 30, 60, 90, 120, 180+ minutes
          // Strategy:
          // - Episodes >= a slot can be shortened to fit → ALLOW (e.g., 70min → 60min slot)
          // - Episodes exactly 1min short can be filled easily → ALLOW (e.g., 59min → 60min slot)
          // - Episodes more than 1min short need significant filling → REJECT (e.g., 55min needs 5min filling for 60min slot)
          const actualDurationMinutes = Math.round((episode.realDuration || 0) / 60)

          // If no duration data, keep the episode (let it through)
          if (!actualDurationMinutes) return true

          // Standard slot sizes (in ascending order)
          const standardSlots = [30, 60, 90, 120, 180]

          // Check if episode can fit into any standard slot
          // An episode fits if:
          // 1. It's >= the slot (can be shortened to fit), OR
          // 2. It's exactly 1 minute short (can fill easily)
          // We check from largest to smallest to find the best fit
          for (let i = standardSlots.length - 1; i >= 0; i--) {
            const slot = standardSlots[i]
            if (actualDurationMinutes >= slot) {
              // Episode is >= slot size, can be shortened to fit → ALLOW
              return true
            } else if (actualDurationMinutes === slot - 1) {
              // Episode is exactly 1 minute short, can fill easily → ALLOW
              return true
            }
          }

          // Also check if episode is >= 180 (fits into 180+ slot, can be shortened)
          if (actualDurationMinutes >= 180) {
            return true
          }

          // Episode doesn't fit any slot - find the closest slot to explain why it's rejected
          const closestSlot = standardSlots.find((slot) => actualDurationMinutes < slot) || 180
          const gap = closestSlot - actualDurationMinutes
          console.log(
            `⏭️  Excluding episode that needs filling: "${episode.title}" (${actualDurationMinutes}min - needs ${gap}min filling for ${closestSlot}min slot)`,
          )
          return false
        })
        .map((episode: any) => ({
          episodeId: episode.id,
          title: episode.title || 'Untitled Episode',
          durationMinutes: episode.roundedDuration || Math.round((episode.duration || 0) / 60),
          scheduledAt: episode.scheduledAt,
          libretimeTrackId: episode.libretimeTrackId,
          libretimeFilepathRelative: episode.libretimeFilepathRelative,
          showLibretimeInstanceId: episode.show?.libretimeInstanceId || null,
          showTitle: episode.show?.title || 'Unknown Show',
          // Metadata for filtering
          mood: episode.mood,
          tone: episode.tone,
          energy: episode.energy,
          airCount: episode.airCount,
          lastAiredAt: episode.lastAiredAt,
          cover: episode.cover,
          genres: episode.genres, // Keep for future use
        }))

      setEpisodes(transformedEpisodes)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      console.error('Error fetching unscheduled episodes:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch episodes')
      setEpisodes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEpisodes()

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [limit]) // Removed searchQuery dependency (V1 client-side filtering)

  return {
    episodes,
    loading,
    error,
    refetch: fetchEpisodes,
  }
}
