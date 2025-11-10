import { NextRequest, NextResponse } from 'next/server'

import { LibreTimeClient } from '../../../../../integrations/libretimeClient'
import { checkScheduleAuth } from '../../../../../lib/auth/checkScheduleAuth'
import { getSnapshot } from '../../../../../lib/schedule/syncSnapshots'

export const runtime = 'nodejs'

const BATCH_SIZE = 50

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkScheduleAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized - admin/staff only' },
        { status: 403 },
      )
    }

    const snapshotId = request.nextUrl.searchParams.get('snapshotId')
    if (!snapshotId) {
      return NextResponse.json(
        { success: false, error: 'snapshotId query parameter required' },
        { status: 400 },
      )
    }

    const snapshot = getSnapshot(snapshotId)
    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: 'Snapshot not found or expired' },
        { status: 404 },
      )
    }

    const ltClient = new LibreTimeClient()
    const window = snapshot.window

    const currentPlayouts = await ltClient.getSchedule({
      starts: window.utcStart,
      ends: window.utcEnd,
      limit: 2000,
    })

    let deleted = 0
    const deleteErrors: string[] = []
    const deleteChunks = Array.from({ length: Math.ceil(currentPlayouts.length / BATCH_SIZE) }).map(
      (_, index) => currentPlayouts.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
    )

    for (const chunk of deleteChunks) {
      for (const playout of chunk) {
        const ok = await ltClient.deletePlayout(playout.id)
        if (ok) {
          deleted += 1
        } else {
          deleteErrors.push(`Failed to delete playout ${playout.id}`)
        }
      }
      if (deleteChunks.length > 1) {
        await sleep(100 + Math.floor(Math.random() * 120))
      }
    }

    let restored = 0
    let skipped = 0
    const restoreErrors: string[] = []
    const restoreChunks = Array.from({
      length: Math.ceil(snapshot.playouts.length / BATCH_SIZE),
    }).map((_, index) =>
      snapshot.playouts.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
    )

    for (const chunk of restoreChunks) {
      for (const item of chunk) {
        if (!item.fileId) {
          skipped += 1
          continue
        }
        const result = await ltClient.ensurePlayout(
          item.instanceId,
          item.fileId,
          item.startsAt,
          item.endsAt,
        )
        if (result) {
          restored += 1
        } else {
          restoreErrors.push(`Failed to restore playout file=${item.fileId} instance=${item.instanceId}`)
        }
      }
      if (restoreChunks.length > 1) {
        await sleep(100 + Math.floor(Math.random() * 120))
      }
    }

    console.log(
      `[SYNC] rollback snapshot=${snapshotId} deleted=${deleted} restored=${restored} skipped=${skipped}`,
    )

    return NextResponse.json({
      success: restoreErrors.length === 0 && deleteErrors.length === 0,
      snapshotId,
      deleted,
      restored,
      skipped,
      deleteErrors,
      restoreErrors,
    })
  } catch (error) {
    console.error('[SYNC] rollback_error', error)
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


