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
        limit: '100', // Get more scheduled episodes
        where: JSON.stringify({
          publishedStatus: { equals: 'published' },
          scheduledAt: { exists: true },
          // Don't filter by airStatus yet - episodes might not have it set
        }),
        sort: '-scheduledAt', // Sort by scheduledAt descending to get most recent first
        depth: '1', // Include show data to get libretimeInstanceId
      })

      const response = await fetch(`/api/episodes?${params.toString()}`, {
        method: 'GET',
        credentials: 'include', // Include cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch scheduled episodes: ${response.status} ${response.statusText}`,
        )
      }

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
