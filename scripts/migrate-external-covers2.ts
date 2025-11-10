import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const tmpDir = '/srv/media/tmp'

async function migrateDraftEpisodeCovers() {
  const { docs } = await payload.find({
    collection: 'episodes',
    limit: 2000,
    depth: 0,
  })

  let updatedCount = 0

  for (const doc of docs) {
    if (
      doc.status === 'draft' &&
      doc.coverExternal &&
      !doc.cover
    ) {
      try {
        const url = doc.coverExternal
        const rawFilename = path.basename(new URL(url).pathname)
        const originalName = decodeURIComponent(rawFilename.replace(/\+/g, ' '))
        console.log('original coverExternal:', url)
        console.log('decoded filename:', originalName)
        const tmpFile = path.join(tmpDir, originalName)

        const buffer = await fs.readFile(tmpFile)
        const fileType = await fileTypeFromBuffer(buffer)
        if (!fileType) throw new Error('Could not determine file type')

        const safeBaseName = path.basename(originalName, path.extname(originalName))
        const finalFilename = fileType.mime === 'image/jpeg'
          ? `${safeBaseName}.jpeg`
          : `${safeBaseName}.${fileType.ext}`

        console.log(`Detected file type for ${doc.id}:`, fileType)

        const mediaDoc = await payload.create({
          collection: 'media-images',
          data: { alt: 'episode cover image' },
          file: {
            data: buffer,
            name: finalFilename,
            type: fileType.mime,
          },
          disableVerification: true,
          req: {},
        })

        await payload.update({
          collection: 'episodes',
          id: doc.id,
          data: {
            cover: mediaDoc.id,
          },
        })

        updatedCount++
        console.log(`✅ Migrated cover for episode ${doc.id}`)
      } catch (err) {
        console.error(`❌ Failed migration for episode ${doc.id}:`, err)
      }
    }
  }

  console.log(`✅ Migrated ${updatedCount} episode covers`)
}

async function run() {
  const config = (await import(configPath)).default
  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config,
  })

  await migrateDraftEpisodeCovers()
  process.exit()
}

run()
