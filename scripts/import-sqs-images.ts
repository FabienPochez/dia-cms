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

async function downloadImage(url: string, filepath: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image: ${res.statusText}`)
  const buffer = await res.buffer()
  await fs.writeFile(filepath, buffer)
}

async function migrateCollection(collectionName: string) {
  await fs.mkdir(tmpDir, { recursive: true })

  const { docs } = await payload.find({
    collection: collectionName,
    limit: 2000,
    depth: 0,
  })

  let updatedCount = 0

  for (const doc of docs) {
    if (doc.sqs_cover) {
      try {
        const url = doc.sqs_cover
        const rawFilename = path.basename(new URL(url).pathname)
        const originalName = decodeURIComponent(rawFilename.replace(/\+/g, ' '))

        const tmpFile = path.join(tmpDir, originalName)
        await downloadImage(url, tmpFile)
        await fs.access(tmpFile)

        const buffer = await fs.readFile(tmpFile)
        const fileType = await fileTypeFromBuffer(buffer)
        if (!fileType) throw new Error('Could not determine file type')

        // Force extension to match detected mime type
        const safeBaseName = path.basename(originalName, path.extname(originalName))
        const finalFilename = `${safeBaseName}.${fileType.ext}`

        // Force .jpeg extension if MIME is image/jpeg
        if (fileType.mime === 'image/jpeg') {
            finalFilename = `${safeBaseName}.jpeg`
        }

        console.log('Uploading file:', {
          name: finalFilename,
          type: fileType.mime,
        })

        const mediaDoc = await payload.create({
          collection: 'media-images',
          data: { alt: `${collectionName} cover image` },
          file: {
            data: buffer,
            name: finalFilename,
            type: fileType.mime,
          },
          disableVerification: true,
          req: {},
        })

        await payload.update({
          collection: collectionName,
          id: doc.id,
          data: {
            cover: mediaDoc.id,
          },
        })

        await fs.unlink(tmpFile)

        updatedCount++
        console.log(`✅ Migrated cover for ${collectionName} doc ${doc.id}`)
      } catch (err) {
        console.error(`❌ Failed migration for ${collectionName} doc ${doc.id}:`, err)
      }
    }
  }

  console.log(`✅ Migrated ${updatedCount} documents in ${collectionName}`)
}

async function run() {
  const config = (await import(configPath)).default
  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config,
  })

  await migrateCollection('episodes')
  await migrateCollection('shows')

  process.exit()
}

run()
