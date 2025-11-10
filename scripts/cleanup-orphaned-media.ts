import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

async function run() {
  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET, local: true, config })

  const { docs: episodes } = await payload.find({
    collection: 'episodes',
    limit: 1000,
  })

  let cleaned = 0

  for (const ep of episodes) {
    if (!ep.media) continue

    try {
      await payload.findByID({ collection: 'media-tracks', id: ep.media })
    } catch (err) {
      console.log(`🧹 Orphaned media found in episode ${ep.id}, unlinking...`)
      await payload.update({
        collection: 'episodes',
        id: ep.id,
        data: { media: null },
      })
      cleaned++
    }
  }

  console.log(`✅ Cleanup complete. ${cleaned} episodes unlinked.`)
  process.exit()
}

run()
