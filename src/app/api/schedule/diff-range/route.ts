import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '../../../../payload.config'
import { LibreTimeClient } from '../../../../integrations/libretimeClient'
import { checkScheduleAuth } from '../../../../lib/auth/checkScheduleAuth'
import { buildEnvelopeSyncPlan } from '../../../../lib/schedule/envelopeSync'

export const runtime = 'nodejs'

const RATE_LIMIT_MAX = 4
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

interface DiffRequestBody {
  mode?: 'envelope'
  dryRun?: boolean
}

interface RateBucket {
  count: number
  resetAt: number
}

const userBuckets = new Map<string, RateBucket>()
const ipBuckets = new Map<string, RateBucket>()

function consume(
  map: Map<string, RateBucket>,
  key: string,
): { allowed: boolean; retryAfter: number } {
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

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const auth = await checkScheduleAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: auth.error || 'Unauthorized - admin/staff only',
        },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as DiffRequestBody
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

    const payload = await getPayload({ config })
    const ltClient = new LibreTimeClient()
    const plan = await buildEnvelopeSyncPlan(payload, ltClient)
    const summary = plan.summary

    const durationMs = Date.now() - startedAt

    console.log(
      `[SYNC] envelope_diff window=${plan.window.weeksLabel} created=${summary.created} updated=${summary.updated} deleted=${summary.deleted} skippedMissing=${summary.skippedMissing} protectedNow=${summary.protectedNow} durMs=${durationMs} partial=${summary.partial}`,
    )

    return NextResponse.json({
      success: true,
      window: plan.window,
      ensure: plan.ensure,
      remove: plan.remove,
      summary,
      serverHash: plan.serverHash,
      dryRun: true,
    })
  } catch (error) {
    console.error('[SYNC] envelope_diff_error', error)
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
