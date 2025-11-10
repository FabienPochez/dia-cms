import 'dotenv/config'
import payload from 'payload'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const configPath = path.resolve(__dirname, '../src/payload.config.ts')

const run = async () => {
  const config = (await import(configPath)).default

  await payload.init({
    config,
    secret: process.env.PAYLOAD_SECRET || '',
    local: true,
  })

  const email = 'iepa@diaradio.live'

  // Delete existing user
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    overrideAccess: true,
  })

  if (existing.docs.length) {
    await payload.delete({
      collection: 'users',
      id: existing.docs[0].id,
      overrideAccess: true,
    })
    console.log(`🗑 Deleted old user: ${email}`)
  }

  // Recreate with working password
  const newUser = await payload.create({
    collection: 'users',
    data: {
      email,
      password: 'NewSecurePassword123',
      role: 'admin', // or whatever role you need
    },
  })

  console.log('✅ Recreated user with working password:', newUser.email)
  process.exit()
}

run()
