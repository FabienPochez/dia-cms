#!/usr/bin/env tsx
/**
 * DIA! Radio Programming Assistant
 * 
 * Fills upcoming schedule gaps by following DIA!'s human curation logic:
 * - Genre-first selection
 * - Texture-aware (played/organic vs electronic)
 * - Energy-shaped by time of day
 * 
 * Usage:
 *   tsx scripts/radio-planner.ts [--days=7] [--start="2025-01-15T00:00:00Z"]
 * 
 * Output: Structured "PLANNER PACK" report (proposals only, no DB writes)
 */

import { getPayload } from 'payload'
import config from '../src/payload.config'
import { planOne } from '../src/lib/services/scheduleOperations'

// Types
interface Episode {
  id: string
  title?: string | null
  show?: string | { id: string; title: string; genres?: Array<{ id: string; name: string }>; hosts?: Array<{ id: string }> }
  hosts?: Array<string | { id: string; name?: string }>
  genres?: Array<string | { id: string; name: string }>
  energy?: 'low' | 'medium' | 'high' | null
  duration?: number | null
  roundedDuration?: number | null
  scheduledAt?: string | null
  scheduledEnd?: string | null
  lastAiredAt?: string | null
  libretimeTrackId?: string | null
  libretimeFilepathRelative?: string | null
  publishedStatus: 'draft' | 'submitted' | 'published' | 'scheduled'
  airStatus: 'draft' | 'queued' | 'scheduled' | 'airing' | 'aired' | 'failed'
}

interface ScheduledBlock {
  start: Date
  end: Date
  episode?: Episode
  isGap: boolean
}

interface ProposedBlock {
  start: Date
  end: Date
  episode: Episode
  genres: string[]
  normalizedGenres: string[]
  texture: 'played' | 'electronic' | 'inferred'
  energy: number | 'inferred'
  daypart: keyof typeof DAYPARTS
  hardBlockChecked: boolean
  rationale: string
}

interface PlannerPack {
  summary: {
    period: { start: Date; end: Date }
    gapsFound: number
    gapsFilled: number
    overallVibe: string
  }
  proposedSchedule: ProposedBlock[]
  warnings: string[]
  assumptions: string[]
}

// Configuration
const PARIS_TZ = 'Europe/Paris'
const DAYS_TO_PLAN = parseInt(process.env.DAYS || process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '7')
const START_DATE_ARG = process.argv.find(a => a.startsWith('--start='))?.split('=')[1]
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'

// Block targets for chained gap filling (minutes, in descending order)
// Focus on 60 and 120 minute slots only
const BLOCK_TARGETS = [120, 60]

// Normalize genre strings (lowercase, trim, remove dots/slashes)
function normGenre(s: string): string {
  return s.toLowerCase().trim().replace(/[./]/g, '')
}

// Daypart definitions (Paris time) - genres normalized
const DAYPARTS = {
  wakeup: { start: 6, end: 10, energy: [1, 2], texture: 'mostly_played', genres: ['folk', 'trad', 'jazz', 'soul', 'dub', 'ambient', 'soft world'].map(normGenre) },
  warm: { start: 10, end: 14, energy: [2, 3], texture: 'alternate', genres: ['soul', 'afro', 'funk', 'disco', 'balearic', 'mellow house', 'pop'].map(normGenre) },
  groove: { start: 14, end: 19, energy: [3, 4], texture: 'balanced', genres: ['afro', 'funk', 'rock', 'house', 'breaks', 'soft electro'].map(normGenre), hardBlock: ['techno', 'ebm'].map(normGenre) },
  club: { start: 19, end: 0, energy: [4, 5], texture: 'mostly_electronic', genres: ['disco', 'house', 'techno', 'trance'].map(normGenre), maxPlayed: 1 },
  night: { start: 0, end: 6, energy: [5], texture: 'electronic_only', genres: ['techno', 'trance', 'ebm'].map(normGenre) },
}

// Genre to texture mapping (played/organic genres) - normalized
const PLAYED_GENRES = new Set([
  'folk', 'trad', 'jazz', 'soul', 'afro', 'funk', 'rock', 'world', 'acoustic',
  'blues', 'reggae', 'latin', 'bossa', 'singer-songwriter', 'indie', 'alternative'
].map(normGenre))

const ELECTRONIC_GENRES = new Set([
  'techno', 'house', 'trance', 'ebm', 'electro', 'breaks', 'dubstep', 'drum and bass',
  'ambient', 'dub', 'electronic', 'idm', 'minimal', 'progressive',
  'disco', 'dark disco', 'boogie', 'italo', 'indie dance', 'club', 'dance', 'break', 'ukg', 'garage'
].map(normGenre))

// Energy mapping
const ENERGY_MAP: Record<string, number> = {
  'low': 1,
  'medium': 3,
  'high': 5,
}

/**
 * Get Paris time from a UTC date
 */
function getParisTime(date: Date): { hour: number; date: Date } {
  const parisStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  
  const [datePart, timePart] = parisStr.split(', ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  
  const parisDate = new Date(Date.UTC(year, month - 1, day, hour, minute))
  return { hour, date: parisDate }
}

/**
 * Determine daypart for a given time
 */
function getDaypart(date: Date): keyof typeof DAYPARTS {
  const { hour } = getParisTime(date)
  
  if (hour >= 6 && hour < 10) return 'wakeup'
  if (hour >= 10 && hour < 14) return 'warm'
  if (hour >= 14 && hour < 19) return 'groove'
  if (hour >= 19) return 'club' // 19:00-23:59
  return 'night' // 00:00-05:59
}

/**
 * Infer texture from episode (played/organic vs electronic)
 */
function inferTexture(episode: Episode): 'played' | 'electronic' | 'inferred' {
  const genres = getGenreNames(episode)
  const normalizedGenres = genres.map(normGenre)
  
  // Check if any genre is clearly played/organic (exact match or substring)
  const hasPlayed = normalizedGenres.some(g => 
    Array.from(PLAYED_GENRES).some(played => g === played || g.includes(played) || played.includes(g))
  )
  
  // Check if any genre is clearly electronic (exact match or substring)
  const hasElectronic = normalizedGenres.some(g => 
    Array.from(ELECTRONIC_GENRES).some(elec => g === elec || g.includes(elec) || elec.includes(g))
  )
  
  if (hasPlayed && !hasElectronic) return 'played'
  if (hasElectronic && !hasPlayed) return 'electronic'
  if (hasPlayed && hasElectronic) return 'inferred' // Hybrid - needs human judgment
  
  // Fallback: check show type or description
  const show = typeof episode.show === 'object' ? episode.show : null
  const description = episode.title?.toLowerCase() || ''
  
  // Very basic heuristics
  if (description.includes('dj') || description.includes('mix')) return 'electronic'
  if (description.includes('live') || description.includes('session')) return 'played'
  
  return 'inferred'
}

/**
 * Get genre names from episode (handles both string IDs and populated objects)
 */
function getGenreNames(episode: Episode): string[] {
  if (!episode.genres) return []
  
  return episode.genres.map(g => {
    if (typeof g === 'string') return g
    return g.name || ''
  }).filter(Boolean)
}

/**
 * Check if episode is Archive-eligible (matches Planner "Archive" tab criteria)
 * Based on useUnscheduledEpisodes hook (lines 42-47):
 * - publishedStatus: 'published'
 * - libretimeTrackId: exists, not_equals: '', not_equals: null
 * - libretimeFilepathRelative: exists, not_equals: ''
 */
function isArchiveEligible(episode: Episode): boolean {
  // Must be published
  if (episode.publishedStatus !== 'published') return false
  
  // Must have libretimeTrackId (ready to air)
  if (!episode.libretimeTrackId || !episode.libretimeTrackId.trim()) return false
  
  // Must have libretimeFilepathRelative (file exists)
  if (!episode.libretimeFilepathRelative || !episode.libretimeFilepathRelative.trim()) return false
  
  return true
}

/**
 * Check if episode is scheduled in future or overlaps planning window
 */
function isScheduledInWindow(episode: Episode, windowStart: Date, windowEnd: Date): boolean {
  if (!episode.scheduledAt || !episode.scheduledEnd) return false
  
  const epStart = new Date(episode.scheduledAt)
  const epEnd = new Date(episode.scheduledEnd)
  
  // Check if episode overlaps the planning window
  return epStart < windowEnd && epEnd > windowStart
}

/**
 * Get energy level (1-5) from episode
 */
function getEnergy(episode: Episode): number | 'inferred' {
  if (episode.energy) {
    return ENERGY_MAP[episode.energy] || 'inferred'
  }
  return 'inferred'
}

/**
 * Check if episode matches daypart requirements
 */
function matchesDaypart(episode: Episode, daypart: keyof typeof DAYPARTS): { matches: boolean; reason: string; hardBlockChecked: boolean } {
  const daypartRules = DAYPARTS[daypart]
  const genres = getGenreNames(episode)
  const normalizedGenres = genres.map(normGenre)
  const texture = inferTexture(episode)
  const energy = getEnergy(episode)
  let hardBlockChecked = false
  
  // Check hard blocks
  if ('hardBlock' in daypartRules && daypartRules.hardBlock) {
    hardBlockChecked = true
    const hasBlocked = normalizedGenres.some(g => daypartRules.hardBlock!.includes(g))
    if (hasBlocked) {
      return { matches: false, reason: `Contains blocked genre for ${daypart} daypart`, hardBlockChecked: true }
    }
  }
  
  // Check texture requirements
  if (daypartRules.texture === 'electronic_only' && texture === 'played') {
    return { matches: false, reason: `${daypart} requires electronic-only`, hardBlockChecked }
  }
  if (daypartRules.texture === 'mostly_played' && texture === 'electronic') {
    // Allow soft electronic (ambient/dub) in wakeup - use normalized comparison
    const softElectronicGenres = ['ambient', 'dub'].map(normGenre)
    const hasSoftElectronic = normalizedGenres.some(g => softElectronicGenres.includes(g))
    if (!hasSoftElectronic) {
      return { matches: false, reason: `${daypart} prefers played/organic content`, hardBlockChecked }
    }
  }
  
  // Check energy range
  if (energy !== 'inferred') {
    const [minEnergy, maxEnergy] = daypartRules.energy
    if (energy < minEnergy || energy > maxEnergy) {
      return { matches: false, reason: `Energy ${energy} outside ${daypart} range [${minEnergy}-${maxEnergy}]`, hardBlockChecked }
    }
  }
  
  // Check genre match (prefer matching, but not strict) - use normalized comparison
  const hasMatchingGenre = normalizedGenres.some(g => 
    daypartRules.genres.some(dg => g.includes(dg) || dg.includes(g))
  )
  
  if (!hasMatchingGenre && energy === 'inferred') {
    return { matches: false, reason: `No matching genres for ${daypart} and energy unknown`, hardBlockChecked }
  }
  
  return { matches: true, reason: 'Matches daypart requirements', hardBlockChecked }
}

/**
 * Check if episode was recently played (within last 7 days)
 */
function wasRecentlyPlayed(episode: Episode, now: Date): boolean {
  if (!episode.lastAiredAt) return false
  const lastAired = new Date(episode.lastAiredAt)
  const daysSince = (now.getTime() - lastAired.getTime()) / (1000 * 60 * 60 * 24)
  return daysSince < 7
}

/**
 * Check if same show was scheduled within last 72 hours
 */
function sameShowInLast72Hours(
  episode: Episode,
  scheduledEpisodes: Episode[],
  proposedBlocks: ProposedBlock[],
  now: Date
): boolean {
  if (!episode.show) return false
  const epShowId = typeof episode.show === 'string' ? episode.show : episode.show.id
  
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000)
  
  // Check scheduled episodes
  for (const scheduled of scheduledEpisodes) {
    if (!scheduled.scheduledAt || !scheduled.show) continue
    const scheduledTime = new Date(scheduled.scheduledAt)
    if (scheduledTime < seventyTwoHoursAgo) continue
    
    const scheduledShowId = typeof scheduled.show === 'string' ? scheduled.show : scheduled.show.id
    if (scheduledShowId === epShowId) return true
  }
  
  // Check proposed blocks
  for (const block of proposedBlocks) {
    if (block.start < seventyTwoHoursAgo) continue
    const blockShowId = typeof block.episode.show === 'string' ? block.episode.show : block.episode.show?.id
    if (blockShowId === epShowId) return true
  }
  
  return false
}

/**
 * Check if episode has same host as previous episode
 */
function hasSameHost(episode: Episode, previousEpisode?: Episode): boolean {
  if (!previousEpisode || !episode.hosts || !previousEpisode.hosts) return false
  
  const epHostIds = episode.hosts.map(h => typeof h === 'string' ? h : h.id)
  const prevHostIds = previousEpisode.hosts.map(h => typeof h === 'string' ? h : h.id)
  
  return epHostIds.some(id => prevHostIds.includes(id))
}

/**
 * Check if episode is same show as previous
 */
function isSameShow(episode: Episode, previousEpisode?: Episode): boolean {
  if (!previousEpisode || !episode.show) return false
  
  const epShowId = typeof episode.show === 'string' ? episode.show : episode.show.id
  const prevShowId = typeof previousEpisode.show === 'string' ? previousEpisode.show : previousEpisode.show?.id
  
  return epShowId === prevShowId
}

/**
 * Calculate energy delta between episodes
 */
function getEnergyDelta(ep1: Episode, ep2: Episode): number {
  const e1 = getEnergy(ep1)
  const e2 = getEnergy(ep2)
  
  if (e1 === 'inferred' || e2 === 'inferred') return 0 // Unknown, assume smooth
  
  return Math.abs(e1 - e2)
}

/**
 * Find gaps in schedule
 */
function findGaps(scheduled: ScheduledBlock[], start: Date, end: Date): ScheduledBlock[] {
  const gaps: ScheduledBlock[] = []
  
  // Sort by start time
  const sorted = [...scheduled].sort((a, b) => a.start.getTime() - b.start.getTime())
  
  // Check gap before first item
  if (sorted.length > 0 && sorted[0].start > start) {
    gaps.push({
      start,
      end: sorted[0].start,
      isGap: true,
    })
  }
  
  // Check gaps between items
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    
    if (current.end < next.start) {
      gaps.push({
        start: current.end,
        end: next.start,
        isGap: true,
      })
    }
  }
  
  // Check gap after last item
  if (sorted.length > 0 && sorted[sorted.length - 1].end < end) {
    gaps.push({
      start: sorted[sorted.length - 1].end,
      end,
      isGap: true,
    })
  }
  
  // If no scheduled items, entire period is a gap
  if (sorted.length === 0) {
    gaps.push({ start, end, isGap: true })
  }
  
  return gaps.filter(gap => {
    const durationMs = gap.end.getTime() - gap.start.getTime()
    const durationMinutes = durationMs / (1000 * 60)
    return durationMinutes >= 5 // Only consider gaps >= 5 minutes
  })
}

/**
 * Count consecutive same texture in timeline
 */
function countConsecutiveTexture(
  timeline: ScheduledBlock[],
  gapIndex: number,
  texture: 'played' | 'electronic' | 'inferred'
): number {
  let count = 0
  
  // Count backwards from gap
  for (let i = gapIndex - 1; i >= 0; i--) {
    const block = timeline[i]
    if (block.isGap) break
    if (!block.episode) break
    const blockTexture = inferTexture(block.episode)
    if (blockTexture === texture || (texture === 'inferred' && blockTexture === 'inferred')) {
      count++
    } else {
      break
    }
  }
  
  // Count forwards from gap
  for (let i = gapIndex + 1; i < timeline.length; i++) {
    const block = timeline[i]
    if (block.isGap) break
    if (!block.episode) break
    const blockTexture = inferTexture(block.episode)
    if (blockTexture === texture || (texture === 'inferred' && blockTexture === 'inferred')) {
      count++
    } else {
      break
    }
  }
  
  return count
}

/**
 * Count played episodes in club window (19:00-00:00 Paris time)
 */
function countPlayedInClubWindow(
  schedule: ScheduledBlock[],
  proposed: ProposedBlock[],
  windowStart: Date,
  windowEnd: Date
): number {
  let count = 0
  
  // Check scheduled blocks
  for (const block of schedule) {
    if (block.isGap || !block.episode) continue
    const blockStart = getParisTime(block.start).date
    const blockEnd = getParisTime(block.end).date
    const hourStart = blockStart.getUTCHours()
    const hourEnd = blockEnd.getUTCHours()
    
    // Check if block overlaps club window (19:00-00:00)
    const isInClubWindow = (hourStart >= 19 || hourEnd >= 19) &&
                          block.start >= windowStart && block.end <= windowEnd
    
    if (isInClubWindow && inferTexture(block.episode) === 'played') {
      count++
    }
  }
  
  // Check proposed blocks
  for (const block of proposed) {
    const blockStart = getParisTime(block.start).date
    const hourStart = blockStart.getUTCHours()
    const isInClubWindow = hourStart >= 19 &&
                          block.start >= windowStart && block.end <= windowEnd
    
    if (isInClubWindow && block.texture === 'played') {
      count++
    }
  }
  
  return count
}

/**
 * Rejection reason tracking
 */
interface RejectionReason {
  reason: string
  count: number
}

/**
 * Select best episode for a target duration within a gap
 * Returns episode and rejection reasons for diagnostics
 */
function selectEpisodeForTarget(
  targetDurationMinutes: number,
  cursorStart: Date,
  cursorEnd: Date,
  daypart: keyof typeof DAYPARTS,
  candidates: Episode[],
  previousEpisode?: Episode,
  nextEpisode?: Episode,
  timeline?: ScheduledBlock[],
  proposed?: ProposedBlock[],
  windowStart?: Date,
  windowEnd?: Date,
  toleranceWide: boolean = false
): { episode: Episode | null; rejectionReasons: RejectionReason[] } {
  const daypartRules = DAYPARTS[daypart]
  const tolerance = toleranceWide ? 20 : 10
  const rejectionReasons: Map<string, number> = new Map()
  
  // Filter candidates
  let filtered = candidates.filter(ep => {
    // Must be Archive-eligible
    if (!isArchiveEligible(ep)) return false
    
    // Must not be scheduled in future or overlapping planning window
    if (windowStart && windowEnd && isScheduledInWindow(ep, windowStart, windowEnd)) {
      rejectionReasons.set('scheduled_in_window', (rejectionReasons.get('scheduled_in_window') || 0) + 1)
      return false
    }
    
    // Check duration fit - allow cutting episodes that are slightly over
    const epDuration = ep.roundedDuration || (ep.duration ? Math.round(ep.duration / 60) : 0)
    if (epDuration === 0) {
      rejectionReasons.set('no_duration', (rejectionReasons.get('no_duration') || 0) + 1)
      return false
    }
    
    // For 60min target: accept 60-64min (will cut to 60)
    // For 120min target: accept 120-127min (will cut to 120)
    // Also accept if episode is exactly target or slightly under
    const maxAllowed = targetDurationMinutes + (targetDurationMinutes === 60 ? 4 : 7)
    const minAllowed = targetDurationMinutes - 5 // Allow 5min under
    
    if (epDuration < minAllowed || epDuration > maxAllowed) {
      rejectionReasons.set('duration_mismatch', (rejectionReasons.get('duration_mismatch') || 0) + 1)
      return false
    }
    
    // Use target duration (cut if needed) - episodes will be cut to exact slot size
    const actualDuration = Math.min(epDuration, targetDurationMinutes)
    const epEndTime = new Date(cursorStart.getTime() + actualDuration * 60 * 1000)
    if (epEndTime > cursorEnd) {
      rejectionReasons.set('exceeds_cursor', (rejectionReasons.get('exceeds_cursor') || 0) + 1)
      return false
    }
    
    // Check daypart match
    const match = matchesDaypart(ep, daypart)
    if (!match.matches) {
      if (match.hardBlockChecked) {
        rejectionReasons.set('hard_block', (rejectionReasons.get('hard_block') || 0) + 1)
      } else {
        rejectionReasons.set('daypart_mismatch', (rejectionReasons.get('daypart_mismatch') || 0) + 1)
      }
      return false
    }
    
    // Enforce texture alternation (max 2 consecutive)
    // Consider last proposed block in chain, or previous scheduled neighbor
    const texture = inferTexture(ep)
    if (texture !== 'inferred') {
      let consecutiveCount = 0
      
      // Count from last proposed block if exists
      if (proposed && proposed.length > 0) {
        const lastProposed = proposed[proposed.length - 1]
        if (lastProposed.texture === texture) {
          consecutiveCount++
          // Check before last proposed
          if (previousEpisode) {
            const prevTexture = inferTexture(previousEpisode)
            if (prevTexture === texture) consecutiveCount++
          }
        }
      } else if (previousEpisode) {
        // No proposed blocks yet, check previous scheduled
        const prevTexture = inferTexture(previousEpisode)
        if (prevTexture === texture) consecutiveCount++
        // Check before previous if timeline available
        if (timeline) {
          // Find previous scheduled block before previousEpisode
          for (let i = timeline.length - 1; i >= 0; i--) {
            const block = timeline[i]
            if (!block.isGap && block.episode && block.episode.id === previousEpisode.id) {
              // Check block before this one
              if (i > 0) {
                const beforeBlock = timeline[i - 1]
                if (!beforeBlock.isGap && beforeBlock.episode) {
                  const beforeTexture = inferTexture(beforeBlock.episode)
                  if (beforeTexture === texture) consecutiveCount++
                }
              }
              break
            }
          }
        }
      }
      
      if (consecutiveCount >= 2) {
        rejectionReasons.set('texture_alternation', (rejectionReasons.get('texture_alternation') || 0) + 1)
        return false
      }
    }
    
    // Enforce club maxPlayed: 1
    if (daypart === 'club' && windowStart && windowEnd && proposed) {
      const texture = inferTexture(ep)
      if (texture === 'played') {
        const playedCount = countPlayedInClubWindow([], proposed, windowStart, windowEnd)
        if ('maxPlayed' in daypartRules && daypartRules.maxPlayed !== undefined) {
          if (playedCount >= daypartRules.maxPlayed) {
            rejectionReasons.set('club_max_played', (rejectionReasons.get('club_max_played') || 0) + 1)
            return false
          }
        }
      }
    }
    
    // Avoid recent repeats (7 days)
    if (wasRecentlyPlayed(ep, cursorStart)) {
      rejectionReasons.set('recent_repeat', (rejectionReasons.get('recent_repeat') || 0) + 1)
      return false
    }
    
    // Avoid same show within 72 hours (check scheduled + proposed)
    // Note: This check will be done in the main loop where we have access to scheduledEpisodes
    
    // Avoid same show/host as previous (check last proposed or previous scheduled)
    const effectivePrevious = (proposed && proposed.length > 0) ? proposed[proposed.length - 1].episode : previousEpisode
    if (effectivePrevious) {
      if (isSameShow(ep, effectivePrevious)) {
        rejectionReasons.set('same_show', (rejectionReasons.get('same_show') || 0) + 1)
        return false
      }
      if (hasSameHost(ep, effectivePrevious)) {
        rejectionReasons.set('same_host', (rejectionReasons.get('same_host') || 0) + 1)
        return false
      }
    }
    
    // Avoid same show/host as next
    if (nextEpisode) {
      if (isSameShow(ep, nextEpisode)) {
        rejectionReasons.set('same_show_next', (rejectionReasons.get('same_show_next') || 0) + 1)
        return false
      }
      if (hasSameHost(ep, nextEpisode)) {
        rejectionReasons.set('same_host_next', (rejectionReasons.get('same_host_next') || 0) + 1)
        return false
      }
    }
    
    return true
  })
  
  // Convert rejection reasons to array
  const rejectionReasonsArray: RejectionReason[] = Array.from(rejectionReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
  
  if (filtered.length === 0) {
    return { episode: null, rejectionReasons: rejectionReasonsArray }
  }
  
  // Score candidates (prioritize duration match)
  const scored = filtered.map(ep => {
    let score = 0
    const genres = getGenreNames(ep)
    const texture = inferTexture(ep)
    const energy = getEnergy(ep)
    const epDuration = ep.roundedDuration || (ep.duration ? Math.round(ep.duration / 60) : 0)
    
    // Duration fit bonus (exact match = highest score, cuttable episodes get bonus)
    if (epDuration === targetDurationMinutes) {
      score += 100 // Perfect match
    } else if (epDuration > targetDurationMinutes && epDuration <= targetDurationMinutes + (targetDurationMinutes === 60 ? 4 : 7)) {
      score += 90 // Cuttable (slightly over) - good, will be cut to exact size
    } else {
      const durationDiff = Math.abs(epDuration - targetDurationMinutes)
      score += Math.max(0, 80 - durationDiff * 5) // Slightly under, less ideal
    }
    
    // Genre match bonus (normalized comparison)
    const normalizedGenres = genres.map(normGenre)
    const genreMatches = normalizedGenres.filter(g => 
      daypartRules.genres.some(dg => g.includes(dg) || dg.includes(g))
    ).length
    score += genreMatches * 10
    
    // Energy match bonus
    if (energy !== 'inferred') {
      const [minEnergy, maxEnergy] = daypartRules.energy
      if (energy >= minEnergy && energy <= maxEnergy) {
        score += 5
      }
    }
    
    // Texture match bonus
    if (daypartRules.texture === 'mostly_played' && texture === 'played') score += 5
    if (daypartRules.texture === 'mostly_electronic' && texture === 'electronic') score += 5
    if (daypartRules.texture === 'electronic_only' && texture === 'electronic') score += 10
    if (daypartRules.texture === 'alternate') {
      // Prefer opposite of previous texture
      const effectivePrevious = (proposed && proposed.length > 0) ? proposed[proposed.length - 1].episode : previousEpisode
      if (effectivePrevious) {
        const prevTexture = inferTexture(effectivePrevious)
        if (texture !== prevTexture) score += 5
      }
    }
    
    // Energy transition smoothness
    const effectivePrevious = (proposed && proposed.length > 0) ? proposed[proposed.length - 1].episode : previousEpisode
    if (effectivePrevious) {
      const delta = getEnergyDelta(ep, effectivePrevious)
      if (delta <= 1) score += 3
    }
    if (nextEpisode) {
      const delta = getEnergyDelta(ep, nextEpisode)
      if (delta <= 1) score += 3
    }
    
    return { episode: ep, score, duration: epDuration }
  })
  
  // Sort by score (descending) and return best
  scored.sort((a, b) => b.score - a.score)
  return { episode: scored[0].episode, rejectionReasons: rejectionReasonsArray }
}

/**
 * Format time for display
 */
function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * Main planner function
 */
async function planSchedule(): Promise<PlannerPack> {
  const payload = await getPayload({ config })
  const now = new Date()
  const startDate = START_DATE_ARG ? new Date(START_DATE_ARG) : now
  const endDate = new Date(startDate.getTime() + DAYS_TO_PLAN * 24 * 60 * 60 * 1000)
  
  console.log(`\n📻 DIA! Radio Programming Assistant\n`)
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No episodes will be scheduled\n')
  } else {
    console.log('⚡ LIVE MODE - Episodes will be scheduled in LibreTime\n')
  }
  console.log(`Planning period: ${formatTime(startDate)} → ${formatTime(endDate)} (${DAYS_TO_PLAN} days)\n`)
  
  // Query scheduled episodes
  console.log('🔍 Querying scheduled episodes...')
  const scheduledResult = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        { scheduledAt: { exists: true } },
        { scheduledEnd: { exists: true } },
        { scheduledAt: { less_than: endDate.toISOString() } },
        { scheduledEnd: { greater_than: startDate.toISOString() } },
        { publishedStatus: { equals: 'published' } },
      ],
    },
    sort: 'scheduledAt',
    limit: 1000,
    depth: 2, // Include show, genres, hosts
  })
  
  const scheduledEpisodes = scheduledResult.docs as Episode[]
  console.log(`✅ Found ${scheduledEpisodes.length} scheduled episodes\n`)
  
  // Build schedule blocks
  const schedule: ScheduledBlock[] = scheduledEpisodes.map(ep => ({
    start: new Date(ep.scheduledAt!),
    end: new Date(ep.scheduledEnd!),
    episode: ep,
    isGap: false,
  }))
  
  // Find gaps
  const gaps = findGaps(schedule, startDate, endDate)
  console.log(`🔍 Found ${gaps.length} schedule gaps\n`)
  
  if (gaps.length === 0) {
    return {
      summary: {
        period: { start: startDate, end: endDate },
        gapsFound: 0,
        gapsFilled: 0,
        overallVibe: 'No gaps to fill',
      },
      proposedSchedule: [],
      warnings: [],
      assumptions: [],
    }
  }
  
  // Query available episodes (Archive-eligible: published + LT-ready + filepath)
  // Matches useUnscheduledEpisodes hook criteria (Archive tab)
  // Note: We filter out scheduled episodes in the future/overlapping window in selectEpisodeForGap
  console.log('🔍 Querying available episodes (Archive-eligible)...')
  const availableResult = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        { publishedStatus: { equals: 'published' } },
        { libretimeTrackId: { exists: true } },
        { libretimeTrackId: { not_equals: null } },
        { libretimeTrackId: { not_equals: '' } },
        { libretimeFilepathRelative: { exists: true } },
        { libretimeFilepathRelative: { not_equals: '' } },
      ],
    },
    limit: 5000,
    depth: 2, // Include show, genres, hosts
  })
  
  const availableEpisodes = availableResult.docs as Episode[]
  console.log(`✅ Found ${availableEpisodes.length} available episodes\n`)
  
  // Fill gaps
  const proposed: ProposedBlock[] = []
  const warnings: string[] = []
  const assumptions: string[] = []
  
  // Build full timeline for context (scheduled blocks + gaps, sorted)
  const timeline: ScheduledBlock[] = [...schedule, ...gaps].sort((a, b) => a.start.getTime() - b.start.getTime())
  
  for (let gapIdx = 0; gapIdx < gaps.length; gapIdx++) {
    const gap = gaps[gapIdx]
    const gapIndexInTimeline = timeline.findIndex(b => b.start.getTime() === gap.start.getTime() && b.isGap)
    
    // Find closest neighbors (not strict equality)
    let previousBlock: ScheduledBlock | undefined
    let nextBlock: ScheduledBlock | undefined
    
    // Previous: latest scheduled block with end <= gap.start
    for (let i = gapIndexInTimeline - 1; i >= 0; i--) {
      const block = timeline[i]
      if (!block.isGap && block.end.getTime() <= gap.start.getTime()) {
        previousBlock = block
        break
      }
    }
    
    // Next: earliest scheduled block with start >= gap.end
    for (let i = gapIndexInTimeline + 1; i < timeline.length; i++) {
      const block = timeline[i]
      if (!block.isGap && block.start.getTime() >= gap.end.getTime()) {
        nextBlock = block
        break
      }
    }
    
    const previousEpisode = previousBlock?.episode
    const nextEpisode = nextBlock?.episode
    
    // Fill gap with chained blocks
    let cursorStart = new Date(gap.start)
    const gapEnd = new Date(gap.end)
    const gapDaypart = getDaypart(cursorStart)
    let chainProposed: ProposedBlock[] = []
    
    while (cursorStart < gapEnd) {
      const remainingMinutes = Math.round((gapEnd.getTime() - cursorStart.getTime()) / (1000 * 60))
      
      // Stop if remaining < 60 minutes
      if (remainingMinutes < 60) break
      
      // Choose target: first value in BLOCK_TARGETS where target <= remaining
      const target = BLOCK_TARGETS.find(t => t <= remainingMinutes)
      if (!target) break
      
      // Get daypart for current cursor position (may change if crossing daypart boundaries)
      const currentDaypart = getDaypart(cursorStart)
      const daypartRules = DAYPARTS[currentDaypart]
      
      // Try to find episode (60min target accepts 60-64min, 120min accepts 120-127min)
      let result = selectEpisodeForTarget(
        target,
        cursorStart,
        gapEnd,
        currentDaypart,
        availableEpisodes,
        previousEpisode,
        nextEpisode,
        timeline,
        chainProposed,
        startDate,
        endDate,
        false // tolerance not used anymore - we use exact slot matching
      )
      
      // Filter out episodes with same show in last 72 hours
      if (result.episode) {
        // Get all scheduled episodes from timeline
        const scheduledEpisodes = timeline
          ?.filter(b => !b.isGap && b.episode)
          .map(b => b.episode!)
          || []
        
        if (sameShowInLast72Hours(result.episode, scheduledEpisodes, chainProposed, cursorStart)) {
          // Remove this episode and try again
          const filteredCandidates = availableEpisodes.filter(e => e.id !== result.episode!.id)
          const retryResult = selectEpisodeForTarget(
            target,
            cursorStart,
            gapEnd,
            currentDaypart,
            filteredCandidates,
            previousEpisode,
            nextEpisode,
            timeline,
            chainProposed,
            startDate,
            endDate,
            false
          )
          if (retryResult.episode && !sameShowInLast72Hours(retryResult.episode, scheduledEpisodes, chainProposed, cursorStart)) {
            result.episode = retryResult.episode
          } else {
            warnings.push(`Episode "${result.episode.title || 'Untitled'}" rejected: same show within 72 hours`)
            result.episode = null
          }
        }
      }
      
      if (result.episode) {
        const selected = result.episode
        const epDuration = selected.roundedDuration || (selected.duration ? Math.round(selected.duration / 60) : 0)
        
        // Cut episode to exact slot size if needed (64min → 60min, 127min → 120min)
        const actualDuration = Math.min(epDuration, target)
        const blockEnd = new Date(cursorStart.getTime() + actualDuration * 60 * 1000)
        
        // Warn if episode was cut
        if (epDuration > target) {
          warnings.push(
            `Episode cut for "${selected.title || 'Untitled'}": original ${epDuration}min → ${actualDuration}min (cut ${epDuration - actualDuration}min)`
          )
        }
        
        const genres = getGenreNames(selected)
        const normalizedGenres = genres.map(normGenre)
        const texture = inferTexture(selected)
        const energy = getEnergy(selected)
        const matchResult = matchesDaypart(selected, currentDaypart)
        
        // Check for inferred metadata
        if (texture === 'inferred') {
          assumptions.push(`Texture inferred for "${selected.title || 'Untitled'}" (genres: ${genres.join(', ') || 'none'})`)
        }
        if (energy === 'inferred') {
          assumptions.push(`Energy inferred for "${selected.title || 'Untitled'}"`)
        }
        
        const block: ProposedBlock = {
          start: new Date(cursorStart),
          end: blockEnd,
          episode: selected,
          genres,
          normalizedGenres,
          texture,
          energy,
          daypart: currentDaypart,
          hardBlockChecked: matchResult.hardBlockChecked,
          rationale: `Fits ${currentDaypart} daypart (energy ${energy}, texture ${texture}, genres: ${genres.join(', ') || 'none'})`,
        }
        
        chainProposed.push(block)
        
        // Actually schedule the episode (if not dry run)
        if (!DRY_RUN) {
          const showId = typeof selected.show === 'object' && selected.show?.id 
            ? selected.show.id 
            : typeof selected.show === 'string' 
              ? selected.show 
              : null
          
          if (!showId) {
            warnings.push(`Cannot schedule "${selected.title || 'Untitled'}": missing show ID`)
          } else {
            try {
              const result = await planOne({
                episodeId: selected.id,
                showId: showId,
                scheduledAt: cursorStart.toISOString(),
                scheduledEnd: blockEnd.toISOString(),
                dryRun: false,
              })
              
              if (!result.success) {
                warnings.push(`Failed to schedule "${selected.title || 'Untitled'}": ${result.error || result.code || 'unknown error'}`)
              } else {
                console.log(`✅ Scheduled: "${selected.title || 'Untitled'}" at ${formatTime(cursorStart)} → ${formatTime(blockEnd)}`)
              }
            } catch (error) {
              warnings.push(`Error scheduling "${selected.title || 'Untitled'}": ${error instanceof Error ? error.message : 'unknown error'}`)
            }
          }
        }
        
        // Remove from available pool to avoid duplicates
        const index = availableEpisodes.findIndex(e => e.id === selected.id)
        if (index >= 0) availableEpisodes.splice(index, 1)
        
        // Move cursor forward
        cursorStart = blockEnd
      } else {
        // No episode found for this target - print top 3 rejection reasons
        const topReasons = result.rejectionReasons.slice(0, 3)
        const reasonsStr = topReasons.map(r => `${r.reason} (${r.count})`).join(', ')
        warnings.push(
          `No suitable episode for target ${target}min at ${formatTime(cursorStart)}: ${reasonsStr || 'unknown'}`
        )
        break // Stop chaining if we can't fill a target
      }
    }
    
    // Add all chained blocks to proposed
    proposed.push(...chainProposed)
    
    // If gap not fully filled, add warning
    if (cursorStart < gapEnd) {
      const remaining = Math.round((gapEnd.getTime() - cursorStart.getTime()) / (1000 * 60))
      warnings.push(
        `Gap ${formatTime(gap.start)} → ${formatTime(gap.end)} partially filled: ${remaining}min remaining`
      )
    }
  }
  
  // Determine overall vibe
  const daypartsUsed = new Set(proposed.map(p => getDaypart(p.start)))
  const texturesUsed = proposed.map(p => p.texture)
  const playedCount = texturesUsed.filter(t => t === 'played').length
  const electronicCount = texturesUsed.filter(t => t === 'electronic').length
  
  let overallVibe = `Mixed programming across ${daypartsUsed.size} dayparts`
  if (playedCount > electronicCount * 1.5) overallVibe = 'Organic/played-leaning schedule'
  if (electronicCount > playedCount * 1.5) overallVibe = 'Electronic-leaning schedule'
  
  return {
    summary: {
      period: { start: startDate, end: endDate },
      gapsFound: gaps.length,
      gapsFilled: proposed.length,
      overallVibe,
    },
    proposedSchedule: proposed.sort((a, b) => a.start.getTime() - b.start.getTime()),
    warnings,
    assumptions,
  }
}

/**
 * Print planner pack report
 */
function printPlannerPack(pack: PlannerPack) {
  console.log('\n' + '='.repeat(80))
  console.log('📋 PLANNER PACK')
  console.log('='.repeat(80) + '\n')
  
  // A) SUMMARY
  console.log('A) SUMMARY')
  console.log('-'.repeat(80))
  console.log(`Period:        ${formatTime(pack.summary.period.start)} → ${formatTime(pack.summary.period.end)}`)
  console.log(`Gaps found:    ${pack.summary.gapsFound}`)
  console.log(`Gaps filled:   ${pack.summary.gapsFilled}`)
  console.log(`Overall vibe:  ${pack.summary.overallVibe}`)
  console.log()
  
  // B) PROPOSED SCHEDULE
  console.log('B) PROPOSED SCHEDULE (chronological)')
  console.log('-'.repeat(80))
  
  if (pack.proposedSchedule.length === 0) {
    console.log('No proposals generated.\n')
  } else {
    for (const block of pack.proposedSchedule) {
      let showTitle = 'Unknown Show'
      if (block.episode.show) {
        if (typeof block.episode.show === 'object') {
          showTitle = block.episode.show.title || 'Unknown Show'
        }
      }
      const episodeTitle = block.episode.title || showTitle
      const duration = Math.round((block.end.getTime() - block.start.getTime()) / (1000 * 60))
      
      console.log(`\n${formatTime(block.start)} → ${formatTime(block.end)} (${duration}min)`)
      console.log(`  Show:            ${episodeTitle}`)
      console.log(`  Daypart:         ${block.daypart}`)
      console.log(`  Genres:          ${block.genres.join(', ') || 'none'}`)
      console.log(`  Normalized:      ${block.normalizedGenres.join(', ') || 'none'}`)
      console.log(`  Texture:         ${block.texture}${block.texture === 'inferred' ? ' ⚠️' : ''}`)
      console.log(`  Energy:          ${block.energy}${block.energy === 'inferred' ? ' ⚠️' : ''}`)
      console.log(`  HardBlock check: ${block.hardBlockChecked}`)
      console.log(`  Rationale:       ${block.rationale}`)
    }
    console.log()
  }
  
  // C) WARNINGS / ASSUMPTIONS
  console.log('C) WARNINGS / ASSUMPTIONS')
  console.log('-'.repeat(80))
  
  if (pack.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:')
    for (const warning of pack.warnings) {
      console.log(`   - ${warning}`)
    }
  }
  
  if (pack.assumptions.length > 0) {
    console.log('\n💭 ASSUMPTIONS:')
    for (const assumption of pack.assumptions) {
      console.log(`   - ${assumption}`)
    }
  }
  
  if (pack.warnings.length === 0 && pack.assumptions.length === 0) {
    console.log('No warnings or assumptions.\n')
  } else {
    console.log()
  }
  
  console.log('='.repeat(80))
  console.log('END OF PLANNER PACK')
  console.log('='.repeat(80) + '\n')
}

// Main execution
async function main() {
  try {
    const pack = await planSchedule()
    printPlannerPack(pack)
    
    // Exit with appropriate code
    if (pack.warnings.length > pack.proposedSchedule.length) {
      process.exit(1) // More warnings than proposals
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()

