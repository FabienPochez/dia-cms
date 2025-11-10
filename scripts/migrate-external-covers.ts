import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import fetch from 'node-fetch'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromBuffer } from 'file-type'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const tmpDir = '/srv/media/tmp'

async function downloadImage(url, filepath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image: ${res.statusText}`)
  const buffer = await res.buffer()
  await fs.writeFile(filepath, buffer)
}

async function migrateExternalCovers() {
  await fs.mkdir(tmpDir, { recursive: true })

  const { docs } = await payload.find({
    collection: 'episodes',
    where: {
      status: { equals: 'draft' },
      cover: { equals: '' },
      coverExternal: { exists: true },
    },
    limit: 2000,
    depth: 0,
  })

  let updatedCount = 0

  for (const doc of docs) {
    if (doc.coverExternal) {
      try {
        const url = doc.coverExternal
        const rawFilename = path.basename(new URL(url).pathname)
        const originalName = decodeURIComponent(rawFilename.replace(/\+/g, ' '))

        const tmpFile = path.join(tmpDir, originalName)
        await downloadImage(url, tmpFile)

const buffer = await fs.readFile(tmpFile)
if (!buffer || buffer.length === 0) throw new Error('Downloaded file is empty')

const fileType = await fileTypeFromBuffer(buffer)
if (!fileType) throw new Error('Could not determine file type')

        console.log(`Detected file type for ${doc.id}:`, fileType)
        if (!fileType) throw new Error('Could not determine file type')

        const safeBaseName = path.basename(originalName, path.extname(originalName))
        let finalFilename = `${safeBaseName}.${fileType.ext}`

        if (fileType.mime === 'image/jpeg') {
          finalFilename = `${safeBaseName}.jpeg`
        }



        const mediaDoc = await payload.create({
          collection: 'media-images',
          data: { alt: 'Episode cover image' },
          file: {
  data: buffer,
  name: finalFilename,
  type: fileType.mime,
},

          disableVerification: true,
          req: {
            user: {
              collection: 'users',
              id: 'migration-script',
            },
            headers: {},
        },
        })

        await payload.update({
          collection: 'episodes',
          id: doc.id,
          data: { cover: mediaDoc.id },
        })

        await fs.unlink(tmpFile)

        updatedCount++
        console.log(`✅ Migrated cover for episode ${doc.id}`)
      } catch (err) {
        console.error(`❌ Failed migration for episode ${doc.id}:`, err)
      }
    }
  }

  console.log(`✅ Migrated ${updatedCount} episode covers from coverExternal`)
}

async function run() {
  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET, local: true, config })

  await migrateExternalCovers()

  process.exit()
}

run()
