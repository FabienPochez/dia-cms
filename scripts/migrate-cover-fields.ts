import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const run = async () => {
  const config = (await import(configPath)).default

  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config, // ← THIS IS REQUIRED
  })

  const collections = ['episodes', 'shows']

  for (const collection of collections) {
    console.log(`🔄 Scanning "${collection}"...`)
    const { docs } = await payload.find({ collection, depth: 0, limit: 2000 })

    let updated = 0

    for (const doc of docs) {
      if (doc.cover && !doc.sqs_cover) {
        try {
          await payload.update({
            collection,
            id: doc.id,
            data: { sqs_cover: doc.cover },
          })
          updated++
        } catch (err) {
          console.error(`⚠️ Failed to update ${collection} ${doc.id}:`, err.message)
        }
      }
    }

    console.log(`✅ ${updated} documents updated in "${collection}"`)
  }

  process.exit()
}

run()
