import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import payload from 'payload'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const run = async () => {
  const config = (await import(configPath)).default

  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    local: true,
    config,
  })

  const episodes = await payload.find({
    collection: 'episodes',
    depth: 2,
    limit: 9999,
  })

  const output: any[] = []
  let count = 0

  for (const episode of episodes.docs) {
    const genres = Array.isArray(episode.genres)
      ? episode.genres.map((g) => (typeof g === 'object' && g.name ? g.name : g))
      : []

    const hosts = Array.isArray(episode.hosts)
      ? episode.hosts.map((h) => (typeof h === 'object' && h.name ? h.name : h))
      : []

    output.push({
      id: episode.id,
      title: episode.title,
      genres,
      description: episode.description || '',
      cover: episode.cover || '',
      soundcloud: episode.soundcloud || '',
      scPermalink: episode.scPermalink || '',
      track_id: episode.track_id || null,
      publishedAt: episode.publishedAt || null,
      hosts,
      energy: episode.energy || null,
    })

    count++
  }

  const outputDir = path.join(__dirname, '../public/json')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  fs.writeFileSync(path.join(outputDir, 'episodes.json'), JSON.stringify(output, null, 2), 'utf-8')

  console.log(`✅ Exported ${count} episodes to public/json/episodes.json`)
  process.exit()
}

run()
