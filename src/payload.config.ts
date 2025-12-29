// storage-adapter-import-placeholder
// GLOBAL SUBPROCESS DIAGNOSTIC PATCH - MUST BE FIRST
import '@/server/lib/subprocessGlobalDiag'
// MIGRATION EVAL PROTECTION - MUST BE SECOND (before Payload loads)
import '@/server/lib/migrationEvalProtection'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
// import { apiKeyAccess } from '../src/access/apiKeyAccess' // unused

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { MediaImages } from './collections/MediaImages'
import { MediaTracks } from './collections/MediaTracks'
import Episodes from './collections/Episodes'
import Shows from './collections/Shows'
import Hosts from './collections/Hosts'
import Genres from './collections/Genres'
import UploadErrorLogs from './collections/UploadErrorLogs'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Build allowedOrigins from env var or use defaults
const corsOriginsEnv = process.env.PAYLOAD_CORS_ORIGINS
const allowedOrigins = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim())
  : [
      'https://dia-radio-app.vercel.app',
      'https://dia-web.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ]

//console.log('[payload] Booting with CORS allowedOrigins:', allowedOrigins)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      graphics: {
        Logo: './admin/components/Logo',
      },
      views: {
        planner: {
          Component: './admin/components/PlannerViewWithLibreTime',
          path: '/planner',
          exact: true,
        },
        uploadEpisode: {
          Component: './admin/components/EpisodeUploadView',
          path: '/upload-episode',
          exact: true,
        },
        uploadSuccess: {
          Component: './admin/components/UploadSuccessView',
          path: '/upload-success',
          exact: true,
        },
        errorLogs: {
          Component: './admin/components/ErrorLogsView',
          path: '/error-logs',
          exact: true,
        },
      },
      afterLogin: ['./admin/components/AfterLoginRedirect'],
      beforeNavLinks: ['./admin/components/CustomNavLinks'],
      afterDashboard: ['./admin/components/HostDashboardRedirect'],
    },
  },
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL || 'https://content.diaradio.live',

  collections: [
    Users,
    Media,
    MediaImages,
    MediaTracks,
    Episodes,
    Shows,
    Hosts,
    Genres,
    UploadErrorLogs,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  sharp,

  // Email configuration
  email: nodemailerAdapter({
    defaultFromAddress: 'no-reply@notify.diaradio.live',
    defaultFromName: 'DIA! Radio',
    // Log mock credentials in non-production for testing
    logMockCredentials: process.env.NODE_ENV !== 'production',
    // Nodemailer transportOptions
    transportOptions: {
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    },
  }),

  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
  media: {
    staticDir: '/srv/media',
    // optional: staticURL: '/media', to expose files via HTTP
  },

  // CORS with explicit configuration for Authorization header support
  // Required when frontend sends Authorization header (Bearer tokens)
  cors: {
    origins: allowedOrigins,
    credentials: true,
    headers: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  },

  // CSRF: relaxed in dev, strict in prod
  csrf: process.env.NODE_ENV === 'production' ? allowedOrigins : [],
})
