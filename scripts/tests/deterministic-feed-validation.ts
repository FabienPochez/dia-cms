#!/usr/bin/env tsx
/**
 * Deterministic Feed Validation Harness
 *
 * Simulates edge conditions for the deterministic feed builder:
 *   a) ENOENT (missing file) -> feed_status=partial
 *   b) File inside mtime grace window -> feed_status=partial
 *   c) Strict mode (FEED_STRICT=true) -> hard failure
 *
 * The script prints feed payload summaries alongside the headers the API would emit.
 */

import 'dotenv/config'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import type { Episode, Show, MediaTrack } from '@/payload-types'

interface ScenarioResult {
  name: string
  status: 'ok' | 'error'
  headerStatus: string
  feedVersion?: number
  missingCount?: number
  totalCount?: number
  missingIds?: string[]
  errorMessage?: string
}

const BASE_NOW = new Date()

function makeEpisode(id: string, relativePath: string, startOffsetSec: number, durationSec: number): Episode {
  const start = new Date(BASE_NOW.getTime() + startOffsetSec * 1000)
  const end = new Date(start.getTime() + durationSec * 1000)
  const show: Partial<Show> = {
    id: `show-${id}`,
    title: 'Test Show',
    slug: 'test-show',
    subtitle: 'Test Subtitle',
  }
  const media: Partial<MediaTrack> = {
    id: `media-${id}`,
    mimeType: 'audio/mpeg',
  }
  return {
    id,
    scheduledAt: start.toISOString(),
    scheduledEnd: end.toISOString(),
    libretimeFilepathRelative: relativePath,
    libretimeTrackId: Number(id),
    libretimePlayoutId: Number(id),
    title: `Episode ${id}`,
    show,
    media,
  } as Episode
}

async function loadTestHarness(label: string) {
  const module = await import(
    `../../src/lib/schedule/deterministicFeed.ts?test=${label}&ts=${Date.now()}`
  )
  return module.__test__
}

async function runScenario(
  name: string,
  env: Record<string, string | undefined>,
  buildEpisodes: (libraryRoot: string) => Promise<Episode[]>,
): Promise<ScenarioResult> {
  const originalEnv: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    originalEnv[key] = process.env[key]
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    const harness = await loadTestHarness(name)
    harness.resetState()

    const libraryRoot = process.env.LIBRETIME_LIBRARY_ROOT as string
    const episodes = await buildEpisodes(libraryRoot)

    const result = await harness.buildDeterministicFeedFromEpisodes(episodes, {
      now: BASE_NOW,
      lookaheadMinutes: 120,
      maxItems: 8,
    })

    const headerStatus = result.fallbackApplied ? 'error+fallback' : result.feedStatus

    return {
      name,
      status: 'ok',
      headerStatus,
      feedVersion: result.feed.scheduleVersion,
      missingCount: result.feed.missing_count,
      totalCount: result.feed.total_count,
      missingIds: result.feed.missing_ids,
    }
  } catch (error: any) {
    return {
      name,
      status: 'error',
      headerStatus: 'error',
      errorMessage: error?.message || String(error),
    }
  } finally {
    for (const key of Object.keys(env)) {
      const value = originalEnv[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function main() {
  const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'det-feed-'))
  process.env.LIBRETIME_LIBRARY_ROOT = libraryRoot

  const scenarios: ScenarioResult[] = []

  // Scenario A: Missing file (ENOENT) - expect partial feed
  scenarios.push(
    await runScenario(
      'enoent',
      {
        FEED_STRICT: 'false',
        MTIME_GRACE_SEC: '10',
      },
      async () => {
        const relPath = 'imported/1/missing/test-missing.mp3'
        return [makeEpisode('1001', relPath, 60, 3600)]
      },
    ),
  )

  // Scenario B: File within grace window - expect partial feed
  scenarios.push(
    await runScenario(
      'grace-window',
      {
        FEED_STRICT: 'false',
        MTIME_GRACE_SEC: '10',
      },
      async (root) => {
        const relPath = 'imported/1/grace/test-grace.mp3'
        const absPath = path.join(root, relPath)
        await fs.mkdir(path.dirname(absPath), { recursive: true })
        await fs.writeFile(absPath, Buffer.from('test audio data'))
        await fs.utimes(absPath, new Date(), new Date())
        return [makeEpisode('1002', relPath, 120, 3600)]
      },
    ),
  )

  // Scenario C: Strict mode -> hard failure
  scenarios.push(
    await runScenario(
      'strict-missing',
      {
        FEED_STRICT: 'true',
        MTIME_GRACE_SEC: '10',
      },
      async () => {
        const relPath = 'imported/1/strict/test-strict.mp3'
        return [makeEpisode('1003', relPath, 180, 3600)]
      },
    ),
  )

  for (const result of scenarios) {
    console.log(`\n=== Scenario: ${result.name} ===`)
    if (result.status === 'ok') {
      console.log(`Status: ${result.status}`)
      console.log(`Headers:`)
      console.log(`  X-Feed-Status: ${result.headerStatus}`)
      console.log(`  X-Feed-Version: ${result.feedVersion}`)
      console.log(
        `  Missing: ${result.missingCount}/${result.totalCount} ids=${JSON.stringify(result.missingIds)}`,
      )
    } else {
      console.log(`Status: ${result.status}`)
      console.log(`Error: ${result.errorMessage}`)
      console.log(`Headers:`)
      console.log(`  X-Feed-Status: ${result.headerStatus} (strict mode)`)
    }
  }

  await fs.rm(libraryRoot, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})


