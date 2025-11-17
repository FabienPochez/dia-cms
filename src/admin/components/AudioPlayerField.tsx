'use client'

import React, { useEffect, useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
import AudioPlayer from './AudioPlayer'
import type { Episode } from '../../../payload-types'

/**
 * Audio player field component for episode detail view
 * Displays audio player based on episode's audio source priority
 */
const AudioPlayerField: React.FC = () => {
  console.log('[AudioPlayerField] Component rendering')
  const { id: documentId, collectionSlug } = useDocumentInfo()
  console.log('[AudioPlayerField] Document info:', { documentId, collectionSlug })
  const [episode, setEpisode] = useState<Episode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId || collectionSlug !== 'episodes') {
      setLoading(false)
      return
    }

    // Fetch episode with depth=1 to populate relationships
    const fetchEpisode = async () => {
      try {
        setLoading(true)
        setError(null)

        console.log('[AudioPlayerField] Fetching episode:', documentId)

        const response = await fetch(`/api/episodes/${documentId}?depth=1`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch episode: ${response.status}`)
        }

        const data = await response.json()
        console.log('[AudioPlayerField] Episode data:', {
          id: data.id,
          title: data.title,
          track_id: data.track_id,
          soundcloud: data.soundcloud,
          media: data.media,
          libretimeFilepathRelative: data.libretimeFilepathRelative,
        })
        setEpisode(data)
      } catch (err) {
        console.error('[AudioPlayerField] Error fetching episode:', err)
        setError(err instanceof Error ? err.message : 'Failed to load episode')
      } finally {
        setLoading(false)
      }
    }

    fetchEpisode()
  }, [documentId, collectionSlug])

  // Don't render if not on episodes collection
  if (collectionSlug !== 'episodes') {
    console.log('[AudioPlayerField] Not episodes collection, returning null')
    return null
  }

  // Show component even on create view (but with different message)
  if (!documentId) {
    return (
      <div style={{ marginTop: '1rem', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px', fontSize: '12px', color: '#666' }}>
        Audio player will appear after episode is created
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ marginTop: '1rem', padding: '16px', textAlign: 'center', color: '#666', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        Loading audio player...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '16px', backgroundColor: '#fee', borderRadius: '4px', color: '#c33' }}>
        Error: {error}
      </div>
    )
  }

  if (!episode) {
    return null
  }

  // Check if episode has any audio source
  const hasAudioSource =
    episode.track_id || episode.media || episode.libretimeFilepathRelative

  console.log('[AudioPlayerField] Audio source check:', {
    hasAudioSource,
    track_id: episode.track_id,
    media: episode.media,
    libretimeFilepathRelative: episode.libretimeFilepathRelative,
  })

  if (!hasAudioSource) {
    return (
      <div style={{ marginTop: '1rem', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px', fontSize: '12px', color: '#666' }}>
        No audio source available (no track_id, media, or libretimeFilepathRelative)
      </div>
    )
  }

  return (
    <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
      <div
        style={{
          fontSize: '14px',
          fontWeight: '500',
          marginBottom: '12px',
          color: '#333',
        }}
      >
        Audio Player
      </div>
      <AudioPlayer episode={episode} compact={false} />
    </div>
  )
}

export default AudioPlayerField

