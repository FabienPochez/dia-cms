export interface EpisodeLite {
  id: string
  title: string
  durationMinutes: number
  publishedStatus: 'draft' | 'published' | 'scheduled'
  hasArchiveFile: boolean
  scheduledAt?: string
  scheduledEnd?: string
  airStatus?: 'draft' | 'queued' | 'scheduled' | 'airing' | 'aired' | 'failed'
}

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  extendedProps: {
    episodeId: string
    durationMinutes: number
    libretimeScheduleId?: number
    libretimeTrackId?: string
    libretimeInstanceId?: number
    energy?: 'low' | 'medium' | 'high' | null
    mood?: string | string[] | null
    tone?: string | string[] | null
    publishedStatus?: 'draft' | 'submitted' | 'published' | 'scheduled'
  }
}

export interface UnscheduledEpisode {
  episodeId: string
  title: string
  durationMinutes: number
  scheduledAt?: string | null
  libretimeTrackId?: string | null
  libretimeFilepathRelative?: string | null
  showLibretimeInstanceId?: string | null
  showTitle?: string
  // Metadata for filtering (V1: no genres)
  mood?: string | string[] | null
  tone?: string | string[] | null
  energy?: 'low' | 'medium' | 'high' | null
  airCount?: number | null
  lastAiredAt?: string | null
  cover?: { url?: string } | string | null
  genres?: Array<string | { id: string; name: string }> | null // Future use
}

// Utility function to check if episode is LT-ready
export function isLtReady(episode: {
  libretimeTrackId?: string | null
  libretimeFilepathRelative?: string | null
}): boolean {
  return !!(episode.libretimeTrackId?.trim() && episode.libretimeFilepathRelative?.trim())
}

export interface ScheduledEpisode {
  episodeId: string
  title: string
  start: Date
  end: Date
  durationMinutes: number
  libretimeScheduleId?: number
  libretimeTrackId?: string
  libretimeInstanceId?: number
  energy?: 'low' | 'medium' | 'high' | null
  mood?: string | string[] | null
  tone?: string | string[] | null
  publishedStatus?: 'draft' | 'submitted' | 'published' | 'scheduled'
}
