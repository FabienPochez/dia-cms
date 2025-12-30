#!/usr/bin/env node
/**
 * Check episode file status and manually rehydrate if needed
 */

import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { getPayload } from 'payload'
import payloadConfig from '../src/payload.config'
import { rsyncPull } from '../src/server/lib/rsyncPull'
import { updateLibreTimeFileExists } from '../src/server/lib/libretimeDb'

const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'

async function rehydrateEpisodeDirect(
  payload: any,
  episodeId: string,
): Promise<{ action: 'copied' | 'ok' | 'error'; code?: string }> {
  try {
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 0,
    })

    if (!episode) {
      return { action: 'error', code: 'E_NOT_FOUND' }
    }

    const libretimeFilepathRelative = episode.libretimeFilepathRelative as string | undefined
    const archiveFilePath = episode.archiveFilePath as string | undefined

    if (!libretimeFilepathRelative) {
      return { action: 'error', code: 'E_NOT_PLANNABLE' }
    }

    const workingAbsPath = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)

    // Check if working file already exists
    try {
      await fs.access(workingAbsPath)
      return { action: 'ok' }
    } catch {
      // File doesn't exist, continue to copy
    }

    // Copy from archive if available
    if (archiveFilePath) {
      try {
        await rsyncPull(archiveFilePath, libretimeFilepathRelative)

        // Verify file exists
        const stats = await fs.stat(workingAbsPath)
        if (stats.size === 0) {
          throw new Error('File copied but has zero size')
        }
        console.log(`✅ Verified file: ${stats.size} bytes`)

        // Update LibreTime database
        const dbResult = await updateLibreTimeFileExists(libretimeFilepathRelative, true)
        if (!dbResult.success) {
          console.warn(`⚠️ File copied but LibreTime DB update failed: ${dbResult.error}`)
        }

        return { action: 'copied' }
      } catch (error: any) {
        return { action: 'error', code: error.code || 'E_COPY_FAILED' }
      }
    }

    return { action: 'error', code: 'E_WORKING_MISSING' }
  } catch (error: any) {
    console.error(`❌ Rehydrate failed: ${error.message}`)
    return { action: 'error', code: 'E_UNKNOWN' }
  }
}

async function main() {
  const episodeId = process.argv[2] || '685e6a54b3ef76e0e25c192b'
  
  console.log('='.repeat(80))
  console.log('📻 Episode File Status Check')
  console.log('='.repeat(80))
  console.log(`\nEpisode ID: ${episodeId}\n`)

  const payload = await getPayload({ config: payloadConfig })

  try {
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
    })

    console.log('Episode Details:')
    console.log(`  Title: ${episode.title || 'N/A'}`)
    console.log(`  libretimeTrackId: ${episode.libretimeTrackId || 'N/A'}`)
    console.log(`  libretimeFilepathRelative: ${episode.libretimeFilepathRelative || 'N/A'}`)
    console.log(`  scheduledAt: ${episode.scheduledAt || 'N/A'}`)
    console.log(`  scheduledEnd: ${episode.scheduledEnd || 'N/A'}`)
    console.log(`  publishedStatus: ${episode.publishedStatus || 'N/A'}`)

    if (!episode.libretimeFilepathRelative) {
      console.log('\n❌ Episode has no libretimeFilepathRelative!')
      process.exit(1)
    }

    // Check if file exists in LibreTime library
    const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
    const workingPath = `${LIBRETIME_LIBRARY_ROOT}/${episode.libretimeFilepathRelative}`
    
    console.log(`\n📁 Checking file: ${workingPath}`)
    
    const fs = await import('fs/promises')
    try {
      const stats = await fs.stat(workingPath)
      console.log(`✅ File EXISTS in LibreTime library`)
      console.log(`   Size: ${stats.size} bytes`)
      console.log(`   Modified: ${stats.mtime.toISOString()}`)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`❌ File MISSING in LibreTime library`)
        console.log(`\n🔄 Attempting to rehydrate...`)
        
        const result = await rehydrateEpisodeDirect(payload, episodeId)
        
        if (result.action === 'copied') {
          console.log(`✅ Rehydration successful!`)
          
          // Verify it exists now
          try {
            const stats = await fs.stat(workingPath)
            console.log(`✅ Verified: File now exists (${stats.size} bytes)`)
          } catch (verifyError: any) {
            console.log(`⚠️  Rehydration reported success but file still missing`)
          }
        } else {
          console.log(`❌ Rehydration failed: ${result.code || 'unknown error'}`)
          process.exit(1)
        }
      } else {
        console.log(`❌ Error checking file: ${error.message}`)
        process.exit(1)
      }
    }

    // Check LibreTime API to see if file is registered
    if (episode.libretimeTrackId) {
      console.log(`\n🔍 Checking LibreTime API for track ID: ${episode.libretimeTrackId}`)
      const { LibreTimeClient } = await import('../src/integrations/libretimeClient')
      const client = new LibreTimeClient()
      
      try {
        const file = await client.getFile(Number(episode.libretimeTrackId))
        console.log(`✅ File found in LibreTime API:`)
        console.log(`   Title: ${file.track_title || 'N/A'}`)
        console.log(`   Exists: ${file.exists}`)
        console.log(`   Hidden: ${file.hidden}`)
        console.log(`   Filepath: ${file.filepath || 'N/A'}`)
        
        if (!file.exists) {
          console.log(`\n⚠️  WARNING: File marked as NOT EXISTS in LibreTime database!`)
          console.log(`   You may need to run the file-exists check script.`)
        }
      } catch (error: any) {
        console.log(`❌ Could not fetch file from LibreTime API: ${error.message}`)
      }
    } else {
      console.log(`\n⚠️  Episode has no libretimeTrackId - file may not be registered in LibreTime`)
    }

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }

  console.log('\n' + '='.repeat(80))
}

main().catch(console.error)

