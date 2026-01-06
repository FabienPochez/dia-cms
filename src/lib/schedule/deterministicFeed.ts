import { getPayload } from 'payload'
import fs from 'fs/promises'
import { createReadStream, Stats } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { diagExecFile } from '@/server/lib/subprocessDiag'

import config from '@/payload.config'
import type { Episode, MediaTrack, Show } from '@/payload-types'

const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
const MIN_LOOKAHEAD_MINUTES = 20
const DEFAULT_LOOKAHEAD_MINUTES = 360
const MAX_LOOKAHEAD_MINUTES = 720
const DEFAULT_MAX_ITEMS = 48
const METADATA_CACHE_LIMIT = 128
const VERSION_HISTORY_LIMIT = 5

function parseEnvInt(name: string, defaultValue: number, min?: number, max?: number): number {
  const raw = process.env[name]
  if (!raw) return defaultValue
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) return defaultValue
  if (typeof min === 'number' && parsed < min) return min
  if (typeof max === 'number' && parsed > max) return max
  return parsed
}

function parseEnvBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return defaultValue
  return /^(1|true|yes)$/i.test(raw.trim())
}

const MTIME_GRACE_SEC = parseEnvInt('MTIME_GRACE_SEC', 10, 0, 600)
const FEED_STRICT = parseEnvBool('FEED_STRICT', false)
const FEED_FALLBACK_ON_ERROR = parseEnvBool('FEED_FALLBACK_ON_ERROR', true)
const FEED_RATE_LIMIT_RPM = parseEnvInt('FEED_RATE_LIMIT_RPM', 120, 1, 10_000)
const FEED_CB_THRESHOLD = parseEnvInt('FEED_CB_THRESHOLD', 5, 1, 1_000)

export interface DeterministicFeedItem {
  id: string
  row_id: number
  start_utc: string
  end_utc: string
  duration_sec: number
  uri: string
  filesize_bytes: number
  last_modified_utc: string
  checksum: string
  codec: string
  sample_rate: number
  mime: string
  replay_gain: number | null
  fade_in_ms: number
  fade_out_ms: number
  cue_in_sec: number
  cue_out_sec: number
  track_title: string | null
  artist_name: string | null
  show_name: string
  show_slug: string | null
  libretime_track_id: string | null
  priority: number
}

export type FeedStatus = 'ok' | 'partial' | 'error'

export interface DeterministicFeedResponse {
  scheduleVersion: number
  generatedAt_utc: string
  validFrom_utc: string
  validTo_utc: string
  lookahead_min: number
  items: DeterministicFeedItem[]
  feed_status: FeedStatus
  missing_count: number
  total_count: number
  last_ok_version: number | null
  missing_ids: string[]
}

export interface BuildDeterministicFeedResult {
  feed: DeterministicFeedResponse
  etag: string
  feedStatus: FeedStatus
  missingCount: number
  totalCount: number
  missingIds: string[]
  fallbackApplied: boolean
}

interface BuildOptions {
  lookaheadMinutes?: number
  maxItems?: number
}

interface CachedTechMetadata {
  checksum: string
  codec: string
  sampleRate: number
  formatName: string | null
  duration: number // Track file duration in seconds
}

interface CachedMetadataEntry extends CachedTechMetadata {
  key: string
  createdAt: number
}

interface FeedCacheEntry {
  scheduleVersion: number
  etag: string
  dataHash: string
  feed: DeterministicFeedResponse
  createdAt: number
  feedStatus: FeedStatus
  missingCount: number
  totalCount: number
  missingIds: string[]
  fallbackApplied: boolean
}

interface RawFeedComputation {
  items: DeterministicFeedItem[]
  earliestStartMs: number
  latestEndMs: number
  missingIds: string[]
  missingCount: number
  totalCount: number
}

const metadataCache = new Map<string, CachedMetadataEntry>()
const versionHistory: FeedCacheEntry[] = []
let lastVersion = 0
let lastOkEntry: FeedCacheEntry | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function ensureDirectorySafety(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath)
  if (normalized.startsWith('..')) {
    throw new Error(`Invalid relative path (traversal): ${relativePath}`)
  }
  return path.join(LIBRETIME_LIBRARY_ROOT, normalized)
}

function toNaiveUtc(date: Date): string {
  return date.toISOString().slice(0, 19)
}

function computeDurationSeconds(start: Date, end: Date): number {
  const diffMs = Math.max(0, end.getTime() - start.getTime())
  return Math.round(diffMs / 1000)
}

async function computeChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = createReadStream(filePath)

    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

interface FfprobeResult {
  codec: string
  sampleRate: number
  formatName: string | null
  duration: number // Track file duration in seconds
}

async function getAudioTechMetadata(filePath: string): Promise<FfprobeResult> {
  try {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]
    console.log(
      `[SUBPROC] deterministicFeed.getAudioTechMetadata execFile: ffprobe args=`,
      JSON.stringify(args),
    )
    const { stdout } = await diagExecFile('ffprobe', args, undefined, 'deterministicFeed.ffprobe')
    const data = JSON.parse(stdout)
    const audioStream = data.streams?.find((stream: any) => stream.codec_type === 'audio')

    if (!audioStream) {
      throw new Error('No audio stream found')
    }

    const codec: string = audioStream.codec_name || audioStream.codec_long_name || 'unknown'
    const sampleRateRaw = audioStream.sample_rate
    const sampleRate = sampleRateRaw ? Number.parseInt(sampleRateRaw, 10) : 0
    const formatName = typeof data.format?.format_name === 'string' ? data.format.format_name : null
    const durationRaw = data.format?.duration
    const duration = durationRaw ? Math.round(parseFloat(String(durationRaw))) : 0

    return {
      codec,
      sampleRate: Number.isFinite(sampleRate) ? sampleRate : 0,
      formatName,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    }
  } catch (error) {
    console.error('[DETERMINISTIC_FEED] ffprobe failed:', error)
    throw new Error('Failed to extract audio metadata')
  }
}

async function getTechMetadata(filePath: string, stats: Stats): Promise<CachedTechMetadata> {
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`
  const cached = metadataCache.get(cacheKey)
  if (cached) {
    return {
      checksum: cached.checksum,
      codec: cached.codec,
      sampleRate: cached.sampleRate,
      formatName: cached.formatName,
      duration: cached.duration,
    }
  }

  const [checksum, ffprobe] = await Promise.all([
    computeChecksum(filePath),
    getAudioTechMetadata(filePath),
  ])

  const entry: CachedMetadataEntry = {
    key: cacheKey,
    checksum,
    codec: ffprobe.codec,
    sampleRate: ffprobe.sampleRate,
    formatName: ffprobe.formatName,
    duration: ffprobe.duration,
    createdAt: Date.now(),
  }

  metadataCache.set(cacheKey, entry)

  if (metadataCache.size > METADATA_CACHE_LIMIT) {
    // Remove oldest entry
    const oldest = Array.from(metadataCache.values()).reduce((prev, curr) =>
      curr.createdAt < prev.createdAt ? curr : prev,
    )
    metadataCache.delete(oldest.key)
  }

  return {
    checksum,
    codec: ffprobe.codec,
    sampleRate: ffprobe.sampleRate,
    formatName: ffprobe.formatName,
    duration: ffprobe.duration,
  }
}

function ensureNaiveUtcString(value: string, field: string): string {
  if (/Z$/i.test(value) || /[+-]\d{2}:?\d{2}$/.test(value)) {
    throw new Error(`${field} must be naive UTC (no timezone) but received '${value}'`)
  }
  return value
}

function resolveShow(episode: Episode): Show | null {
  if (!episode.show) return null
  return typeof episode.show === 'object' ? (episode.show as Show) : null
}

function resolveMediaTrack(episode: Episode): MediaTrack | null {
  if (!episode.media) return null
  if (typeof episode.media === 'object') {
    return episode.media as MediaTrack
  }
  return null
}

function determineMime(codec: string, formatName: string | null, fallback?: string | null): string {
  const normalized = codec.toLowerCase()
  const format = formatName ? formatName.split(',')[0].toLowerCase() : ''
  const lookup = normalized || format
  if (lookup.includes('mp3') || lookup === 'mpeg') return 'audio/mpeg'
  if (lookup.includes('aac')) return 'audio/aac'
  if (lookup.includes('flac')) return 'audio/flac'
  if (lookup.includes('ogg') || lookup.includes('vorbis')) return 'audio/ogg'
  if (lookup.includes('opus')) return 'audio/ogg'
  if (lookup.includes('wav') || lookup.includes('pcm')) return 'audio/wav'
  if (lookup.includes('aiff')) return 'audio/aiff'
  if (fallback) return fallback
  return 'audio/mpeg'
}

const STAT_RETRY_DELAYS_MS = [200, 400, 800]

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function statWithRetry(filePath: string): Promise<Stats | null> {
  for (let attempt = 0; attempt < STAT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fs.stat(filePath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        throw err
      }
      if (attempt === STAT_RETRY_DELAYS_MS.length - 1) {
        return null
      }
      const baseDelay = STAT_RETRY_DELAYS_MS[attempt]
      const jitter = Math.floor(Math.random() * 50)
      await sleep(baseDelay + jitter)
    }
  }
  return null
}

async function buildFeedItems(
  episodes: Episode[],
  maxItems: number,
  nowMs: number,
  mtimeGraceMs: number,
): Promise<RawFeedComputation> {
  const items: {
    item: DeterministicFeedItem
    startMs: number
    endMs: number
  }[] = []
  const missingIds: string[] = []
  let missingCount = 0
  let totalCount = 0

  for (const episode of episodes) {
    const episodeId = String(episode.id)

    if (!episode.scheduledAt || !episode.scheduledEnd) {
      console.warn('[DETERMINISTIC_FEED] Skipping episode without schedule:', episodeId)
      continue
    }

    const start = new Date(episode.scheduledAt)
    const end = new Date(episode.scheduledEnd)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      console.warn('[DETERMINISTIC_FEED] Skipping episode with invalid dates:', episodeId)
      continue
    }

    if (end.getTime() <= start.getTime()) {
      console.warn('[DETERMINISTIC_FEED] Skipping episode with non-positive duration:', episodeId)
      continue
    }

    const relativePath = episode.libretimeFilepathRelative
    if (!relativePath) {
      console.warn(
        '[DETERMINISTIC_FEED] Skipping episode without libretimeFilepathRelative:',
        episodeId,
      )
      continue
    }

    // SECURITY MONITORING: Log episode being processed with filepath
    console.log(`[DETERMINISTIC_FEED] Processing episode ${episodeId} filepath="${relativePath}"`)

    const absolutePath = ensureDirectorySafety(relativePath)
    totalCount += 1

    let stats: Stats
    try {
      const result = await statWithRetry(absolutePath)
      if (!result) {
        console.warn(
          `[DETERMINISTIC_FEED] missing episode ${episodeId} filepath="${relativePath}" (ENOENT)`,
        )
        missingIds.push(episodeId)
        missingCount += 1
        if (FEED_STRICT) {
          throw new Error(`File missing for episode ${episodeId}`)
        }
        continue
      }
      stats = result
    } catch (error) {
      console.error(
        `[DETERMINISTIC_FEED] stat failed for episode ${episodeId} filepath="${relativePath}":`,
        error,
      )
      throw error
    }

    if (nowMs - stats.mtimeMs < mtimeGraceMs) {
      console.warn('[DETERMINISTIC_FEED] skipping due to mtime grace window:', episode.id)
      missingIds.push(String(episode.id))
      missingCount += 1
      if (FEED_STRICT) {
        throw new Error(`File within grace window for episode ${episode.id}`)
      }
      continue
    }

    if (stats.size === 0) {
      console.warn('[DETERMINISTIC_FEED] skipping empty file for episode:', episode.id)
      missingIds.push(String(episode.id))
      missingCount += 1
      if (FEED_STRICT) {
        throw new Error(`File is empty for episode ${episode.id}`)
      }
      continue
    }

    // SECURITY MONITORING: Log before calling ffprobe
    console.log(
      `[DETERMINISTIC_FEED] Calling getTechMetadata for episode ${episodeId} filepath="${relativePath}" absolute="${absolutePath}"`,
    )

    const tech = await getTechMetadata(absolutePath, stats)

    console.log(`[DETERMINISTIC_FEED] getTechMetadata completed for episode ${episodeId}`)

    const show = resolveShow(episode)
    const showSlug = show?.slug || null
    const showName = show?.title || 'Unknown Show'
    const trackTitle = episode.title || show?.title || null
    const mediaTrack = resolveMediaTrack(episode)
    const fallbackMime = mediaTrack?.mimeType || null
    const mime = determineMime(tech.codec, tech.formatName, fallbackMime)

    const trackIdRaw = episode.libretimeTrackId
    const trackId = trackIdRaw ? Number.parseInt(String(trackIdRaw), 10) : NaN
    if (!Number.isFinite(trackId)) {
      console.warn(
        '[DETERMINISTIC_FEED] Skipping episode without numeric libretimeTrackId:',
        episode.id,
      )
      continue
    }

    const playoutIdRaw = episode.libretimePlayoutId
    const rowId = playoutIdRaw ? Number.parseInt(String(playoutIdRaw), 10) : 0

    const durationSec = computeDurationSeconds(start, end)
    if (durationSec <= 0) {
      console.warn(
        '[DETERMINISTIC_FEED] Skipping episode with zero/negative duration after normalization:',
        episode.id,
      )
      continue
    }

    // Calculate cue_in_sec for shows that have already started (late starts)
    // to keep the schedule on track. This will be adjusted after sorting to
    // only apply to the first item (currently playing show).
    // For now, set to 0 - we'll calculate it after sorting.
    const cueInSec = 0

    // Calculate cue_out_sec: use minimum of track file duration and scheduled duration
    // This ensures hard-timed boundaries - tracks are cut at scheduled end time
    // even if the file is longer than the scheduled slot
    const trackFileDurationSec = tech.duration > 0 ? tech.duration : durationSec
    const cueOutSec = Math.min(trackFileDurationSec, durationSec)

    const item: DeterministicFeedItem = {
      id: String(trackId),
      row_id: rowId,
      start_utc: ensureNaiveUtcString(toNaiveUtc(start), 'start_utc'),
      end_utc: ensureNaiveUtcString(toNaiveUtc(end), 'end_utc'),
      duration_sec: durationSec,
      uri: relativePath,
      filesize_bytes: stats.size,
      last_modified_utc: toNaiveUtc(new Date(stats.mtimeMs)),
      checksum: tech.checksum,
      codec: tech.codec,
      sample_rate: tech.sampleRate,
      mime,
      replay_gain: 0,
      fade_in_ms: 1000,
      fade_out_ms: 1000,
      cue_in_sec: cueInSec,
      cue_out_sec: cueOutSec,
      track_title: trackTitle,
      artist_name: show?.subtitle || null,
      show_name: showName,
      show_slug: showSlug,
      libretime_track_id: episode.libretimeTrackId ? String(episode.libretimeTrackId) : null,
      priority: typeof (episode as any).priority === 'number' ? (episode as any).priority : 0,
    }

    items.push({
      item,
      startMs: start.getTime(),
      endMs: end.getTime(),
    })
  }

  items.sort((a, b) => a.startMs - b.startMs)

  const limited = items.slice(0, maxItems)

  // Calculate cue_in_sec for the first item only (currently playing or next show)
  // if it has already started. This keeps the schedule on track for late starts
  // without restarting shows that are already playing correctly.
  if (limited.length > 0) {
    const firstItem = limited[0]
    const firstStartMs = firstItem.startMs
    const firstEndMs = firstItem.endMs
    if (firstStartMs < nowMs && nowMs < firstEndMs) {
      // First show has already started - calculate elapsed time for cue_in
      const elapsedSec = Math.floor((nowMs - firstStartMs) / 1000)
      firstItem.item.cue_in_sec = Math.max(0, elapsedSec)
    }
  }

  const earliestStartMs = limited.length ? limited[0].startMs : Number.POSITIVE_INFINITY
  const latestEndMs = limited.length ? limited[limited.length - 1].endMs : Number.NEGATIVE_INFINITY

  return {
    items: limited.map((entry) => entry.item),
    earliestStartMs,
    latestEndMs,
    missingIds,
    missingCount,
    totalCount,
  }
}

async function computeFeedFromEpisodes(
  episodes: Episode[],
  now: Date,
  lookaheadMinutes: number,
  maxItems: number,
): Promise<BuildDeterministicFeedResult> {
  const nowMs = now.getTime()
  const mtimeGraceMs = MTIME_GRACE_SEC * 1000

  const { items, earliestStartMs, latestEndMs, missingIds, missingCount, totalCount } =
    await buildFeedItems(episodes, maxItems, nowMs, mtimeGraceMs)

  const effectiveEarliestMs = Number.isFinite(earliestStartMs) ? earliestStartMs : nowMs
  const effectiveLatestMs = Number.isFinite(latestEndMs) ? latestEndMs : nowMs

  const validFromDate = new Date(effectiveEarliestMs)
  const validToDate = new Date(Math.max(effectiveEarliestMs, effectiveLatestMs))
  const lookaheadCoverageMin = Math.max(0, Math.round((validToDate.getTime() - nowMs) / 60_000))

  const canonicalPayload = {
    validFrom_utc: toNaiveUtc(validFromDate),
    validTo_utc: toNaiveUtc(validToDate),
    lookahead_min: lookaheadCoverageMin,
    items,
  }

  const dataHash = computeDataHash(canonicalPayload)
  const latest = versionHistory.at(-1)

  if (latest && latest.dataHash === dataHash) {
    return {
      feed: latest.feed,
      etag: latest.etag,
      feedStatus: latest.feedStatus,
      missingCount: latest.missingCount,
      totalCount: latest.totalCount,
      missingIds: latest.missingIds,
      fallbackApplied: latest.fallbackApplied,
    }
  }

  const feedStatus: FeedStatus = missingCount > 0 ? 'partial' : 'ok'
  const scheduleVersion = getNextVersion()
  const generatedAt = toNaiveUtc(now)
  const lastOkVersionValue =
    feedStatus === 'ok' ? scheduleVersion : (lastOkEntry?.scheduleVersion ?? null)

  const feed: DeterministicFeedResponse = {
    scheduleVersion,
    generatedAt_utc: generatedAt,
    validFrom_utc: canonicalPayload.validFrom_utc,
    validTo_utc: canonicalPayload.validTo_utc,
    lookahead_min: canonicalPayload.lookahead_min,
    items: canonicalPayload.items,
    feed_status: feedStatus,
    missing_count: missingCount,
    total_count: totalCount,
    last_ok_version: lastOkVersionValue,
    missing_ids: missingIds,
  }

  const etagSource = `${scheduleVersion}:${dataHash}`
  const etag = crypto.createHash('sha1').update(etagSource).digest('hex')

  const entry: FeedCacheEntry = {
    scheduleVersion,
    etag,
    dataHash,
    feed,
    createdAt: Date.now(),
    feedStatus,
    missingCount,
    totalCount,
    missingIds,
    fallbackApplied: false,
  }
  recordHistory(entry)

  if (feedStatus === 'ok') {
    lastOkEntry = entry
  }

  console.info(
    '[DETERMINISTIC_FEED] build',
    `status=${feedStatus}`,
    `version=${scheduleVersion}`,
    `items=${feed.items.length}/${totalCount}`,
    `missing=${missingCount}`,
    `lookahead=${canonicalPayload.lookahead_min}m`,
  )

  return {
    feed,
    etag,
    feedStatus,
    missingCount,
    totalCount,
    missingIds,
    fallbackApplied: false,
  }
}

export const __test__ = {
  buildFeedItemsForEpisodes: (
    episodes: Episode[],
    maxItems: number,
    nowMs: number,
    mtimeGraceMs: number,
  ) => buildFeedItems(episodes, maxItems, nowMs, mtimeGraceMs),
  buildDeterministicFeedFromEpisodes: async (
    episodes: Episode[],
    options: {
      now?: Date
      lookaheadMinutes?: number
      maxItems?: number
    } = {},
  ): Promise<BuildDeterministicFeedResult> => {
    const lookaheadMinutesRequested = options.lookaheadMinutes ?? DEFAULT_LOOKAHEAD_MINUTES
    const lookaheadMinutes = clamp(
      lookaheadMinutesRequested,
      MIN_LOOKAHEAD_MINUTES,
      MAX_LOOKAHEAD_MINUTES,
    )
    const maxItems = options.maxItems
      ? clamp(options.maxItems, 1, DEFAULT_MAX_ITEMS)
      : DEFAULT_MAX_ITEMS
    const now = options.now ?? new Date()
    return computeFeedFromEpisodes(episodes, now, lookaheadMinutes, maxItems)
  },
  resetState: (): void => {
    versionHistory.length = 0
    lastVersion = 0
    lastOkEntry = null
  },
}

function computeDataHash(payload: {
  validFrom_utc: string
  validTo_utc: string
  lookahead_min: number
  items: DeterministicFeedItem[]
}): string {
  const canonical = JSON.stringify(payload)
  return crypto.createHash('sha1').update(canonical).digest('hex')
}

function getNextVersion(): number {
  const now = Date.now()
  if (now <= lastVersion) {
    lastVersion += 1
    return lastVersion
  }
  lastVersion = now
  return lastVersion
}

function recordHistory(entry: FeedCacheEntry): void {
  versionHistory.push(entry)
  if (versionHistory.length > VERSION_HISTORY_LIMIT) {
    versionHistory.shift()
  }
}

export function getRecentFeeds(): FeedCacheEntry[] {
  return [...versionHistory]
}

export const FEED_ENV = {
  MTIME_GRACE_SEC,
  FEED_STRICT,
  FEED_FALLBACK_ON_ERROR,
  FEED_RATE_LIMIT_RPM,
  FEED_CB_THRESHOLD,
}

export async function buildDeterministicFeed(
  options: BuildOptions = {},
): Promise<BuildDeterministicFeedResult> {
  try {
    const lookaheadMinutesRequested = options.lookaheadMinutes ?? DEFAULT_LOOKAHEAD_MINUTES
    const lookaheadMinutes = clamp(
      lookaheadMinutesRequested,
      MIN_LOOKAHEAD_MINUTES,
      MAX_LOOKAHEAD_MINUTES,
    )
    const maxItems = options.maxItems
      ? clamp(options.maxItems, 1, DEFAULT_MAX_ITEMS)
      : DEFAULT_MAX_ITEMS

    const payload = await getPayload({ config })

    const now = new Date()
    const nowIso = now.toISOString()
    const lookaheadCutoff = new Date(now.getTime() + lookaheadMinutes * 60_000).toISOString()

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
              greater_than: nowIso,
            },
          },
          {
            scheduledAt: {
              less_than_equal: lookaheadCutoff,
            },
          },
        ],
      },
      sort: 'scheduledAt',
      limit: 500,
      depth: 1,
    })

    const episodes = episodesResult.docs as Episode[]

    return await computeFeedFromEpisodes(episodes, now, lookaheadMinutes, maxItems)
  } catch (error) {
    console.error('[DETERMINISTIC_FEED] build failed:', error)
    if (FEED_FALLBACK_ON_ERROR && lastOkEntry) {
      console.warn(
        '[DETERMINISTIC_FEED] returning last OK feed due to error; status=error+fallback',
        `version=${lastOkEntry.scheduleVersion}`,
      )
      const fallbackFeed: DeterministicFeedResponse = {
        ...lastOkEntry.feed,
        feed_status: 'error',
      }
      return {
        feed: fallbackFeed,
        etag: lastOkEntry.etag,
        feedStatus: 'error',
        missingCount: lastOkEntry.missingCount,
        totalCount: lastOkEntry.totalCount,
        missingIds: [...lastOkEntry.missingIds],
        fallbackApplied: true,
      }
    }
    throw error
  }
}

export function resolveLookaheadMinutes(param: string | null | undefined): number {
  if (!param) {
    return DEFAULT_LOOKAHEAD_MINUTES
  }
  const parsed = Number.parseInt(param, 10)
  if (Number.isNaN(parsed)) {
    return DEFAULT_LOOKAHEAD_MINUTES
  }
  return clamp(parsed, MIN_LOOKAHEAD_MINUTES, MAX_LOOKAHEAD_MINUTES)
}

export function resolveMaxItems(param: string | null | undefined): number {
  if (!param) {
    return DEFAULT_MAX_ITEMS
  }
  const parsed = Number.parseInt(param, 10)
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX_ITEMS
  }
  return clamp(parsed, 1, DEFAULT_MAX_ITEMS)
}
