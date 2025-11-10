// storage-adapter-import-placeholder
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { apiKeyAccess } from '../src/access/apiKeyAccess'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { MediaImages } from './collections/MediaImages'
import { MediaTracks } from './collections/MediaTracks'
import { MediaNew } from './collections/MediaNew'
import Episodes from './collections/Episodes'
import Shows from './collections/Shows'
import Hosts from './collections/Hosts'
import Genres from './collections/Genres'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
  user: Users.slug,
  access: ({ req }) => req.user?.role === 'admin',
  importMap: {
    baseDir: path.resolve(dirname),
  },
},
  //auth: {
  //secret: process.env.PAYLOAD_SECRET,
  //strategies: [
    //{
      //name: 'api-key',
      //type: 'apiKey',
      //key: process.env.PAYLOAD_API_KEY,
      //header: 'Authorization',
      //access: apiKeyAccess,
    //},
  //],
//},
auth: {
  useAPIKey: false,
  cookies: {
    secure: true,
    sameSite: 'none', // for SPA / cross-origin
    domain: '.diaradio.live', // match your API domain
  },
  refresh: true, // make sure refresh endpoint is enabled
}

  collections: [Users, Media, MediaImages, MediaTracks, Episodes, Shows, Hosts, Genres],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
  media: {
  staticDir: '/srv/media',
  // optional: staticURL: '/media', to expose files via HTTP
},
serverURL: process.env.SERVER_URL || 'https://content.diaradio.live',
  cors: [
    'https://dia-radio-app.vercel.app/',
    'http://localhost:3000', // for local development
    // add other domains if needed
  ],
})
