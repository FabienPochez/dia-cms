import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import fs from 'fs/promises'
import fsOrig from 'fs'
import path from 'path'
import { fileTypeFromFile } from 'file-type'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const tmpDir = '/srv/media/tmp'

async function processFile(filename: string) {
  const match = filename.match(/^(episode|show)-([a-f0-9]+)\.(\w+)$/)
  if (!match) {
    console.warn(`⚠ Skipping unrecognized file: ${filename}`)
    return
  }

  const [ , type, id ] = match
  const filepath = path.join(tmpDir, filename)

  const stream = fsOrig.createReadStream(filepath)
  const fileType = await fileTypeFromFile(filepath)
  if (!fileType) throw new Error(`Could not determine MIME type for ${filename}`)

    console.log(`Detected MIME for ${filename}: ${fileType.mime}`)


  const mediaDoc = await payload.create({
    collection: 'media-images',
    data: { alt: `${type} cover image` },
    file: {
      data: stream,
      name: filename,
    },
    disableVerification: true,
    req: {},
  })

  await payload.update({
    collection: type === 'episode' ? 'episodes' : 'shows',
    id,
    data: { cover: mediaDoc.id },
  })

  console.log(`✅ Linked ${filename} → ${type} ${id}`)
}

async function run() {
  const config = (await import(configPath)).default
  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config,
  })

  const files = await fs.readdir(tmpDir)
  for (const file of files) {
    try {
      await processFile(file)
    } catch (err) {
      console.error(`❌ Failed for ${file}:`, err.message)
    }
  }

  console.log('✅ All images imported')
  process.exit()
}

run()
