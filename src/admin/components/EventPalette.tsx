'use client'

import React, { useState, useEffect, useRef, useMemo, useDeferredValue, useCallback } from 'react'
import { isLtReady } from '../types/calendar'
import { Draggable } from '@fullcalendar/interaction'
import { useUnscheduledEpisodes } from '../hooks/useUnscheduledEpisodes'
import { useEpisodeFilters } from '../hooks/useEpisodeFilters'
import { applyFilters } from '../lib/filterPredicates'
import { EpisodeFilters } from './EpisodeFilters'
import { formatRelativeTime, formatDate } from '../lib/formatRelativeTime'
import { getPlanStatus } from '../lib/planStatus'
import { plannerBus, type PlannerEventPayload } from '../lib/plannerBus'
import { TabBar } from './TabBar'
// import { useVisibilityPolling } from '../hooks/useVisibilityPolling' // Uncomment to enable polling

interface EventPaletteProps {
  onEpisodePlay?: (episode: any) => void
}

const EventPalette: React.FC<EventPaletteProps> = ({ onEpisodePlay }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const draggableRef = useRef<Draggable | null>(null)
  const episodeIdsHashRef = useRef<string>('')
  const refetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<'archive' | 'new' | 'live'>(() => {
    if (typeof window === 'undefined') return 'archive'
    const saved = localStorage.getItem('planner.palette.tab')
    return (saved as 'archive' | 'new' | 'live') || 'archive'
  })

  // Persist tab selection
  useEffect(() => {
    localStorage.setItem('planner.palette.tab', activeTab)
  }, [activeTab])

  // Fetch ALL LT-ready episodes (filter client-side) - only for archive tab
  const {
    episodes: allEpisodes,
    loading,
    error,
    refetch,
  } = useUnscheduledEpisodes({
    limit: activeTab === 'archive' ? 2000 : 0,
  })

  // Namespaced filter state
  const getFilterKey = (tab: string) => `planner.filters.v1.${tab}`
  const archiveFilters = useEpisodeFilters(getFilterKey('archive'))
  const newFilters = useEpisodeFilters(getFilterKey('new'))
  const liveFilters = useEpisodeFilters(getFilterKey('live'))

  // Use appropriate filter state based on active tab
  const filterState =
    activeTab === 'archive' ? archiveFilters : activeTab === 'new' ? newFilters : liveFilters

  const {
    filters,
    debouncedFilters,
    collapsed,
    setCollapsed,
    setSearch,
    setMoods,
    setTones,
    setEnergy,
    setDurationPreset,
    setPlayCountMin,
    setPlayCountMax,
    clearAll,
  } = filterState

  // Use deferred value for smooth typing
  const deferredFilters = useDeferredValue(debouncedFilters)

  // Apply filters with memoization
  const episodes = useMemo(() => {
    return applyFilters(allEpisodes, deferredFilters)
  }, [allEpisodes, deferredFilters])

  // Keep refetch ref fresh without causing re-subscriptions
  const refetchRef = useRef(refetch)
  useEffect(() => {
    refetchRef.current = refetch
  }, [refetch])

  // Debounced refetch after scheduling events (3 seconds)
  const scheduleRefetch = useCallback((reason: string) => {
    // Clear any pending refetch
    if (refetchTimeoutRef.current) {
      clearTimeout(refetchTimeoutRef.current)
    }

    console.info('[palette.refetch.scheduled]', { reason, willRefetchIn: '3s' })

    // Schedule new refetch
    refetchTimeoutRef.current = setTimeout(() => {
      console.info('[palette.refetch.executing]', { reason })
      refetchRef.current()
    }, 3000) // 3 seconds debounce - increase to 5000 if backend is slow
  }, []) // Empty deps - stable callback

  // Subscribe to planner bus events (only once on mount)
  useEffect(() => {
    const handleScheduled = (_payload: PlannerEventPayload) => {
      scheduleRefetch('scheduled')
    }

    const handleRescheduled = (_payload: PlannerEventPayload) => {
      scheduleRefetch('rescheduled')
    }

    const handleUnscheduled = (_payload: PlannerEventPayload) => {
      scheduleRefetch('unscheduled')
    }

    const unsubScheduled = plannerBus.on('SCHEDULED', handleScheduled)
    const unsubRescheduled = plannerBus.on('RESCHEDULED', handleRescheduled)
    const unsubUnscheduled = plannerBus.on('UNSCHEDULED', handleUnscheduled)

    return () => {
      unsubScheduled()
      unsubRescheduled()
      unsubUnscheduled()

      // Clear pending refetch
      if (refetchTimeoutRef.current) {
        clearTimeout(refetchTimeoutRef.current)
        refetchTimeoutRef.current = null
      }
    }
  }, [scheduleRefetch]) // scheduleRefetch is now stable (empty deps)

  // Keyboard shortcuts for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '3') {
        e.preventDefault()
        const tabIndex = parseInt(e.key) - 1
        const tabs: ('archive' | 'new' | 'live')[] = ['archive', 'new', 'live']
        setActiveTab(tabs[tabIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Window focus listener: refetch when user returns to tab
  useEffect(() => {
    const handleFocus = () => {
      console.info('[palette.refetch]', { reason: 'window-focus' })
      refetch()
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refetch])

  // Optional: Visibility-aware polling (60s) as safety net
  // Uncomment to enable:
  // useVisibilityPolling(() => {
  //   console.info('[palette.refetch]', { reason: 'visibility-poll' })
  //   refetch()
  // }, 60000, true) // 60 seconds

  // Initialize Draggable and handle episode list changes
  useEffect(() => {
    if (!containerRef.current) return

    // Create stable hash of episode IDs
    const currentHash = episodes.map((ep) => ep.episodeId).join(',')

    // Only reinitialize if episode IDs actually changed
    if (currentHash !== episodeIdsHashRef.current) {
      console.log('🎯 Episode list changed, re-initializing Draggable')

      // Destroy existing Draggable
      if (draggableRef.current) {
        draggableRef.current.destroy()
        draggableRef.current = null
      }

      // Create new Draggable if we have episodes
      if (episodes.length > 0) {
        draggableRef.current = new Draggable(containerRef.current, {
          itemSelector: '.fc-episode:not(.disabled)',
          eventData: (el) => {
            const durationMinutes = el.dataset.duration ? +el.dataset.duration : 60
            return {
              id: `tmp-${el.dataset.episodeId}`, // temp id to prevent conflicts
              title: el.dataset.title,
              duration: { minutes: durationMinutes },
              extendedProps: {
                episodeId: el.dataset.episodeId,
                durationMinutes: durationMinutes,
              },
            }
          },
        })
      }

      episodeIdsHashRef.current = currentHash
    }
  }, [episodes])

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (draggableRef.current) {
        console.log('🧹 Cleaning up Draggable on unmount')
        draggableRef.current.destroy()
        draggableRef.current = null
      }
    }
  }, [])

  return (
    <div
      style={{
        height: '100%',
        padding: '10px',
        borderRight: '1px solid #e0e0e0',
        backgroundColor: '#f8f9fa',
      }}
    >
      <h3
        style={{
          margin: '0 0 15px 0',
          fontSize: '16px',
          color: '#333',
          borderBottom: '1px solid #ddd',
          paddingBottom: '8px',
        }}
      >
        Episode Palette
      </h3>

      {/* Tab Bar */}
      <TabBar activeTab={activeTab} onChange={setActiveTab} />

      {/* Conditional Content */}
      {activeTab === 'archive' && (
        <>
          {/* Filters Component */}
          <EpisodeFilters
            filters={filters}
            filterControls={{
              setSearch,
              setMoods,
              setTones,
              setEnergy,
              setDurationPreset,
              setPlayCountMin,
              setPlayCountMax,
              clearAll,
            }}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
          />

          {/* Loading State */}
          {loading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                color: '#666',
              }}
            >
              Loading episodes...
            </div>
          )}

          {/* Error State */}
          {error && (
            <div
              style={{
                padding: '12px',
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '4px',
                color: '#721c24',
                fontSize: '14px',
                marginBottom: '15px',
              }}
            >
              Error: {error}
              <button
                onClick={refetch}
                style={{
                  marginLeft: '10px',
                  padding: '4px 8px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Episodes List */}
          <div
            ref={containerRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '8px',
              maxHeight: 'calc(100vh - 400px)', // Adjusted for filters
              overflowY: 'auto',
            }}
          >
            {episodes.length === 0 && !loading && !error && (
              <div
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: '#666',
                  fontSize: '14px',
                }}
              >
                {filters.search ||
                filters.moods.length > 0 ||
                filters.tones.length > 0 ||
                filters.energy ||
                filters.durationPreset ||
                filters.playCountMin !== null ||
                filters.playCountMax !== null
                  ? 'No episodes match your filters.'
                  : 'No LT-ready episodes available.'}
              </div>
            )}

            {episodes.map((episode) => {
              const isMapped = episode.showLibretimeInstanceId
              const ltReady = isLtReady(episode)
              const isDisabled = !isMapped || !ltReady
              const planStatus = getPlanStatus(episode.scheduledAt)

              // Extract cover URL (handle different formats)
              let coverUrl: string | null = null
              if (episode.cover) {
                if (typeof episode.cover === 'string') {
                  coverUrl = episode.cover
                } else if (episode.cover.url) {
                  coverUrl = episode.cover.url
                }
              }

              // Determine background color based on plan status
              let backgroundColor = '#fff'
              if (isDisabled) {
                backgroundColor = '#f8f9fa'
              } else if (planStatus === 'recent') {
                backgroundColor = '#f0f8f0' // Green for recently planned
              }
              // future, old, and none all use white background

              return (
                <div
                  key={episode.episodeId}
                  className={`fc-episode ${isDisabled ? 'disabled' : ''}`}
                  data-title={episode.title}
                  data-duration={episode.durationMinutes}
                  data-episode-id={episode.episodeId}
                  title={
                    isDisabled
                      ? `Map this episode's Show (${episode.showTitle}) to a LibreTime instance to schedule.`
                      : undefined
                  }
                  style={{
                    padding: '10px',
                    backgroundColor,
                    border: isDisabled ? '1px solid #dee2e6' : '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: isDisabled ? 'not-allowed' : 'grab',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    userSelect: 'none',
                    opacity: isDisabled ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isDisabled) {
                      e.currentTarget.style.backgroundColor = '#f0f8ff'
                      e.currentTarget.style.borderColor = '#007bff'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isDisabled) {
                      e.currentTarget.style.backgroundColor = backgroundColor
                      e.currentTarget.style.borderColor = '#ddd'
                    }
                  }}
                >
                  {/* Cover Image (lazy loaded) */}
                  {coverUrl && (
                    <div
                      style={{
                        width: '100%',
                        height: '60px',
                        marginBottom: '8px',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        backgroundColor: '#e9ecef',
                      }}
                    >
                      <img
                        src={coverUrl}
                        alt={episode.title}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    </div>
                  )}

                  {/* Title */}
                  <div
                    style={{
                      fontWeight: '500',
                      fontSize: '13px',
                      marginBottom: '3px',
                      color: isDisabled ? '#6c757d' : '#333',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {episode.title}
                  </div>

                  {/* Show Title */}
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#888',
                      marginBottom: '6px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {episode.showTitle}
                  </div>

                  {/* Duration */}
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#666',
                      marginBottom: '4px',
                    }}
                  >
                    ⏱️ {episode.durationMinutes} min
                  </div>

                  {/* Last Aired - Date + Relative */}
                  {episode.lastAiredAt && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#888',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>🕒</span>
                      <span>{formatDate(episode.lastAiredAt)}</span>
                      <span style={{ color: '#ccc' }}>•</span>
                      <span>{formatRelativeTime(episode.lastAiredAt)}</span>
                    </div>
                  )}

                  {/* Play Count */}
                  {(episode.airCount ?? 0) > 0 && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#666',
                        marginBottom: '4px',
                      }}
                    >
                      ▶ {episode.airCount} play{episode.airCount === 1 ? '' : 's'}
                    </div>
                  )}

                  {/* Play Button */}
                  {onEpisodePlay && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!episode.episodeId) return

                        try {
                          console.log('[EventPalette] Play button clicked for episode:', episode.episodeId)
                          // Fetch full episode data with depth=1 to populate media relationship
                          const response = await fetch(`/api/episodes/${episode.episodeId}?depth=1`, {
                            method: 'GET',
                            credentials: 'include',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                          })

                          if (!response.ok) {
                            throw new Error(`Failed to fetch episode: ${response.status}`)
                          }

                          const episodeData = await response.json()
                          console.log('[EventPalette] Episode data fetched:', {
                            id: episodeData.id,
                            title: episodeData.title,
                            track_id: episodeData.track_id,
                            media: episodeData.media,
                            libretimeFilepathRelative: episodeData.libretimeFilepathRelative,
                          })
                          onEpisodePlay(episodeData)
                        } catch (error) {
                          console.error('[EventPalette] Error fetching episode for playback:', error)
                        }
                      }}
                      style={{
                        marginTop: '8px',
                        padding: '6px 10px',
                        fontSize: '11px',
                        backgroundColor: '#007bff',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        width: '100%',
                      }}
                      title="Play episode"
                    >
                      ▶️ Play
                    </button>
                  )}

                  {/* Plan Status Badge */}
                  {planStatus !== 'none' && episode.scheduledAt && (
                    <div
                      style={{
                        fontSize: '10px',
                        color:
                          planStatus === 'recent'
                            ? '#28a745'
                            : planStatus === 'future'
                              ? '#0d6efd'
                              : '#6c757d',
                        backgroundColor:
                          planStatus === 'recent'
                            ? '#d4edda'
                            : planStatus === 'future'
                              ? '#e7f1ff'
                              : '#f8f9fa',
                        border: `1px solid ${
                          planStatus === 'recent'
                            ? '#c3e6cb'
                            : planStatus === 'future'
                              ? '#b3d7ff'
                              : '#dee2e6'
                        }`,
                        borderRadius: '10px',
                        padding: '2px 6px',
                        display: 'inline-block',
                        marginBottom: '4px',
                        fontWeight: '600',
                      }}
                    >
                      {planStatus === 'future' ? 'Scheduled' : 'Planned'} •{' '}
                      {formatRelativeTime(episode.scheduledAt)}
                    </div>
                  )}

                  {/* Metadata Badges (Energy, Mood, Tone) */}
                  {(episode.energy || episode.mood || episode.tone) && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px',
                        marginBottom: '6px',
                      }}
                    >
                      {episode.energy && (
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            background: '#ffeaa7',
                            color: '#6c5ce7',
                            fontWeight: '600',
                            textTransform: 'capitalize',
                          }}
                        >
                          {episode.energy}
                        </span>
                      )}
                      {episode.mood && (
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            background: '#e9ecef',
                            color: '#495057',
                            fontWeight: '600',
                            textTransform: 'capitalize',
                          }}
                        >
                          {Array.isArray(episode.mood) ? episode.mood[0] : episode.mood}
                        </span>
                      )}
                      {episode.tone && (
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            background: '#e9ecef',
                            color: '#495057',
                            fontWeight: '600',
                            textTransform: 'capitalize',
                          }}
                        >
                          {Array.isArray(episode.tone) ? episode.tone[0] : episode.tone}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Genres Tags (separate line) */}
                  {episode.genres && Array.isArray(episode.genres) && episode.genres.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '3px',
                        marginBottom: '6px',
                      }}
                    >
                      {episode.genres.map((genre: any, index: number) => {
                        const genreName = typeof genre === 'object' && genre !== null ? genre.title || genre.name : genre
                        return (
                          <span
                            key={index}
                            style={{
                              fontSize: '8px',
                              padding: '2px 5px',
                              borderRadius: '8px',
                              background: '#dbeafe',
                              color: '#1e40af',
                              fontWeight: '500',
                              textTransform: 'capitalize',
                            }}
                          >
                            {genreName}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {isDisabled && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#dc3545',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        marginTop: '4px',
                        padding: '4px 6px',
                        backgroundColor: '#f8d7da',
                        borderRadius: '3px',
                        border: '1px solid #f5c6cb',
                      }}
                    >
                      <span>⚠️</span>
                      <span>Show not mapped to LibreTime instance</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div
            style={{
              marginTop: '15px',
              padding: '8px',
              backgroundColor: '#e9ecef',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#6c757d',
              textAlign: 'center',
            }}
          >
            Drag episodes to calendar to schedule
          </div>
        </>
      )}

      {activeTab === 'new' && (
        <div
          style={{
            flex: 1,
            padding: '40px 20px',
            textAlign: 'center',
            color: '#6c757d',
            backgroundColor: '#f8f9fa',
            margin: '12px',
            borderRadius: '4px',
          }}
        >
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>
            New Episodes
          </h3>
          <p style={{ margin: '0', fontSize: '14px' }}>
            Coming soon — filter and manage newly added episodes
          </p>
        </div>
      )}

      {activeTab === 'live' && (
        <div
          style={{
            flex: 1,
            padding: '40px 20px',
            textAlign: 'center',
            color: '#6c757d',
            backgroundColor: '#f8f9fa',
            margin: '12px',
            borderRadius: '4px',
          }}
        >
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>
            Live Episodes
          </h3>
          <p style={{ margin: '0', fontSize: '14px' }}>
            Coming soon — manage currently airing content
          </p>
        </div>
      )}
    </div>
  )
}

export default EventPalette
