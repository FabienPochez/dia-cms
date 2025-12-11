import { NextRequest, NextResponse } from 'next/server'

import {
  FEED_ENV,
  buildDeterministicFeed,
  resolveLookaheadMinutes,
  resolveMaxItems,
} from '@/lib/schedule/deterministicFeed'
import type { BuildDeterministicFeedResult } from '@/lib/schedule/deterministicFeed'
import { checkScheduleAuth } from '@/lib/auth/checkScheduleAuth'

export const runtime = 'nodejs'

const RATE_LIMIT_CAPACITY = FEED_ENV.FEED_RATE_LIMIT_RPM
const RATE_LIMIT_INTERVAL_MS = 60_000
const CIRCUIT_RESET_MS = 60_000
const CIRCUIT_THRESHOLD = Math.max(1, FEED_ENV.FEED_CB_THRESHOLD)

let rateTokens = RATE_LIMIT_CAPACITY
let rateLastRefillMs = Date.now()
let circuitErrorCount = 0
let circuitOpen = false
let circuitOpenedAt = 0
let lastOkSnapshot: BuildDeterministicFeedResult | null = null

function consumeRateToken(): boolean {
  if (RATE_LIMIT_CAPACITY <= 0) {
    return true
  }

  const now = Date.now()
  if (now > rateLastRefillMs) {
    const elapsed = now - rateLastRefillMs
    const tokensToAdd = (elapsed / RATE_LIMIT_INTERVAL_MS) * RATE_LIMIT_CAPACITY
    rateTokens = Math.min(RATE_LIMIT_CAPACITY, rateTokens + tokensToAdd)
    rateLastRefillMs = now
  }

  if (rateTokens >= 1) {
    rateTokens -= 1
    return true
  }

  return false
}

function statusHeader(snapshot: BuildDeterministicFeedResult, override?: string): string {
  if (override) return override
  if (snapshot.fallbackApplied) return 'error+fallback'
  return snapshot.feedStatus
}

function respondWithSnapshot(
  request: NextRequest,
  snapshot: BuildDeterministicFeedResult,
  statusOverride?: string,
  forceFresh = false,
): NextResponse {
  const etagHeader = `"${snapshot.etag}"`
  const headerStatus = statusHeader(snapshot, statusOverride)
  const headers: Record<string, string> = {
    ETag: etagHeader,
    'Cache-Control': 'no-store',
    'X-Feed-Version': String(snapshot.feed.scheduleVersion),
    'X-Feed-Status': headerStatus,
  }

  if (!forceFresh) {
    const ifNoneMatch = request.headers.get('if-none-match')

    if (ifNoneMatch) {
      const candidates = ifNoneMatch
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)

      const match = candidates.some((token) => {
        if (token === '*') return true
        return token.replace(/^W\//, '') === etagHeader
      })

      if (match) {
        return new NextResponse(null, {
          status: 304,
          headers,
        })
      }
    }
  }

  return NextResponse.json(snapshot.feed, {
    status: 200,
    headers,
  })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Security: Check if deterministic feed is temporarily disabled
  if (process.env.DISABLE_DETERMINISTIC_FEED === 'true') {
    return NextResponse.json(
      {
        error: 'Deterministic feed temporarily disabled for security investigation',
        feed_status: 'error',
      },
      { status: 503 },
    )
  }

  const sharedToken = process.env.DETERMINISTIC_FEED_TOKEN || process.env.PAYLOAD_API_KEY

  if (sharedToken) {
    const header = request.headers.get('authorization')?.trim() ?? ''
    const allowed = new Set([
      sharedToken,
      `Bearer ${sharedToken}`,
      `Token ${sharedToken}`,
      `users API-Key ${sharedToken}`,
    ])

    if (!allowed.has(header)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    const auth = await checkScheduleAuth(request)

    if (!auth.authorized) {
      return NextResponse.json(
        {
          error: auth.error || 'Unauthorized',
        },
        { status: 401 },
      )
    }
  }

  const searchParams = request.nextUrl.searchParams
  const lookaheadMinutes = resolveLookaheadMinutes(searchParams.get('lookahead'))
  const maxItems = resolveMaxItems(searchParams.get('maxItems'))

  if (!consumeRateToken()) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': '60',
        },
      },
    )
  }

  const now = Date.now()

  if (circuitOpen) {
    if (now - circuitOpenedAt >= CIRCUIT_RESET_MS) {
      circuitOpen = false
      circuitErrorCount = 0
    } else if (lastOkSnapshot) {
      return respondWithSnapshot(request, lastOkSnapshot, 'degraded-cb', true)
    } else {
      return NextResponse.json(
        { error: 'Circuit breaker open and no fallback available' },
        { status: 503 },
      )
    }
  }

  try {
    const result = await buildDeterministicFeed({
      lookaheadMinutes,
      maxItems,
    })

    if (!result.fallbackApplied && result.feedStatus === 'ok') {
      lastOkSnapshot = result
    }

    if (result.feedStatus === 'error') {
      circuitErrorCount += 1
      if (circuitErrorCount >= CIRCUIT_THRESHOLD) {
        circuitOpen = true
        circuitOpenedAt = Date.now()
        console.warn(
          '[DETERMINISTIC_FEED] circuit breaker opened after consecutive errors:',
          circuitErrorCount,
        )
        if (lastOkSnapshot) {
          return respondWithSnapshot(request, lastOkSnapshot, 'degraded-cb', true)
        }
      }
    } else {
      circuitErrorCount = 0
    }

    return respondWithSnapshot(
      request,
      result,
      undefined,
      result.fallbackApplied || result.feedStatus === 'error',
    )
  } catch (error) {
    console.error('[DETERMINISTIC_FEED] generation failed:', error)
    circuitErrorCount += 1
    if (circuitErrorCount >= CIRCUIT_THRESHOLD) {
      circuitOpen = true
      circuitOpenedAt = Date.now()
      console.warn(
        '[DETERMINISTIC_FEED] circuit breaker opened after thrown errors:',
        circuitErrorCount,
      )
      if (lastOkSnapshot) {
        return respondWithSnapshot(request, lastOkSnapshot, 'degraded-cb', true)
      }
    }

    return NextResponse.json(
      {
        error: 'Schedule feed generation failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
