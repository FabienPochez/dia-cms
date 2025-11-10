import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { LibreTimeClient } from '../src/integrations/libretimeClient'
import { buildEnvelopeSyncPlan } from '../src/lib/schedule/envelopeSync'
import { planOne } from '../src/lib/services/scheduleOperations'
import { saveSnapshot } from '../src/lib/schedule/syncSnapshots'
import { buildDeterministicFeed, getRecentFeeds } from '../src/lib/schedule/deterministicFeed'

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

async function main(): Promise<void> {
  console.log('[SYNC] manual envelope sync starting')
  const startedAt = Date.now()
  const payload = await getPayload({ config })
  const ltClient = new LibreTimeClient()

  const plan = await buildEnvelopeSyncPlan(payload, ltClient)
  console.log('[SYNC] plan built', {
    ensure: plan.ensure.length,
    remove: plan.remove.length,
    skippedMissing: plan.summary.skippedMissing,
    protectedNow: plan.summary.protectedNow,
    window: plan.window.weeksLabel,
  })

  const ensureChunks = chunk(plan.ensure, 50)
  const removeChunks = chunk(plan.remove, 50)
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
        startsAt: new Date(p.starts_at).toISOString(),
        endsAt: new Date(p.ends_at).toISOString(),
      })),
    })
    snapshotId = snapshot.id
    console.log('[SYNC] snapshot captured', snapshotId)
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
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 150)))
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
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 150)))
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
        console.log(`[SYNC] manual_envelope instance_retained instance=${instanceId}`)
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
    `[SYNC] manual_envelope window=${plan.window.weeksLabel} created=${createdApplied} updated=${updatedApplied} deleted=${deletedApplied} skippedMissing=${plan.summary.skippedMissing} protectedNow=${plan.summary.protectedNow} durMs=${durationMs} feedVer=${beforeVersion ?? 'n/a'}→${afterVersion} status=${feedStatus} snapshot=${snapshotId ?? 'n/a'}`,
  )

  if (errors.length > 0) {
    console.error('[SYNC] manual_envelope errors', errors)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('[SYNC] manual_envelope fatal', error)
  process.exit(1)
})
