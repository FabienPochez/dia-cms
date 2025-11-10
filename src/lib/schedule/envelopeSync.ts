import crypto from 'crypto'
import type { Payload } from 'payload'

import type { Episode } from '../../payload-types'
import {
  LibreTimeClient,
  type LTInstance,
  type LTSchedule,
} from '../../integrations/libretimeClient'
import { computeSyncWindow, type SyncWindowResult } from './syncWindow'

const PARIS_TZ = 'Europe/Paris'
const PROTECT_WINDOW_MS = 60 * 60 * 1000

export interface EnvelopeSyncOptions {
  now?: Date
}

export type EnsureChangeType = 'create' | 'update'

export interface EpisodeEnsureOp {
  episodeId: string
  showId: string
  scheduledAt: string
  scheduledEnd: string
  idempotenceKey: string
  changeType: EnsureChangeType
}

export interface PlayoutRemoveOp {
  playoutId: number
  instanceId: number
  startsAt: string
  endsAt: string
  trackId: number | null
  reason: 'orphan' | 'mismatch'
}

export interface SyncPlanSummary {
  created: number
  updated: number
  deleted: number
  skippedMissing: number
  missingIds: string[]
  protectedNow: number
  protectedIds: number[]
  partial: boolean
}

export interface EnvelopeSyncPlan {
  window: SyncWindowResult & {
    nowUtc: string
    nowParis: string
  }
  ensure: EpisodeEnsureOp[]
  remove: PlayoutRemoveOp[]
  removeInstances: number[]
  summary: SyncPlanSummary
  serverHash: string
}

interface EpisodeWithShow extends Episode {
  show: Episode['show']
}

function normalizeIso(iso: string | Date | null | undefined): string | null {
  if (!iso) return null
  const value = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(value.getTime())) {
    return null
  }
  return value.toISOString()
}

function buildKey(trackId: number, startIso: string, endIso: string): string {
  return `${trackId}:${startIso}:${endIso}`
}

function computeServerHash(episodes: EpisodeWithShow[]): string {
  const canonical = episodes
    .filter((ep) => ep.scheduledAt && ep.scheduledEnd)
    .map((ep) => ({
      id: ep.id,
      scheduledAt: normalizeIso(ep.scheduledAt),
      scheduledEnd: normalizeIso(ep.scheduledEnd),
    }))
    .sort((a, b) => {
      if (!a.scheduledAt || !b.scheduledAt) {
        return (a.id || '').localeCompare(b.id || '')
      }
      const diff = a.scheduledAt.localeCompare(b.scheduledAt)
      return diff !== 0 ? diff : (a.id || '').localeCompare(b.id || '')
    })
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .substring(0, 16)
}

function resolveShowId(show: Episode['show']): string | null {
  if (!show) return null
  if (typeof show === 'string') return show
  if (typeof show === 'object' && show.id) return show.id
  return null
}

async function findCurrentShowStart(payload: Payload, nowIso: string): Promise<string | null> {
  const current = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        {
          scheduledAt: {
            less_than_equal: nowIso,
          },
        },
        {
          scheduledEnd: {
            greater_than: nowIso,
          },
        },
      ],
    },
    limit: 1,
    sort: '-scheduledAt',
    depth: 0,
  })

  if (current.docs.length === 0) {
    return null
  }

  return normalizeIso(current.docs[0].scheduledAt)
}

function getParisOffsetMinutes(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const get = (type: string): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10)

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour')
  const minute = get('minute')
  const second = get('second')

  const localMillis = Date.UTC(year, month - 1, day, hour, minute, second)
  return Math.round((localMillis - date.getTime()) / 60_000)
}

function formatParis(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: PARIS_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const dateString = formatter.format(date).replace(' ', 'T')

  const offsetMinutes = getParisOffsetMinutes(date)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const hours = Math.floor(absOffset / 60)
  const minutes = absOffset % 60

  return `${dateString}${sign}${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}`
}

function intersectsWindow(
  startIso: string,
  endIso: string,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  return start < windowEndMs && end > windowStartMs
}

export async function buildEnvelopeSyncPlan(
  payload: Payload,
  ltClient: LibreTimeClient,
  options: EnvelopeSyncOptions = {},
): Promise<EnvelopeSyncPlan> {
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const currentShowStart = await findCurrentShowStart(payload, nowIso)

  const window = computeSyncWindow({ now, currentShowStartUtc: currentShowStart })
  const windowStart = window.utcStart
  const windowEnd = window.utcEnd

  const episodesResult = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        {
          scheduledAt: {
            not_equals: null,
          },
        },
        {
          scheduledEnd: {
            not_equals: null,
          },
        },
        {
          scheduledEnd: {
            greater_than: windowStart,
          },
        },
        {
          scheduledAt: {
            less_than: windowEnd,
          },
        },
      ],
    },
    sort: 'scheduledAt',
    limit: 2000,
    depth: 1,
  })

  const episodes = episodesResult.docs as EpisodeWithShow[]
  const ltSchedules = await ltClient.getSchedule({
    starts: windowStart,
    ends: windowEnd,
    limit: 2000,
  })
  const ltInstances = await ltClient.getInstances({
    starts: windowStart,
    ends: windowEnd,
    limit: 2000,
  })

  const ltById = new Map<number, LTSchedule>()
  const ltByKey = new Map<string, LTSchedule>()
  const instancesWithPlayout = new Set<number>()

  for (const playout of ltSchedules) {
    ltById.set(playout.id, playout)
    if (playout.file) {
      const startIso = normalizeIso(playout.starts_at)
      const endIso = normalizeIso(playout.ends_at)
      if (startIso && endIso) {
        const key = buildKey(playout.file, startIso, endIso)
        if (!ltByKey.has(key)) {
          ltByKey.set(key, playout)
        }
      }
    }
    if (playout.instance) {
      instancesWithPlayout.add(playout.instance)
    }
  }

  const ensureOps = new Map<string, EpisodeEnsureOp>()
  const removeOps: PlayoutRemoveOp[] = []
  const matchedPlayoutIds = new Set<number>()
  const expectedKeys = new Map<string, string>()
  const expectedInstanceIds = new Set<number>()
  const missingEpisodeIds: string[] = []

  let created = 0
  let updated = 0

  for (const episode of episodes) {
    const startIso = normalizeIso(episode.scheduledAt)
    const endIso = normalizeIso(episode.scheduledEnd)
    if (!startIso || !endIso) {
      continue
    }

    const showId = resolveShowId(episode.show)
    if (!showId) {
      continue
    }

    const idempotenceKey = `${episode.id}#${startIso}`
    const trackIdRaw = episode.libretimeTrackId?.toString().trim() ?? ''
    const filepath = episode.libretimeFilepathRelative?.toString().trim() ?? ''

    const trackId = Number(trackIdRaw)
    if (!trackIdRaw || Number.isNaN(trackId) || trackId <= 0 || !filepath) {
      missingEpisodeIds.push(episode.id)
      continue
    }

    const instanceIdRaw = episode.libretimeInstanceId
    if (instanceIdRaw !== null && instanceIdRaw !== undefined) {
      const instanceId = Number(instanceIdRaw)
      if (!Number.isNaN(instanceId) && instanceId > 0) {
        expectedInstanceIds.add(instanceId)
      }
    }

    const key = buildKey(trackId, startIso, endIso)
    expectedKeys.set(key, episode.id)

    const playoutId = episode.libretimePlayoutId ? Number(episode.libretimePlayoutId) : null
    let existingPlayout = playoutId ? ltById.get(playoutId) : undefined

    if (!existingPlayout) {
      const candidate = ltByKey.get(key)
      if (candidate) {
        existingPlayout = candidate
      }
    }

    if (
      existingPlayout &&
      normalizeIso(existingPlayout.starts_at) === startIso &&
      normalizeIso(existingPlayout.ends_at) === endIso
    ) {
      matchedPlayoutIds.add(existingPlayout.id)
      if (existingPlayout.instance) {
        expectedInstanceIds.add(existingPlayout.instance)
      }
      continue
    }

    const changeType: EnsureChangeType = existingPlayout ? 'update' : 'create'
    if (changeType === 'update' && existingPlayout) {
      matchedPlayoutIds.add(existingPlayout.id)
      if (existingPlayout.instance) {
        expectedInstanceIds.add(existingPlayout.instance)
      }
    }

    ensureOps.set(idempotenceKey, {
      episodeId: episode.id,
      showId,
      scheduledAt: startIso,
      scheduledEnd: endIso,
      idempotenceKey,
      changeType,
    })

    if (changeType === 'create') {
      created += 1
    } else {
      updated += 1
    }
  }

  const protectStart = now.getTime() - PROTECT_WINDOW_MS
  const protectEnd = now.getTime() + PROTECT_WINDOW_MS
  let protectedNow = 0
  const protectedIds: number[] = []

  for (const playout of ltSchedules) {
    if (!playout.file) {
      continue
    }

    const startIso = normalizeIso(playout.starts_at)
    const endIso = normalizeIso(playout.ends_at)
    if (!startIso || !endIso) continue

    const key = buildKey(playout.file, startIso, endIso)

    if (expectedKeys.has(key) || matchedPlayoutIds.has(playout.id)) {
      continue
    }

    if (intersectsWindow(startIso, endIso, protectStart, protectEnd)) {
      protectedNow += 1
      protectedIds.push(playout.id)
      continue
    }

    removeOps.push({
      playoutId: playout.id,
      instanceId: playout.instance,
      startsAt: startIso,
      endsAt: endIso,
      trackId: playout.file ?? null,
      reason: 'orphan',
    })
  }

  removeOps.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const ensureList = Array.from(ensureOps.values()).sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  )

  const orphanInstanceIds: number[] = []
  for (const instance of ltInstances as LTInstance[]) {
    const startIso = normalizeIso(instance.starts_at)
    const endIso = normalizeIso(instance.ends_at)
    if (!startIso || !endIso) {
      continue
    }

    if (expectedInstanceIds.has(instance.id)) {
      continue
    }

    if (instancesWithPlayout.has(instance.id)) {
      continue
    }

    if (intersectsWindow(startIso, endIso, protectStart, protectEnd)) {
      continue
    }

    orphanInstanceIds.push(instance.id)
  }

  const summary: SyncPlanSummary = {
    created,
    updated,
    deleted: removeOps.length + orphanInstanceIds.length,
    skippedMissing: missingEpisodeIds.length,
    missingIds: missingEpisodeIds.slice(0, 10),
    protectedNow,
    protectedIds,
    partial: missingEpisodeIds.length > 0,
  }

  return {
    window: {
      ...window,
      nowUtc: nowIso,
      nowParis: formatParis(nowIso),
    },
    ensure: ensureList,
    remove: removeOps,
    removeInstances: orphanInstanceIds,
    summary,
    serverHash: computeServerHash(episodes),
  }
}
