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

async function downloadAndSaveImage(id: string, url: string, prefix: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`)
    const buffer = await res.buffer()

    const type = await fileTypeFromBuffer(buffer)
    if (!type) throw new Error(`Could not determine file type for ${url}`)

    const filename = `${prefix}-${id}.${type.ext}`
    const filepath = path.join(tmpDir, filename)

    await fs.writeFile(filepath, buffer)
    console.log(`✅ Saved ${filename}`)
  } catch (err) {
    console.error(`❌ Failed to download for ${prefix} ${id}:`, err.message)
  }
}

async function processCollection(collectionName: string) {
  const { docs } = await payload.find({
    collection: collectionName,
    limit: 2000,
    depth: 0,
  })

  for (const doc of docs) {
    if (doc.sqs_cover) {
      await downloadAndSaveImage(doc.id, doc.sqs_cover, collectionName.slice(0, -1)) // "episodes" → "episode"
    }
  }
}

async function run() {
  const config = (await import(configPath)).default
  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config,
  })

  await fs.mkdir(tmpDir, { recursive: true })

  console.log('▶ Downloading episode covers...')
  await processCollection('episodes')

  console.log('▶ Downloading show covers...')
  await processCollection('shows')

  console.log('✅ All images downloaded')
  process.exit()
}

run()
