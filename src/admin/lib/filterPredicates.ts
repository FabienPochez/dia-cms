import { FilterState } from '../hooks/useEpisodeFilters'
import { UnscheduledEpisode } from '../types/calendar'

// Normalize mood/tone to arrays
function normalizeArray(value: string | string[] | null | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// Duration preset predicate (±5 min tolerance)
function matchesDurationPreset(
  durationMinutes: number,
  preset: FilterState['durationPreset'],
): boolean {
  if (!preset) return true

  switch (preset) {
    case 'short':
      return durationMinutes < 55
    case '60':
      return durationMinutes >= 55 && durationMinutes < 65
    case '90':
      return durationMinutes >= 85 && durationMinutes < 95
    case '120':
      return durationMinutes >= 115 && durationMinutes < 125
    case '180':
      return durationMinutes >= 175 && durationMinutes < 185
    case 'long':
      return durationMinutes > 185
    default:
      return true
  }
}

export function applyFilters(
  episodes: UnscheduledEpisode[],
  filters: FilterState,
): UnscheduledEpisode[] {
  const filtered = episodes.filter((ep) => {
    // Search (title, show - OR logic)
    if (filters.search.trim()) {
      const searchLower = filters.search.toLowerCase()
      const matchTitle = ep.title?.toLowerCase().includes(searchLower)
      const matchShow = ep.showTitle?.toLowerCase().includes(searchLower)
      if (!matchTitle && !matchShow) return false
    }

    // Moods (OR within selected)
    if (filters.moods.length > 0) {
      const epMoods = normalizeArray(ep.mood)
      const hasMatch = filters.moods.some((m) => epMoods.includes(m))
      if (!hasMatch) return false
    }

    // Tones (OR within selected)
    if (filters.tones.length > 0) {
      const epTones = normalizeArray(ep.tone)
      const hasMatch = filters.tones.some((t) => epTones.includes(t))
      if (!hasMatch) return false
    }

    // Energy (exact match)
    if (filters.energy && ep.energy !== filters.energy) return false

    // Duration preset (±5 min bands)
    if (!matchesDurationPreset(ep.durationMinutes || 0, filters.durationPreset)) {
      return false
    }

    // Play Count range
    if (filters.playCountMin !== null && (ep.airCount || 0) < filters.playCountMin) return false
    if (filters.playCountMax !== null && (ep.airCount || 0) > filters.playCountMax) return false

    return true
  })

  // Optional telemetry
  console.info('planner.filters.apply', { count: filtered.length, total: episodes.length })

  return filtered
}
