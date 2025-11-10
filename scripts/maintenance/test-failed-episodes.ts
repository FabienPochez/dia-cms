import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../../src/payload.config.ts')

const failedIds = [
  '6882659bba767f41743caaff',
  '6882659bba767f41743caa87',
  '6882659bba767f41743caa73',
  '6882659bba767f41743caa6b',
  '6882659bba767f41743caa57',
  '6882659bba767f41743ca9f3',
  '6882659bba767f41743ca9db',
  '6882659bba767f41743ca9cb',
  '6882659bba767f41743ca9b3',
  '6882659bba767f41743ca9af',
]

async function run() {
  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET!, local: true, config })

  console.log('Testing slug preservation on failed episodes...\n')

  for (const id of failedIds) {
    const ep = await payload.findByID({ collection: 'episodes', id, depth: 0 })
    console.log(`\nEpisode: ${ep.title}`)
    console.log(`Current slug: ${ep.slug}`)
    console.log(`Episode #: ${ep.episodeNumber || 'none'}`)
    
    // Try a simple title change with slug preservation
    const newTitle = ep.title.replace(' - ', ' w/ ').replace(/\([^)]+\)/, '').trim()
    console.log(`Would change to: ${newTitle}`)
    
    try {
      await payload.update({
        collection: 'episodes',
        id: ep.id,
        data: {
          title: newTitle,
          slug: ep.slug, // Preserve existing slug
        },
        overrideAccess: true,
      })
      console.log('✅ Success!')
    } catch (error: any) {
      console.log('❌ Failed:', error.message)
    }
  }

  process.exit(0)
}

run()

