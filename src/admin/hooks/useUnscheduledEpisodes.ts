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

      const response = await fetch(`/api/episodes?${params.toString()}`, {
        method: 'GET',
        credentials: 'include', // Include cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch episodes: ${response.status} ${response.statusText}`)
      }

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
          // Duration slot filter: only allow 30, 60, 90, 120, or 180+ minute episodes
          // Excludes: 55, 75, 110, 175, etc.
          const actualDurationMinutes = Math.round((episode.realDuration || 0) / 60)
          const roundedDuration = episode.roundedDuration

          if (!roundedDuration) return true // Keep if no rounded duration set

          // Step 1: Check if roundedDuration is an allowed slot size
          const isAllowedSlot =
            roundedDuration === 30 ||
            roundedDuration === 60 ||
            roundedDuration === 90 ||
            roundedDuration === 120 ||
            roundedDuration >= 180

          if (!isAllowedSlot) {
            console.log(
              `⏭️  Excluding invalid slot size: "${episode.title}" (roundedDuration=${roundedDuration}min - only 30/60/90/120/180+ allowed)`,
            )
            return false
          }

          // Step 2: Quality check - actualDuration must be >= (roundedDuration - 1)
          // Only for 30 and 60 minute slots (longer slots can be manually cut in planner)
          let minRequired: number | null = null
          if (roundedDuration === 30) {
            minRequired = 29
          } else if (roundedDuration === 60) {
            minRequired = 59
          }
          // For 90, 120, 180+ minute slots: no quality check (can be manually adjusted)

          if (minRequired !== null && actualDurationMinutes < minRequired) {
            console.log(
              `⏭️  Excluding short episode: "${episode.title}" (${actualDurationMinutes}min < ${minRequired}min required for ${roundedDuration}min slot)`,
            )
            return false
          }

          return true
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
