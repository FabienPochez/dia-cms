import { NextRequest, NextResponse } from 'next/server'
import { checkScheduleAuth } from '@/lib/auth/checkScheduleAuth'

export const runtime = 'nodejs'

type RouteParams = {
  path: string[]
}

/**
 * Forward request to LibreTime API with proper authentication
 */
async function forward(
  method: string,
  request: NextRequest,
  params: RouteParams,
): Promise<NextResponse> {
  try {
    // Security: Require admin or staff authentication for all requests
    const auth = await checkScheduleAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        {
          error: auth.error || 'Unauthorized - admin/staff only',
        },
        { status: 403 },
      )
    }

    // Check if writes are disabled for non-GET requests
    if (method !== 'GET' && process.env.PLANNER_LT_WRITE_ENABLED === 'false') {
      return NextResponse.json(
        {
          error: 'LibreTime write operations are disabled',
          status: 403,
          details: 'Set PLANNER_LT_WRITE_ENABLED=true to enable write operations',
        },
        { status: 403 },
      )
    }

    // Build target URL
    const path = (params.path || []).join('/')
    const baseUrl = process.env.LIBRETIME_API_URL?.replace(/\/+$/, '') || 'http://api:9001'
    const target = `${baseUrl}/${path}${request.nextUrl.search}`

    // Clone request headers
    const headers = new Headers()
    request.headers.forEach((value, key) => {
      headers.set(key, value)
    })

    // Set LibreTime authentication
    headers.set('Authorization', `Api-Key ${process.env.LIBRETIME_API_KEY}`)

    // Forward instance ID header if present
    const instanceId = request.headers.get('x-lt-instance-id')
    if (instanceId) {
      headers.set('x-lt-instance-id', instanceId)
    }

    // Preserve Content-Type for non-GET requests
    if (method !== 'GET' && request.headers.get('content-type')) {
      headers.set('Content-Type', request.headers.get('content-type')!)
    }

    // Get request body for non-GET requests
    let body: string | undefined
    if (method !== 'GET') {
      try {
        body = await request.text()
      } catch (error) {
        console.error('[LT] Failed to read request body:', error)
        return NextResponse.json(
          {
            error: 'Failed to read request body',
            status: 400,
            details: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 400 },
        )
      }
    }

    // Forward request to LibreTime
    const response = await fetch(target, {
      method,
      headers,
      body,
    })

    // Handle 204 No Content responses
    if (response.status === 204) {
      return new Response(null, { status: 204 })
    }

    // Get response body
    let responseBody: any
    const contentType = response.headers.get('content-type')

    if (contentType?.includes('application/json')) {
      try {
        responseBody = await response.json()
      } catch (error) {
        console.error('[LT] Failed to parse JSON response:', error)
        responseBody = { error: 'Invalid JSON response from LibreTime' }
      }
    } else {
      responseBody = await response.text()
    }

    // Return response with same status code
    return NextResponse.json(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('[LT] Proxy error:', error)

    return NextResponse.json(
      {
        error: 'LibreTime proxy error',
        status: 500,
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest, context: any) {
  const { params } = context as { params: RouteParams }
  return forward('GET', request, params)
}

export async function POST(request: NextRequest, context: any) {
  const { params } = context as { params: RouteParams }
  const path = (params.path || []).join('/')

  // Handle special move endpoint
  if (path === 'api/v2/schedule/move') {
    try {
      const body = await request.json()
      const { scheduleId, fileId, instanceId, startsAt, endsAt } = body

      if (!scheduleId || !fileId || !instanceId || !startsAt || !endsAt) {
        return NextResponse.json(
          { error: 'Missing required fields: scheduleId, fileId, instanceId, startsAt, endsAt' },
          { status: 400 },
        )
      }

      // Import the LibreTime client
      const { LibreTimeClient } = await import('@/integrations/libretimeClient')
      const client = new LibreTimeClient()

      const result = await client.moveScheduleWithFallback(
        scheduleId,
        fileId,
        instanceId,
        startsAt,
        endsAt,
      )

      if (result.success) {
        return NextResponse.json({
          scheduleId: result.scheduleId,
          usedFallback: result.usedFallback || false,
        })
      } else {
        return NextResponse.json({ error: result.error || 'Move failed' }, { status: 500 })
      }
    } catch (error) {
      console.error('[LT] Move endpoint error:', error)
      return NextResponse.json({ error: 'Move endpoint error' }, { status: 500 })
    }
  }

  // Default POST handling
  return forward('POST', request, params)
}

export async function PATCH(request: NextRequest, context: any) {
  const { params } = context as { params: RouteParams }
  return forward('PATCH', request, params)
}

export async function DELETE(request: NextRequest, context: any) {
  const { params } = context as { params: RouteParams }
  return forward('DELETE', request, params)
}
