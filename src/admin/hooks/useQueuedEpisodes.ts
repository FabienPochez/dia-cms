'use client'

import { useState, useEffect, useRef } from 'react'
import { isLtReady, UnscheduledEpisode } from '../types/calendar'

interface UseQueuedEpisodesOptions {
  limit?: number
}

interface UseQueuedEpisodesReturn {
  episodes: UnscheduledEpisode[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useQueuedEpisodes = ({
  limit = 2000,
}: UseQueuedEpisodesOptions = {}): UseQueuedEpisodesReturn => {
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

      // Build query parameters for queued episodes that are LT-ready
      const query: Record<string, any> = {
        'where[airStatus][equals]': 'queued',
        'where[libretimeTrackId][exists]': true,
        'where[libretimeTrackId][not_equals]': '',
        'where[libretimeFilepathRelative][exists]': true,
        'where[libretimeFilepathRelative][not_equals]': '',
        limit: limit.toString(),
        depth: '2', // Include show + populated relationships (genres)
        sort: '-publishedAt', // Most recent first
      }

      const params = new URLSearchParams(query)

      console.log('🔍 Queued episodes query URL:', `/api/episodes?${params.toString()}`)
      console.log('🔍 Queued episodes query params:', query)

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
          console.warn(`[useQueuedEpisodes] Rate limited (429), retrying after ${retryMs}ms`)
          await new Promise((resolve) => setTimeout(resolve, retryMs))
          return fetchWithRetry(retryCount + 1)
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch queued episodes: ${response.status} ${response.statusText}`)
        }

        return response
      }

      const response = await fetchWithRetry()
      const data = await response.json()

      console.log('🔍 Queued episodes query response:', data)
      console.log('🔍 Number of queued episodes found:', data.docs?.length || 0)

      // Transform the data to our expected format
      const transformedEpisodes: UnscheduledEpisode[] = data.docs
        .filter((episode: any) => isLtReady(episode)) // Client-side safety check
        .filter((episode: any) => {
          // Duration slot filter: only allow 30, 60, 90, 120, or 180+ minute episodes
          // Same logic as useUnscheduledEpisodes
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
          // Only for 30 and 60 minute slots
          let minRequired: number | null = null
          if (roundedDuration === 30) {
            minRequired = 29
          } else if (roundedDuration === 60) {
            minRequired = 59
          }

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
          genres: episode.genres,
        }))

      setEpisodes(transformedEpisodes)
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      console.error('Error fetching queued episodes:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch queued episodes')
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
  }, [limit])

  return {
    episodes,
    loading,
    error,
    refetch: fetchEpisodes,
  }
}

