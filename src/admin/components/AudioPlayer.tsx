'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Episode, MediaTrack } from '../../../payload-types'

interface AudioPlayerProps {
  episode: Episode
  compact?: boolean
  onLoad?: () => void
  onError?: (error: string) => void
}

type AudioSourceType = 'soundcloud' | 'mediatrack' | 'libretime' | 'none'

/**
 * Determines the audio source priority for an episode
 * Priority: SoundCloud (track_id) → MediaTrack → LibreTime
 */
function determineAudioSource(episode: Episode): {
  type: AudioSourceType
  url?: string
  trackId?: number
} {
  // Priority 1: SoundCloud (if track_id exists)
  if (episode.track_id) {
    // Best: Use full soundcloud URL if available
    if (episode.soundcloud) {
      return { type: 'soundcloud', url: episode.soundcloud }
    }
    // Fallback 1: Use scPermalink if available
    if (episode.scPermalink) {
      const permalink = episode.scPermalink.startsWith('/')
        ? episode.scPermalink
        : `/${episode.scPermalink}`
      return { type: 'soundcloud', url: `https://soundcloud.com${permalink}` }
    }
    // Fallback 2: Construct from track_id
    return { type: 'soundcloud', url: `https://soundcloud.com/tracks/${episode.track_id}` }
  }

  // Priority 2: MediaTrack (if media relationship exists)
  if (episode.media) {
    let media: MediaTrack | null = null
    if (typeof episode.media === 'string') {
      // ID only - would need to fetch, but shouldn't happen with depth=1
      console.warn('[AudioPlayer] Media is string ID, not populated:', episode.media)
      return { type: 'none' }
    } else {
      media = episode.media as MediaTrack
    }

    if (media) {
      console.log('[AudioPlayer] MediaTrack data:', {
        id: media.id,
        url: media.url,
        filename: media.filename,
      })

      // Payload serves upload files via the url field, but it may be relative
      // If url exists, use it (making it absolute if relative)
      if (media.url) {
        let mediaUrl = media.url
        if (mediaUrl.startsWith('/')) {
          // Relative URL - make it absolute using current origin
          mediaUrl = window.location.origin + mediaUrl
        }
        console.log('[AudioPlayer] Using MediaTrack URL from media.url:', mediaUrl)
        return { type: 'mediatrack', url: mediaUrl }
      }

      // Fallback: If url is missing, try to construct from filename
      // Payload typically serves files at /media/[collection-slug]/[filename]
      if (media.filename) {
        // Use Payload's static file serving pattern
        const staticUrl = `/media/media-tracks/${media.filename}`
        const fullUrl = window.location.origin + staticUrl
        console.log('[AudioPlayer] Constructing MediaTrack URL from filename:', fullUrl)
        return { type: 'mediatrack', url: fullUrl }
      }

      console.warn('[AudioPlayer] MediaTrack has no url or filename:', media)
      return { type: 'none' }
    }
  }

  // Priority 3: LibreTime file (if libretimeFilepathRelative exists)
  if (episode.libretimeFilepathRelative) {
    const serverURL = 'https://content.diaradio.live'
    // Try LibreTime API proxy first
    if (episode.libretimeTrackId) {
      return {
        type: 'libretime',
        url: `${serverURL}/api/libretime/v2/files/${episode.libretimeTrackId}/download`,
      }
    }
    // Fallback: Direct file access (if nginx is configured)
    return {
      type: 'libretime',
      url: `${serverURL}/media/${episode.libretimeFilepathRelative}`,
    }
  }

  return { type: 'none' }
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ episode, compact = false, onLoad, onError }) => {
  const [source, setSource] = useState<{ type: AudioSourceType; url?: string }>({ type: 'none' })
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null)
  const [soundcloudWidget, setSoundcloudWidget] = useState<any>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    console.log('[AudioPlayer] useEffect triggered, episode:', episode?.id)
    const audioSource = determineAudioSource(episode)
    console.log('[AudioPlayer] Determined source:', audioSource)
    setSource(audioSource)
    setSoundcloudWidget(null) // Reset widget when episode changes

    // For MediaTrack files, fetch with credentials and create blob URL
    if (audioSource.type === 'mediatrack' && audioSource.url) {
      // Fetch the file with credentials
      let cancelled = false
      
      fetch(audioSource.url, {
        method: 'GET',
        credentials: 'include', // Include cookies/auth
        headers: {
          'Content-Type': 'application/json',
        },
      })
        .then(async (response) => {
          if (cancelled) return
          if (!response.ok) {
            throw new Error(`Failed to fetch audio file: ${response.status} ${response.statusText}`)
          }
          const blob = await response.blob()
          if (cancelled) {
            URL.revokeObjectURL(URL.createObjectURL(blob))
            return
          }
          const blobUrl = URL.createObjectURL(blob)
          console.log('[AudioPlayer] Created blob URL for MediaTrack:', blobUrl)
          setMediaBlobUrl(blobUrl)
          onLoad?.()
        })
        .catch((error) => {
          if (cancelled) return
          console.error('[AudioPlayer] Error fetching MediaTrack file:', error)
          onError?.(error.message || 'Failed to load audio file')
        })

      // Cleanup: revoke blob URL if episode changes or component unmounts
      return () => {
        cancelled = true
        setMediaBlobUrl((prevBlobUrl) => {
          if (prevBlobUrl) {
            console.log('[AudioPlayer] Cleaning up blob URL:', prevBlobUrl)
            URL.revokeObjectURL(prevBlobUrl)
          }
          return null
        })
      }
    } else {
      // Not a MediaTrack, clear any existing blob URL
      setMediaBlobUrl((prevBlobUrl) => {
        if (prevBlobUrl) {
          console.log('[AudioPlayer] Clearing blob URL (not MediaTrack):', prevBlobUrl)
          URL.revokeObjectURL(prevBlobUrl)
        }
        return null
      })
    }

    // Load SoundCloud Widget API script if needed
    if (audioSource.type === 'soundcloud') {
      // Check if script already loaded
      if (!window.SC) {
        const script = document.createElement('script')
        script.src = 'https://w.soundcloud.com/player/api.js'
        script.async = true
        script.onload = () => {
          // Widget will be initialized when iframe loads (see iframe onLoad handler)
          onLoad?.()
        }
        script.onerror = () => {
          onError?.('Failed to load SoundCloud Widget API')
        }
        document.head.appendChild(script)
      } else {
        onLoad?.()
      }
    } else if (audioSource.type !== 'mediatrack') {
      // Only call onLoad if not MediaTrack (MediaTrack calls it after blob is created)
      onLoad?.()
    }
  }, [episode, onLoad, onError])

  // Initialize SoundCloud widget when iframe loads
  useEffect(() => {
    if (source.type === 'soundcloud' && iframeRef.current && window.SC && !soundcloudWidget) {
      // Small delay to ensure iframe is fully loaded
      const timer = setTimeout(() => {
        try {
          if (iframeRef.current && window.SC) {
            const widget = window.SC.Widget(iframeRef.current)
            setSoundcloudWidget(widget)
          }
        } catch (error) {
          console.error('[AudioPlayer] Failed to initialize SoundCloud widget:', error)
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [source.type, soundcloudWidget])

  console.log('[AudioPlayer] Render - source type:', source.type, 'url:', source.url)

  if (source.type === 'none') {
    console.log('[AudioPlayer] Rendering "No audio source" message')
    return (
      <div
        style={{
          padding: compact ? '8px' : '16px',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px',
          color: '#6c757d',
          fontSize: compact ? '12px' : '14px',
          textAlign: 'center',
        }}
      >
        No audio source available
      </div>
    )
  }

  if (source.type === 'soundcloud' && source.url) {
    // SoundCloud embed
    const embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(source.url)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`
    
    return (
      <div style={{ width: '100%' }}>
        <iframe
          ref={iframeRef}
          width="100%"
          height={compact ? '166' : '400'}
          scrolling="no"
          frameBorder="no"
          allow="autoplay"
          src={embedUrl}
          style={{
            borderRadius: '4px',
          }}
        />
      </div>
    )
  }

  if ((source.type === 'mediatrack' || source.type === 'libretime') && source.url) {
    // For MediaTrack, use blob URL if available (for authenticated files), otherwise use original URL
    const audioUrl = source.type === 'mediatrack' && mediaBlobUrl ? mediaBlobUrl : source.url

    console.log('[AudioPlayer] Render check - source.type:', source.type, 'mediaBlobUrl:', mediaBlobUrl, 'audioUrl:', audioUrl)

    // Show loading state if we're fetching a MediaTrack blob
    if (source.type === 'mediatrack' && !mediaBlobUrl && source.url) {
      console.log('[AudioPlayer] Showing loading state (waiting for blob)')
      return (
        <div
          style={{
            padding: compact ? '8px' : '16px',
            backgroundColor: '#f8f9fa',
            borderRadius: '4px',
            color: '#6c757d',
            fontSize: compact ? '12px' : '14px',
            textAlign: 'center',
          }}
        >
          Loading audio...
        </div>
      )
    }

    // HTML5 audio player
    console.log('[AudioPlayer] Rendering HTML5 audio player with URL:', audioUrl)
    return (
      <div style={{ width: '100%' }}>
        <audio
          ref={audioRef}
          controls
          style={{
            width: '100%',
            height: compact ? '32px' : 'auto',
          }}
          onLoadedData={() => {
            console.log('[AudioPlayer] Audio loaded successfully')
            onLoad?.()
          }}
          onLoadStart={() => {
            console.log('[AudioPlayer] Audio load started:', audioUrl)
          }}
          onError={(e) => {
            const audioElement = e.currentTarget
            const errorCode = audioElement.error?.code
            const errorMessage = audioElement.error?.message || 'Unknown error'
            const error = `Failed to load audio file (code: ${errorCode}): ${errorMessage}`
            console.error('[AudioPlayer] Audio load error:', {
              error,
              code: errorCode,
              message: errorMessage,
              url: audioUrl,
              networkState: audioElement.networkState,
              readyState: audioElement.readyState,
            })
            onError?.(error)
          }}
          onCanPlay={() => {
            console.log('[AudioPlayer] Audio can play')
          }}
          onCanPlayThrough={() => {
            console.log('[AudioPlayer] Audio can play through')
          }}
        >
          <source src={audioUrl} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      </div>
    )
  }

  return null
}

// Declare SC widget type for TypeScript
declare global {
  interface Window {
    SC?: {
      Widget: (iframe: HTMLIFrameElement) => any
    }
  }
}

export default AudioPlayer
export type { AudioPlayerProps, AudioSourceType }

