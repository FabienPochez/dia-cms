import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import fs from 'fs/promises'
import path from 'path'
import { fileTypeFromFile } from 'file-type'
import { fileURLToPath } from 'url'
import FormData from 'form-data'
import fetch from 'node-fetch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const tmpDir = '/srv/media/tmp'
const apiBase = 'http://payload:3000'

async function uploadViaRestApi(buffer: Buffer, filename: string, mimeType: string) {
  const form = new FormData()
  form.append('file', buffer, {
    filename,
    contentType: mimeType,
  })
  form.append('alt', `cover image for ${filename}`)

  const res = await fetch(`${apiBase}/api/media-images`, {
    method: 'POST',
    headers: {
      ...form.getHeaders(),
    },
    body: form,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Upload failed: ${res.status} ${err}`)
  }

  const json = await res.json()
  return json.doc || json
}

async function processFile(filename: string) {
  const match = filename.match(/^(episode|show)-([a-f0-9]+)\.(\w+)$/)
  if (!match) {
    console.warn(`⚠ Skipping unrecognized file: ${filename}`)
    return
  }

  const [, type, id] = match
  const filepath = path.join(tmpDir, filename)

  const buffer = await fs.readFile(filepath)
  const fileType = await fileTypeFromFile(filepath)
  if (!fileType) throw new Error(`Could not determine MIME type for ${filename}`)

  console.log(`Detected MIME for ${filename}: ${fileType.mime}`)

  const mediaDoc = await uploadViaRestApi(buffer, filename, fileType.mime)

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
    } catch (err: any) {
      console.error(`❌ Failed for ${file}:`, err.message)
    }
  }

  console.log('✅ All images imported')
  process.exit()
}

run()
