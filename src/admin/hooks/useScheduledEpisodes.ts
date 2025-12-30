'use client'

import { useState, useEffect } from 'react'
import { ScheduledEpisode } from '../types/calendar'

interface UseScheduledEpisodesReturn {
  episodes: ScheduledEpisode[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useScheduledEpisodes = (): UseScheduledEpisodesReturn => {
  const [episodes, setEpisodes] = useState<ScheduledEpisode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEpisodes = async () => {
    try {
      setLoading(true)
      setError(null)

      // Build query parameters for scheduled episodes
      const params = new URLSearchParams({
        limit: '1000', // Fetch more episodes to display full schedule history
        where: JSON.stringify({
          publishedStatus: { equals: 'published' },
          scheduledAt: { exists: true },
          // Don't filter by airStatus yet - episodes might not have it set
        }),
        sort: '-scheduledAt', // Sort by scheduledAt descending to get most recent first
        depth: '1', // Include show data to get libretimeInstanceId
      })

      // Helper function to fetch with retry on 429
      const fetchWithRetry = async (retryCount = 0): Promise<Response> => {
        const response = await fetch(`/api/episodes?${params.toString()}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })

        if (response.status === 429 && retryCount < 1) {
          const retryAfter = response.headers.get('Retry-After')
          const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000
          console.warn(`[useScheduledEpisodes] Rate limited (429), retrying after ${retryMs}ms`)
          await new Promise((resolve) => setTimeout(resolve, retryMs))
          return fetchWithRetry(retryCount + 1)
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch scheduled episodes: ${response.status} ${response.statusText}`,
          )
        }

        return response
      }

      const response = await fetchWithRetry()

      const data = await response.json()

      console.log('🔍 Raw scheduled episodes response:', data)
      console.log('🔍 Number of scheduled episodes found:', data.docs?.length || 0)

      // Debug: Check if we can find any episodes with recent scheduledAt
      const recentEpisodes = data.docs?.filter((ep: any) => {
        const scheduledAt = new Date(ep.scheduledAt)
        const now = new Date()
        const diffHours = (now.getTime() - scheduledAt.getTime()) / (1000 * 60 * 60)
        return diffHours < 24 // Episodes scheduled in the last 24 hours
      })
      console.log('🔍 Recent episodes (last 24h):', recentEpisodes?.length || 0)

      // Transform the data to our expected format
      const transformedEpisodes: ScheduledEpisode[] = data.docs.map((episode: any) => {
        const start = new Date(episode.scheduledAt)
        const end = new Date(episode.scheduledEnd)
        const durationMinutes = episode.roundedDuration || Math.round((episode.duration || 0) / 60)

        return {
          episodeId: episode.id,
          title: episode.title || 'Untitled Episode',
          start,
          end,
          durationMinutes,
          libretimeScheduleId: episode.libretimeScheduleId,
          libretimeTrackId: episode.libretimeTrackId,
          libretimeInstanceId: episode.show?.libretimeInstanceId,
          energy: episode.energy,
          mood: episode.mood,
          tone: episode.tone,
          publishedStatus: episode.publishedStatus, // Include to identify New tab episodes
          isLive: episode.isLive === true, // Include to identify Live episodes
        }
      })

      setEpisodes(transformedEpisodes)
    } catch (err) {
      console.error('Error fetching scheduled episodes:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch scheduled episodes')
      setEpisodes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEpisodes()
  }, [])

  return {
    episodes,
    loading,
    error,
    refetch: fetchEpisodes,
  }
}
