import dotenv from 'dotenv'
import slugify from 'slugify'
dotenv.config()

import fs from 'fs/promises'
import path from 'path'
import payload from 'payload'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const inputPath = path.resolve(__dirname, 'input/soundcloud-tracks.json')
const LIMIT = 500

async function run() {
  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET, local: true, config })

  const raw = await fs.readFile(inputPath, 'utf-8')
  const tracks = JSON.parse(raw)
  console.log(`📥 Loaded ${tracks.length} tracks`)

  let created = 0

  for (const track of tracks) {
    if (created >= LIMIT) break

    const existing = await payload.find({
      collection: 'episodes',
      where: { track_id: { equals: track.track_id } },
      limit: 1,
    })

    if (existing.docs.length) {
      console.log(`⏭️ Episode already exists for track_id ${track.track_id}`)
      continue
    }

    if (!track.soundcloud) {
      console.warn(`⚠️ Skipping track ${track.track_id} — missing soundcloud URL`)
      continue
    }

    let coverExternal = track.cover || null
    if (coverExternal && coverExternal.includes('-large')) {
      coverExternal = coverExternal.replace('-large', '-t500x500')
    }

    const newEpisode = {
      title: track.title || 'Untitled',
      description: track.description || '',
      genres: track.genre ? [track.genre] : [],
      coverExternal,
      soundcloud: track.soundcloud,
      scPermalink: new URL(track.soundcloud).pathname,
      track_id: track.track_id,
      publishedAt: track.publishedAt,
      hosts: [],
      slug: slugify(`${track.title}-${track.track_id}`, { lower: true, strict: true }),

    }

    try {
      const createdDoc = await payload.create({
        collection: 'episodes',
        data: newEpisode,
      })
      console.log(`✅ Created episode ${createdDoc.id} from track ${track.track_id}`)
      created++
    } catch (err) {
      console.error(`❌ Failed to create episode from track ${track.track_id}:`, err.message)
    }
  }

  console.log(`🎉 Done. Created ${created} new episodes.`)
  process.exit()
}

run()
