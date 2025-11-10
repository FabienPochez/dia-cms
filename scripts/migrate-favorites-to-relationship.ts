// scripts/migrate-favorites-to-relationship.ts
import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Adjust if your config lives elsewhere in the container
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

async function run() {
  const config = (await import(configPath)).default

  await payload.init({
    secret: process.env.PAYLOAD_SECRET!,
    local: true,
    config, // required so scripts can boot Payload
  })

  let page = 1
  let totalUpdated = 0

  for (;;) {
    const res = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 100,
      page,
    })
    if (!res.docs.length) break

    for (const u of res.docs) {
      const fav = Array.isArray((u as any).favorites) ? (u as any).favorites : []
      const ids = fav
        .map((f: any) => {
          if (typeof f === 'string') return f
          const ep = f?.episode
          if (typeof ep === 'string') return ep
          if (ep && typeof ep === 'object') return ep.id ?? ep._id ?? null
          return null
        })
        .filter(Boolean)

      // If your schema is now: relationship hasMany, it expects array of IDs
      const needsUpdate =
        fav.length !== ids.length ||
        fav.some((f: any) => typeof f !== 'string') // had objects previously

      if (needsUpdate) {
        await payload.update({
          collection: 'users',
          id: u.id,
          data: { favorites: ids },
          overrideAccess: true,
        })
        totalUpdated++
        console.log(`✅ fixed favorites for user ${u.id} (${ids.length} ids)`)
      }
    }

    if (!res.hasNextPage) break
    page++
  }

  console.log(`Done. Users updated: ${totalUpdated}`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
