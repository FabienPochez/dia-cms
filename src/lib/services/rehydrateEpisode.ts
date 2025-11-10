/**
 * Rehydrate Episode Service
 * Updates episode with LibreTime track data when missing libretimeTrackId or libretimeFilepathRelative
 */

import { getPayload } from 'payload'
import config from '../../payload.config'
import { LibreTimeClient } from '../../integrations/libretimeClient'

export interface RehydrateResult {
  success: boolean
  trackId?: number
  relativePath?: string
  error?: string
}

/**
 * Rehydrate episode with LibreTime track data
 *
 * This function attempts to find the episode's track in LibreTime by:
 * 1. Searching LibreTime files by episode ID prefix
 * 2. If found, updating the episode with track ID and relative file path
 * 3. If not found, marking for manual intervention
 *
 * @param episodeId - Payload episode ID
 * @returns RehydrateResult with success status and track info
 */
export async function rehydrateEpisode(episodeId: string): Promise<RehydrateResult> {
  const startTime = Date.now()
  console.log(`[REHYDRATE] rehydrate.requested episodeId=${episodeId}`)

  try {
    const payload = await getPayload({ config })
    const ltClient = new LibreTimeClient()

    // Get episode
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 0,
    })

    if (!episode) {
      console.error(`[REHYDRATE] rehydrate.error episodeId=${episodeId} error=Episode not found`)
      return {
        success: false,
        error: 'Episode not found',
      }
    }

    // Check if already has LT refs
    if (episode.libretimeTrackId?.trim() && episode.libretimeFilepathRelative?.trim()) {
      console.log(
        `[REHYDRATE] rehydrate.done episodeId=${episodeId} trackId=${episode.libretimeTrackId} (already hydrated)`,
      )
      return {
        success: true,
        trackId: Number(episode.libretimeTrackId),
        relativePath: episode.libretimeFilepathRelative,
      }
    }

    // Search LibreTime for files matching episode ID
    const searchResults = await ltClient.getFiles({
      q: episodeId,
      limit: 10,
    })

    // Filter to exact or prefix matches
    const exactMatches = searchResults.filter((file) => {
      const filename = file.name || file.filepath
      return (
        filename.includes(episodeId) ||
        filename.startsWith(episodeId) ||
        filename.includes(`-${episodeId}-`) ||
        filename.includes(`_${episodeId}_`)
      )
    })

    if (exactMatches.length === 0) {
      console.warn(
        `[REHYDRATE] rehydrate.error episodeId=${episodeId} error=No matching file found in LibreTime`,
      )
      return {
        success: false,
        error: 'No matching file found in LibreTime - manual upload required',
      }
    }

    if (exactMatches.length > 1) {
      console.warn(
        `[REHYDRATE] rehydrate.error episodeId=${episodeId} error=Multiple matches found (${exactMatches.length}) - manual selection required`,
      )
      return {
        success: false,
        error: `Multiple matches found (${exactMatches.length}) - manual selection required`,
      }
    }

    // Use the single match
    const ltFile = exactMatches[0]
    const trackId = ltFile.id

    // Extract relative path
    const LIBRETIME_LIBRARY_ROOT = '/srv/airtime/stor/imported/'
    const relativePath = ltFile.filepath.startsWith(LIBRETIME_LIBRARY_ROOT)
      ? ltFile.filepath.substring(LIBRETIME_LIBRARY_ROOT.length)
      : ltFile.filepath

    // Update episode with LT refs
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        libretimeTrackId: trackId.toString(),
        libretimeFilepathRelative: relativePath,
      },
    })

    const duration = Date.now() - startTime
    console.log(
      `[REHYDRATE] rehydrate.done episodeId=${episodeId} trackId=${trackId} path=${relativePath} duration=${duration}ms`,
    )

    return {
      success: true,
      trackId,
      relativePath,
    }
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(
      `[REHYDRATE] rehydrate.error episodeId=${episodeId} error=${error instanceof Error ? error.message : 'Unknown'} duration=${duration}ms`,
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
