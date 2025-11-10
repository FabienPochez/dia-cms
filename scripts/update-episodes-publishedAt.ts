import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const inputPath = path.resolve(__dirname, 'input/episodes-dates.json')

async function run() {
  const configPath = path.resolve(__dirname, '../src/payload.config.ts')
  const config = (await import(configPath)).default

  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config,
  })

  const raw = await fs.readFile(inputPath, 'utf-8')
  const updates = JSON.parse(raw)

  let success = 0
  let failed = 0

  for (const { id, publishedAt } of updates) {
    try {
      console.log(`Updating ${id} → ${publishedAt} (${typeof publishedAt})`)  
      await payload.update({
        collection: 'episodes',
        id,
        data: { publishedAt },
        overrideAccess: true,
    })
      success++
    } catch (err: any) {
      console.error(`❌ Failed to update ${id}: ${err.message}`)
      failed++
    }
  }

  console.log(`✅ Updated ${success} episodes`)
  if (failed) console.log(`❌ ${failed} updates failed`)
  process.exit()
}

run()
