import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { getPayload } from 'payload'
import payloadConfig from '../src/payload.config'

const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'

async function cleanup() {
  console.log('🧹 Cleanup: Remove unscheduled files from imported/1')
  console.log('='.repeat(60))

  const payload = await getPayload({ config: payloadConfig })

  // Get episodes scheduled in next 24h (plus 1h ago for currently playing)
  const scheduledEpisodes = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        { publishedStatus: { equals: 'published' } },
        { scheduledAt: { exists: true } },
        {
          scheduledAt: {
            greater_than_equal: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
        }, // Include 1h ago
        {
          scheduledAt: {
            less_than: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        { libretimeFilepathRelative: { exists: true } },
      ],
    },
    limit: 100,
    depth: 0,
  })

  const scheduledFiles = new Set(
    scheduledEpisodes.docs.map((ep) => ep.libretimeFilepathRelative).filter(Boolean),
  )

  console.log(`📋 Found ${scheduledFiles.size} scheduled files to keep`)
  scheduledFiles.forEach((f) => console.log(`   ✅ Keep: ${f}`))

  // Get all MP3 files in imported/1
  const importedDir = path.join(LIBRETIME_LIBRARY_ROOT, 'imported/1')
  const allFiles = await fs.readdir(importedDir)
  const mp3Files = allFiles.filter((f) => f.endsWith('.mp3'))

  console.log(`\n📁 Found ${mp3Files.length} total MP3 files in imported/1`)

  // Find files to remove
  const toRemove = mp3Files.filter((filename) => {
    const relativePath = `imported/1/${filename}`
    return !scheduledFiles.has(relativePath)
  })

  console.log(`\n🗑️  Files to remove: ${toRemove.length}`)

  if (toRemove.length === 0) {
    console.log('✅ No files to remove, all files are scheduled!')
    process.exit(0)
  }

  // Show files to remove
  toRemove.forEach((f) => console.log(`   🗑️  ${f}`))

  // Remove files
  let removed = 0
  for (const filename of toRemove) {
    const filepath = path.join(importedDir, filename)
    try {
      await fs.unlink(filepath)
      removed++
    } catch (error: unknown) {
      console.error(`   ❌ Failed to remove ${filename}: ${(error as Error).message}`)
    }
  }

  console.log(`\n✅ Cleanup complete: Removed ${removed} of ${toRemove.length} files`)
  process.exit(0)
}

cleanup().catch((err) => {
  console.error('❌ Cleanup failed:', err.message)
  process.exit(1)
})
