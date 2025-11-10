import dotenv from 'dotenv'
dotenv.config()

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import payload from 'payload'
import mime from 'mime-types'

import { embedMetadata } from '../utils/embedMetadata.ts'
import { generateEpisodeFilename } from '../utils/generateEpisodeFilename.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const TRACKS_DIR = '/srv/media/tracks'
const COVERS_DIR = '/srv/media/covers'

const LIMIT = 100
const args = process.argv.slice(2)
const shouldDelete = args.includes('--delete')

async function run() {
  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET, local: true, config })

  const files = await fs.readdir(TRACKS_DIR)
  console.log(`🔍 Found ${files.length} files in /tracks`)

  let processed = 0

  for (const file of files) {
    if (processed >= LIMIT) break

    const match = file.match(/^track-(\d+)_.*\.(mp3|wav|aiff)$/)
    if (!match) {
      console.warn(`⏭️  Skipping invalid file: ${file}`)
      continue
    }

    const trackId = parseInt(match[1], 10)
    const fullPath = path.join(TRACKS_DIR, file)
    const mimeType = mime.lookup(file) || 'audio/mpeg'

    const { docs } = await payload.find({
      collection: 'episodes',
      where: { track_id: { equals: trackId } },
      limit: 1,
    })

    if (!docs.length) {
      console.warn(`❓ No episode found for track_id ${trackId}`)
      continue
    }

    const episode = docs[0]
    if (episode.media) {
      console.log(`⏭️  Episode ${episode.id} already has media linked. Skipping.`)
      continue
    }

    let show = null
    if (episode.show) {
      if (typeof episode.show === 'object' && episode.show.id) {
        show = episode.show
      } else {
        try {
          show = await payload.findByID({ collection: 'shows', id: episode.show })
        } catch {
          console.warn(`⚠️ Show ${episode.show} not found for episode ${episode.id}.`)
        }
      }
    }

    const newFilename = generateEpisodeFilename({
      id: episode.id,
      show,
      title: episode.title,
      episodeNumber: episode.episodeNumber,
    })

    const coverFile = typeof episode.cover === 'object' ? episode.cover.filename : null
    const coverPath = coverFile ? path.join(COVERS_DIR, coverFile) : null

    try {
      await embedMetadata({
        filePath: fullPath,
        title: episode.title,
        artist: Array.isArray(episode.hosts) ? episode.hosts.map(h => h.name).join(' & ') : '',
        genre: Array.isArray(episode.genres) ? episode.genres.join(', ') : '',
        comment: episode.description || '',
        coverUrl: coverPath,
      })
      console.log(`🎵 Embedded metadata into ${file}`)
    } catch (err) {
      console.warn(`⚠️ Failed to embed metadata in ${file}: ${err.message}`)
    }

    const buffer = await fs.readFile(fullPath)

    try {
      const uploaded = await payload.create({
        collection: 'media-tracks',
        data: { alt: `Track for episode ${episode.id}` },
        file: {
          data: buffer,
          mimetype: mimeType,
          name: newFilename,
        },
      })

      await payload.update({
        collection: 'episodes',
        id: episode.id,
        data: {
          media: uploaded.id,
          status: 'new',
        },
      })

      console.log(`✅ Uploaded & linked ${newFilename} → ${episode.id}`)

      if (shouldDelete) {
        await fs.unlink(fullPath)
        console.log(`🧹 Deleted ${file}`)
      }

      processed++
    } catch (err) {
      console.error(`❌ Failed for ${file}:`, err.message)
    }
  }

  console.log('🎉 Import complete')
  process.exit()
}

run()
