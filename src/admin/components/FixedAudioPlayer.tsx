'use client'

import React, { useEffect, useState } from 'react'
import AudioPlayer from './AudioPlayer'
import type { Episode } from '../../../payload-types'

interface FixedAudioPlayerProps {
  episode: Episode | null
  onClose?: () => void
}

const FixedAudioPlayer: React.FC<FixedAudioPlayerProps> = ({ episode, onClose }) => {
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(episode)

  useEffect(() => {
    console.log('[FixedAudioPlayer] Episode changed:', episode?.id, episode?.title)
    setCurrentEpisode(episode)
  }, [episode])

  if (!currentEpisode) {
    console.log('[FixedAudioPlayer] No episode, not rendering')
    return null
  }

  console.log('[FixedAudioPlayer] Rendering player for episode:', currentEpisode.id)

  // Determine episode title and show name
  const episodeTitle = currentEpisode.title || 'Untitled Episode'
  const showName =
    typeof currentEpisode.show === 'object' && currentEpisode.show !== null
      ? currentEpisode.show.title || 'Unknown Show'
      : 'Unknown Show'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderTop: '1px solid #ddd',
        padding: '12px 20px',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      {/* Episode Info */}
      <div style={{ flex: '0 0 auto', minWidth: 0, maxWidth: '200px' }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#333',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={episodeTitle}
        >
          {episodeTitle}
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={showName}
        >
          {showName}
        </div>
      </div>

      {/* Player */}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <AudioPlayer
          episode={currentEpisode}
          compact={true}
          onLoad={() => {
            // Player loaded, ready to play
          }}
          onError={(error) => {
            console.error('[FixedAudioPlayer] Error:', error)
          }}
        />
      </div>

      {/* Close button */}
      {onClose && (
        <div style={{ flex: '0 0 auto' }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: 'transparent',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>
      )}
    </div>
  )
}

export default FixedAudioPlayer

