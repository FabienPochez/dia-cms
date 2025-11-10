import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '../../../../payload.config'
import { LibreTimeClient } from '../../../../integrations/libretimeClient'
import { checkScheduleAuth } from '../../../../lib/auth/checkScheduleAuth'
import { buildEnvelopeSyncPlan } from '../../../../lib/schedule/envelopeSync'
import { saveSnapshot } from '../../../../lib/schedule/syncSnapshots'
import { buildDeterministicFeed, getRecentFeeds } from '../../../../lib/schedule/deterministicFeed'
import { planOne } from '../../../../lib/services/scheduleOperations'

export const runtime = 'nodejs'

const RATE_LIMIT_MAX = 4
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const BATCH_SIZE = 50

interface ApplyRequestBody {
  mode?: 'envelope'
  dryRun?: boolean
}

interface RateBucket {
  count: number
  resetAt: number
}

interface ApplyResult {
  success: boolean
  summary: {
    created: number
    updated: number
    deleted: number
    skippedMissing: number
    missingIds: string[]
    protectedNow: number
    partial: boolean
  }
  errors?: string[]
  window?: any
  feed?: {
    status: string
    versionBefore: number | null
    versionAfter: number | null
  }
  snapshotId?: string | null
}

const userBuckets = new Map<string, RateBucket>()
const ipBuckets = new Map<string, RateBucket>()

function consume(map: Map<string, RateBucket>, key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const bucket = map.get(key)
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return { allowed: true, retryAfter: RATE_LIMIT_WINDOW_MS }
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: bucket.resetAt - now }
  }
  bucket.count += 1
  return { allowed: true, retryAfter: bucket.resetAt - now }
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }
  return 'unknown'
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeIso(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  return date.toISOString()
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const auth = await checkScheduleAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized - admin/staff only' },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as ApplyRequestBody
    const mode = body.mode ?? 'envelope'
    if (mode !== 'envelope') {
      return NextResponse.json(
        { success: false, error: 'Only envelope mode is supported' },
        { status: 400 },
      )
    }

    const userKey = auth.user?.id ?? auth.user?.email ?? 'unknown-user'
    const ipKey = getClientIp(request)

    const userRate = consume(userBuckets, userKey)
    const ipRate = consume(ipBuckets, ipKey)
    if (!userRate.allowed || !ipRate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil(Math.max(userRate.retryAfter, ipRate.retryAfter) / 1000),
        },
        { status: 429 },
      )
    }

    const dryRun = Boolean(body.dryRun)
    const payload = await getPayload({ config })
    const ltClient = new LibreTimeClient()
    const plan = await buildEnvelopeSyncPlan(payload, ltClient)

    if (dryRun) {
      return NextResponse.json({
        success: true,
        summary: plan.summary,
        window: plan.window,
        ensure: plan.ensure,
        remove: plan.remove,
        serverHash: plan.serverHash,
        feed: {
          status: 'dry-run',
          versionBefore: getRecentFeeds().at(-1)?.feed.scheduleVersion ?? null,
          versionAfter: null,
        },
        snapshotId: null,
      })
    }

    const ensureChunks = chunk(plan.ensure, BATCH_SIZE)
    const removeChunks = chunk(plan.remove, BATCH_SIZE)
    const errors: string[] = []

    let createdApplied = 0
    let updatedApplied = 0
    let deletedApplied = 0
    const instancesTouched = new Set<number>()
    let snapshotId: string | null = null

    try {
      const prePlayouts = await ltClient.getSchedule({
        starts: plan.window.utcStart,
        ends: plan.window.utcEnd,
        limit: 2000,
      })

      const snapshot = saveSnapshot({
        window: {
          utcStart: plan.window.utcStart,
          utcEnd: plan.window.utcEnd,
          parisStart: plan.window.parisStart,
          parisEnd: plan.window.parisEnd,
          weeksLabel: plan.window.weeksLabel,
          nowUtc: plan.window.nowUtc,
          nowParis: plan.window.nowParis,
        },
        playouts: prePlayouts.map((p) => ({
          playoutId: p.id,
          instanceId: p.instance,
          fileId: p.file ?? null,
          startsAt: normalizeIso(p.starts_at),
          endsAt: normalizeIso(p.ends_at),
        })),
      })
      snapshotId = snapshot.id
    } catch (error) {
      console.warn('[SYNC] snapshot capture failed', error)
    }

    for (const group of ensureChunks) {
      for (const op of group) {
        const result = await planOne({
          episodeId: op.episodeId,
          showId: op.showId,
          scheduledAt: op.scheduledAt,
          scheduledEnd: op.scheduledEnd,
          dryRun: false,
        })

        if (result.success) {
          if (op.changeType === 'create') {
            createdApplied += 1
          } else {
            updatedApplied += 1
          }
        } else {
          errors.push(
            `planOne failed episode=${op.episodeId} error=${result.error || result.code || 'unknown'}`,
          )
        }
      }
      if (ensureChunks.length > 1) {
        await sleep(100 + Math.floor(Math.random() * 150))
      }
    }

    for (const group of removeChunks) {
      for (const op of group) {
        try {
          const deleted = await ltClient.deletePlayout(op.playoutId)
          if (deleted) {
            deletedApplied += 1
            if (op.instanceId) {
              instancesTouched.add(op.instanceId)
            }
          } else {
            errors.push(`deletePlayout returned false playout=${op.playoutId}`)
          }
        } catch (error) {
          errors.push(
            `deletePlayout error playout=${op.playoutId} err=${
              error instanceof Error ? error.message : 'unknown'
            }`,
          )
        }
      }
      if (removeChunks.length > 1) {
        await sleep(100 + Math.floor(Math.random() * 150))
      }
    }

    const instanceTargets = new Set<number>(plan.removeInstances ?? [])
    for (const touched of instancesTouched) {
      instanceTargets.add(touched)
    }
    let instancesDeleted = 0
    for (const instanceId of instanceTargets) {
      try {
        const removedInstance = await ltClient.deleteInstance(instanceId)
        if (removedInstance) {
          instancesDeleted += 1
        } else {
          console.log(`[SYNC] instance_retained instance=${instanceId}`)
        }
      } catch (error) {
        errors.push(
          `deleteInstance error instance=${instanceId} err=${
            error instanceof Error ? error.message : 'unknown'
          }`,
        )
      }
    }
    deletedApplied += instancesDeleted

    const beforeVersion = getRecentFeeds().at(-1)?.feed.scheduleVersion ?? null
    const feedResult = await buildDeterministicFeed()
    const afterVersion = feedResult.feed.scheduleVersion
    const feedStatus = feedResult.feed_status ?? feedResult.feedStatus ?? 'ok'

    const durationMs = Date.now() - startedAt

    console.log(
      `[SYNC] envelope_apply window=${plan.window.weeksLabel} created=${createdApplied} updated=${updatedApplied} deleted=${deletedApplied} skippedMissing=${plan.summary.skippedMissing} protectedNow=${plan.summary.protectedNow} durMs=${durationMs} feedVer:${beforeVersion ?? 'n/a'}→${afterVersion} status=${feedStatus} snapshot=${snapshotId ?? 'n/a'}`,
    )

    const response: ApplyResult = {
      success: errors.length === 0,
      summary: {
        created: createdApplied,
        updated: updatedApplied,
        deleted: deletedApplied,
        skippedMissing: plan.summary.skippedMissing,
        missingIds: plan.summary.missingIds,
        protectedNow: plan.summary.protectedNow,
        partial: plan.summary.partial || feedStatus === 'partial',
      },
      errors: errors.length > 0 ? errors : undefined,
      window: plan.window,
      feed: {
        status: feedStatus,
        versionBefore: beforeVersion,
        versionAfter: afterVersion,
      },
      snapshotId,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[SYNC] envelope_apply_error', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

