import { CollectionConfig } from 'payload/types'
import { publicAccess } from '../access/publicAccess'
import {
  episodesHostAccess,
  hostCanCreate,
  adminAndStaff,
  hideFromHosts,
  readOnlyFieldForHosts,
} from '../access/hostAccess'
import { adminPanelOnly } from '../access/adminPanelOnly'
import type { Field } from 'payload'
import slugify from 'slugify'
import { sendEpisodeSubmittedNotification } from '../utils/emailNotifications'
import { logUploadError, parseErrorCode, extractValidationContext } from '../utils/errorLogger'
import { buildMoodFilters } from '../utils/buildMoodFilters'

const Episodes: CollectionConfig = {
  slug: 'episodes',
  labels: {
    singular: { en: 'Episode' },
    plural: { en: 'Episodes' },
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: [
      'title',
      'episodeNumber',
      'publishedAt',
      'show',
      'energy',
      'airStatus',
      'scheduledAt',
      'scheduledEnd',
    ],
    sort: 'episodeNumber',
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  access: {
    read: () => true, // Public API access (needed for frontend app and host access to drafts)
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
    create: hostCanCreate, // Hosts can create episodes (via upload form)
    update: ({ req }) => {
      const user = req.user as any
      if (!user) return false
      // Admin/staff can update all episodes
      if (user.role === 'admin' || user.role === 'staff') return true
      // Hosts can update episodes where they're linked (simpler approach without OR query)
      if (user.role === 'host' && user.host) {
        const hostId = typeof user.host === 'string' ? user.host : user.host.id
        return {
          hosts: {
            contains: hostId,
          },
        }
      }
      return false
    },
    delete: adminAndStaff, // Only admin/staff can delete
  },

  indexes: [
    {
      fields: ['scheduledAt', 'scheduledEnd'],
      options: { name: 'idx_schedStart_end' },
    },
    {
      fields: ['mood'],
      options: { name: 'idx_mood' },
    },
    {
      fields: ['tone'],
      options: { name: 'idx_tone' },
    },
    {
      fields: ['energy'],
      options: { name: 'idx_energy' },
    },
  ],

  fields: [
    // --- UI: Tabs only (no `name` => no API nesting) ---
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Editorial',
          fields: [
            {
              name: 'title',
              type: 'text',
              label: 'Episode Title (will use show title if not set)',
            },
            {
              name: 'show',
              type: 'relationship',
              relationTo: 'shows',
              // Allow hosts to set show during upload (they can only select their shows anyway)
            },
            {
              name: 'hosts',
              type: 'relationship',
              relationTo: 'hosts',
              hasMany: true,
              admin: { allowCreate: true },
            },
            { name: 'description', type: 'textarea' },
            {
              name: 'tracklistRaw',
              type: 'textarea',
              label: 'Tracklist',
              admin: {
                description: 'Paste your tracklist here (one track per line)',
                placeholder: 'Artist - Title\nArtist - Title\n...',
              },
            },
            {
              name: 'cover',
              label: 'Cover Image (will use show cover if not set)',
              type: 'upload',
              relationTo: 'media-images',
            },
            {
              name: 'publishedAt',
              type: 'date',
              label: 'Published Date',
              required: true,
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
            // Optional editorial fields
            {
              name: 'duration',
              type: 'number',
              label: 'Duration (seconds)',
              required: false,
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
            {
              name: 'roundedDuration',
              type: 'number',
              label: 'Rounded duration (minutes)',
              admin: { position: 'sidebar' },
              access: {
                update: readOnlyFieldForHosts,
              },
            },
            { name: 'energy', type: 'select', options: ['low', 'medium', 'high'] },
            {
              name: 'mood',
              type: 'select',
              label: 'Mood',
              options: [
                { label: '-- Select Mood --', value: '' },
                { label: 'Sedative', value: 'sedative' },
                { label: 'Cozy', value: 'cozy' },
                { label: 'Groovy', value: 'groovy' },
                { label: 'Club', value: 'club' },
                { label: 'Adrenaline', value: 'adrenaline' },
                { label: 'Hard', value: 'hard' },
                { label: 'Psychedelic', value: 'psychedelic' },
                { label: 'Leftfield', value: 'leftfield' },
                { label: 'Research', value: 'research' },
              ],
            },
            {
              name: 'tone',
              type: 'select',
              label: 'Tone',
              options: [
                { label: 'Dark', value: 'dark' },
                { label: 'Bright', value: 'bright' },
                { label: 'Melancholic', value: 'melancholic' },
                { label: 'Dreamy', value: 'dreamy' },
                { label: 'Nostalgic', value: 'nostalgic' },
                { label: 'Neutral', value: 'neutral' },
              ],
            },
            { name: 'genres', type: 'relationship', relationTo: 'genres', hasMany: true },
          ],
        },
        {
          label: 'Status',
          fields: [
            {
              name: 'publishedStatus',
              type: 'select',
              label: 'Publication Status',
              options: [
                { label: 'Draft', value: 'draft' },
                { label: 'Submitted', value: 'submitted' },
                { label: 'Published', value: 'published' },
                { label: 'Scheduled', value: 'scheduled' },
              ],
              defaultValue: 'draft',
              required: true,
              // Allow hosts to set status to 'submitted' during upload
            },
            {
              name: 'pendingReview',
              type: 'checkbox',
              label: 'Pending Review',
              defaultValue: false,
              admin: {
                description: 'Episode uploaded by host, awaiting admin/staff approval',
                position: 'sidebar',
              },
              // Allow hosts to set pendingReview during upload
            },
            {
              name: 'visibility',
              type: 'select',
              label: 'Visibility',
              options: [
                { label: 'Public', value: 'public' },
                { label: 'Unlisted', value: 'unlisted' },
              ],
              required: false,
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
            {
              name: 'diaPick',
              type: 'checkbox',
              label: 'Homepage Featured (DIA! Pick)',
              defaultValue: false,
              admin: { description: 'Mark this episode as a DIA! selection.' },
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
            {
              name: 'type',
              type: 'select',
              label: 'Episode Type (inherits from show if empty)',
              hasMany: true,
              required: false,
              options: [
                { value: 'Résidents', label: 'Résidents' },
                { value: 'Guests', label: 'Guests' },
                { value: 'Live', label: 'Live' },
                { value: 'Hors Murs', label: 'Hors Murs' },
                { value: 'Podcasts', label: 'Podcasts' },
                { value: 'One off', label: 'One off' },
                { value: 'Compositions Sonores', label: 'Compositions Sonores' },
                { value: 'Retransmissions', label: 'Retransmissions' },
                { value: 'Takeover', label: 'Takeover' },
              ],
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
            {
              name: 'airState',
              type: 'select',
              label: 'Air State (inherits from show if empty)',
              options: [
                { label: 'Live', value: 'live' },
                { label: 'Pre-Recorded', value: 'preRecorded' },
              ],
              required: false,
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
            {
              name: 'showStatus',
              type: 'select',
              label: 'Show Status (inherited)',
              options: [
                { label: 'Active', value: 'active' },
                { label: 'Archived', value: 'archived' },
              ],
              admin: { readOnly: true },
              required: false,
              access: {
                update: hideFromHosts, // Hosts can read, but cannot modify
              },
            },
          ],
        },
        {
          label: 'Scheduling',
          fields: [
            {
              name: 'scheduledAt',
              type: 'date',
              label: 'Scheduled Start Time',
              required: false,
              index: true,
              admin: {
                description: 'When this episode is scheduled to air',
                position: 'sidebar',
                // Note: access.update blocks hosts from modifying (function-based hidden doesn't work in v3)
              },
              access: {
                update: hideFromHosts, // Hosts can't modify, but can query (for frontend app)
              },
            },
            {
              name: 'scheduledEnd',
              type: 'date',
              label: 'Scheduled End Time',
              required: false,
              index: true,
              admin: {
                description: 'When this episode is scheduled to end',
                position: 'sidebar',
                // Note: access.update blocks hosts from modifying (function-based hidden doesn't work in v3)
              },
              access: {
                update: hideFromHosts, // Hosts can't modify, but can query (for frontend app)
              },
            },
            {
              name: 'airStatus',
              type: 'select',
              label: 'Air Status',
              options: [
                { label: 'Draft', value: 'draft' },
                { label: 'Queued', value: 'queued' },
                { label: 'Scheduled', value: 'scheduled' },
                { label: 'Airing', value: 'airing' },
                { label: 'Aired', value: 'aired' },
                { label: 'Failed', value: 'failed' },
              ],
              defaultValue: 'draft',
              required: true,
              admin: {
                // Note: access.update blocks hosts from modifying (function-based hidden doesn't work in v3)
              },
              access: {
                update: hideFromHosts, // Hosts can't modify, but can query (for frontend app)
              },
            },
          ],
        },
        {
          label: 'Audio / Tech',
          fields: [
            {
              name: 'media',
              type: 'upload',
              relationTo: 'media-tracks',
              // Allow hosts to upload media for their episodes
            },
            {
              name: 'libretimeTrackId',
              type: 'text',
              label: 'LibreTime Track ID',
              admin: {
                description: 'ID from LibreTime system for this track',
              },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'libretimeFilepathRelative',
              type: 'text',
              label: 'LibreTime File Path (Relative)',
              admin: {
                description:
                  'Relative file path in LibreTime library (e.g., imported/1/filename.mp3)',
              },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'hasArchiveFile',
              type: 'checkbox',
              label: 'Has Archive File',
              defaultValue: false,
              admin: {
                description: 'Whether this episode has been archived to file system',
              },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'archiveFilePath',
              type: 'text',
              label: 'Archive File Path',
              admin: {
                description: 'Path to archived file',
              },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'libretimeInstanceId',
              type: 'number',
              label: 'LibreTime Instance ID',
              admin: {
                description: 'ID of the show instance in LibreTime',
              },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'libretimePlayoutId',
              type: 'number',
              label: 'LibreTime Playout ID',
              admin: {
                description: 'ID of the scheduled playout in LibreTime',
              },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'soundcloud',
              type: 'text',
              label: 'SoundCloud URL',
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'scPermalink',
              type: 'text',
              label: 'SC Permalink',
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            { name: 'scSlug', type: 'text', label: 'SC Slug', access: { update: hideFromHosts } },
            { name: 'track_id', type: 'number', access: { update: hideFromHosts } },
            {
              name: 'mp3_url',
              type: 'text',
              label: 'Resolved MP3 URL',
              required: false,
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            { name: 'bitrate', type: 'number', required: false, access: { update: hideFromHosts } },
            {
              name: 'realDuration',
              type: 'number',
              label: 'Real duration (seconds)',
              required: false,
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'waveform',
              type: 'text',
              label: 'Waveform JSON (stringified)',
              required: false,
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'coverExternal',
              type: 'text',
              label: 'External Cover URL',
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
          ],
        },
        {
          label: 'Metrics',
          fields: [
            {
              name: 'plays',
              type: 'number',
              defaultValue: 0,
              admin: { readOnly: true },
              access: { update: () => false },
            },
            {
              name: 'likes',
              type: 'number',
              defaultValue: 0,
              admin: { readOnly: true },
              access: { update: () => false },
            },
            {
              name: 'airplayHours',
              type: 'number',
              defaultValue: 0,
              admin: { readOnly: true },
              access: { update: () => false },
            },
            {
              name: 'firstAiredAt',
              type: 'date',
              admin: { readOnly: true },
              access: { update: () => false },
            },
            {
              name: 'lastAiredAt',
              type: 'date',
              label: 'Last Aired At',
              admin: { readOnly: true },
              access: { update: () => false },
            },
            {
              name: 'airCount',
              type: 'number',
              defaultValue: 0,
              admin: { readOnly: true },
              access: { update: () => false },
            },
          ],
        },
        {
          label: 'Admin',
          fields: [
            {
              name: 'adminNotes',
              type: 'textarea',
              required: false,
              admin: { readOnly: false },
              access: { update: hideFromHosts }, // Hosts can read, but cannot modify
            },
            {
              name: 'categorizedBy',
              type: 'text',
              label: 'Categorized By',
              admin: {
                readOnly: true,
                position: 'sidebar',
                description: 'User who completed classification',
              },
              access: {
                update: () => false, // Read-only, set by system
              },
            },
            {
              name: 'categorizedAt',
              type: 'date',
              label: 'Categorized At',
              admin: {
                readOnly: true,
                position: 'sidebar',
                description: 'When classification was completed',
              },
              access: {
                update: () => false, // Read-only, set by system
              },
            },
            // createdAt/updatedAt are built-in meta and show in the sidebar.
          ],
        },
      ],
    },
    // Essential sidebar fields only
    {
      name: 'episodeNumber',
      type: 'text',
      label: 'Episode Number',
      admin: { position: 'sidebar' },
      access: { update: readOnlyFieldForHosts },
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      admin: { position: 'sidebar' },
      // Allow slug to be auto-generated during host uploads
    },
    {
      name: 'realDurationDisplay',
      type: 'text',
      label: 'Real duration (h:mm:ss)',
      admin: { position: 'sidebar', readOnly: true }, // Always read-only
      access: { update: () => false },
    },
    {
      name: 'audioPlayer',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: './admin/components/AudioPlayerField',
        },
      },
    },
  ],
  hooks: {
    beforeOperation: [
      // Server-side mood/tone/energy filtering via query params
      ({ args, operation, req }: any) => {
        // Only process read operations with query params
        if (operation !== 'read' || !req?.query) {
          return args
        }

        // Build mood filters from query params
        const moodFilters = buildMoodFilters(req.query)

        // If no filters, return args unchanged
        if (!moodFilters) {
          return args
        }

        // Merge mood filters with existing where clause
        // Ensure args.where exists
        if (!args.where) {
          args.where = {}
        }

        // If where already has conditions, combine using 'and'
        // Otherwise, merge moodFilters directly into where
        const existingWhereKeys = Object.keys(args.where).filter(
          (key) => key !== 'and' && key !== 'or',
        )
        const hasExistingConditions =
          existingWhereKeys.length > 0 || args.where.and || args.where.or

        if (hasExistingConditions) {
          args.where = {
            and: [args.where, moodFilters],
          }
        } else {
          // Merge moodFilters directly into where (they're already structured correctly)
          Object.assign(args.where, moodFilters)
        }

        return args
      },
    ],
    beforeChange: [
      // Audio validation hook - validate file specs when media is added/changed
      async ({ data, originalDoc, req, operation: _operation }: any) => {
        // Only validate if media and roundedDuration are present
        if (!data.media || !data.roundedDuration) {
          return data
        }

        // Check if media changed (for updates) or is being set (for creates)
        const mediaChanged =
          _operation === 'create' ||
          (originalDoc?.media && String(originalDoc.media) !== String(data.media))

        if (!mediaChanged) {
          return data
        }

        console.log('[EPISODE_VALIDATION] Validating audio file for episode')

        try {
          // Dynamically import validation utilities (server-side only)
          const { validateAudioFile, getMediaTrackFilePath } = await import(
            '../utils/audioValidation'
          )

          // Get file path from media-tracks record
          const mediaId = typeof data.media === 'string' ? data.media : data.media.id
          const filePath = await getMediaTrackFilePath(mediaId, req.payload)

          if (!filePath) {
            throw new Error('Could not find audio file for validation')
          }

          // Validate audio file
          const validationResult = await validateAudioFile(filePath, data.roundedDuration)

          if (!validationResult.valid) {
            const errorMessage = `Audio validation failed: ${validationResult.error}`
            const error = new Error(errorMessage)

            // Log the error with user information
            await logUploadError({
              payload: req.payload,
              user: req.user,
              collection: 'episodes',
              operation: _operation,
              errorType: 'audio_quality',
              errorCode: parseErrorCode(errorMessage),
              errorMessage,
              stackTrace: error.stack,
              context: {
                ...extractValidationContext(error, data),
                validationResult,
                filePath,
              },
              httpStatus: 400,
              req,
            })

            throw error
          }

          console.log('[EPISODE_VALIDATION] ✅ Audio validation passed')

          // Update episode with extracted metadata if available
          if (validationResult.metadata) {
            data.realDuration = validationResult.metadata.durationSec
            data.duration = validationResult.metadata.durationSec
            data.bitrate = validationResult.metadata.bitrateKbps
          }
        } catch (error) {
          console.error('[EPISODE_VALIDATION] Validation failed:', error)

          // Log any other unexpected errors
          if (!error.message?.includes('Audio validation failed')) {
            await logUploadError({
              payload: req.payload,
              user: req.user,
              collection: 'episodes',
              operation: _operation,
              errorType: 'validation',
              errorCode: parseErrorCode(error.message) || 'UNEXPECTED_ERROR',
              errorMessage: error.message || 'Unknown error during validation',
              stackTrace: error.stack,
              context: extractValidationContext(error, data),
              httpStatus: 500,
              req,
            })
          }

          throw error // This will prevent the episode from being saved
        }

        return data
      },

      // Classification tracking hook
      async ({ data, originalDoc, req, operation: _operation }: any) => {
        // Only process updates to published episodes
        if (_operation === 'update' && data.publishedStatus === 'published') {
          const wasUnclassified =
            !originalDoc ||
            !originalDoc.genres?.length ||
            originalDoc.genres.length < 2 ||
            !originalDoc.energy ||
            ((!originalDoc.mood || originalDoc.mood === '') &&
              (!originalDoc.tone || originalDoc.tone === ''))

          const isNowClassified =
            data.genres?.length >= 2 &&
            data.energy &&
            ((data.mood && data.mood !== '') || (data.tone && data.tone !== ''))

          // Only set if transitioning from unclassified to classified and not already set
          if (wasUnclassified && isNowClassified && !data.categorizedBy) {
            data.categorizedBy = req.user?.email || null // Store user email for display
            data.categorizedAt = new Date()
          }
        }
        return data
      },
      // Migration hook: convert existing user IDs to emails
      async ({ data, req, operation: _operation }: any) => {
        // If categorizedBy exists and looks like a user ID (not an email), convert it
        if (data.categorizedBy && !data.categorizedBy.includes('@')) {
          try {
            const user = await req.payload.findByID({
              collection: 'users',
              id: data.categorizedBy,
            })
            if (user?.email) {
              data.categorizedBy = user.email
            }
          } catch (error) {
            // If user not found, leave as is
            console.log('User not found for ID:', data.categorizedBy)
          }
        }
        return data
      },
    ],
    beforeValidate: [
      // Auto-fill title from show if empty
      async ({ data, req }) => {
        if (data.show && !data.title) {
          const show = await req.payload.findByID({
            collection: 'shows',
            id: data.show,
          })

          let hostNames: string[] = []

          if (Array.isArray(data.hosts) && data.hosts.length > 0) {
            const hostIds = data.hosts.map((h) => (typeof h === 'string' ? h : h.id))

            const hostDocs = await req.payload.find({
              collection: 'hosts',
              where: {
                id: { in: hostIds },
              },
              limit: hostIds.length,
            })

            hostNames = hostDocs.docs.map((h) => h.name).filter(Boolean)
          }

          if (show?.title) {
            data.title =
              hostNames.length > 0 ? `${show.title} w/ ${hostNames.join(' & ')}` : show.title
          }
        }

        return data
      },

      // Inherit show status, type, and airState if episode fields are empty
      async ({ data, req, operation }) => {
        if (data.show) {
          const show = await req.payload.findByID({
            collection: 'shows',
            id: data.show,
          })

          if (show) {
            // Inherit status from show
            if (!data.showStatus) {
              data.showStatus = show.status
            }

            // Inherit type from show if episode type is empty
            if (!data.type && show.show_type) {
              data.type = show.show_type
            }

            // Inherit airState from show if episode airState is empty
            if (!data.airState && show.airState) {
              data.airState = show.airState
            }
          }
        }

        return data
      },

      // Auto-increment episode number for a show
      async ({ data, req, operation, originalDoc }) => {
        // Run on CREATE or UPDATE when show is set and no episodeNumber exists
        const shouldAutoIncrement =
          data.show &&
          !data.episodeNumber &&
          !originalDoc?.episodeNumber &&
          (operation === 'create' || operation === 'update')

        if (shouldAutoIncrement) {
          const episodes = await req.payload.find({
            collection: 'episodes',
            where: {
              show: {
                equals: data.show,
              },
            },
            sort: '-episodeNumber',
            limit: 1,
          })

          const last = episodes.docs[0]
          const lastNumber =
            typeof last?.episodeNumber === 'string'
              ? parseInt(last.episodeNumber, 10)
              : last?.episodeNumber

          const nextNumber = Number.isFinite(lastNumber) ? lastNumber + 1 : 1
          data.episodeNumber = String(nextNumber).padStart(3, '0')

          console.log(
            `[Episodes] Auto-incremented episodeNumber to ${data.episodeNumber} for show ${data.show}`,
          )
        }

        return data
      },

      // Inherit show cover if episode cover not set
      async ({ data, req, operation }) => {
        if (operation === 'create' && data.show && !data.cover) {
          const show = await req.payload.findByID({
            collection: 'shows',
            id: data.show,
          })

          if (show?.cover) {
            if (typeof show.cover === 'object') {
              data.cover = typeof show.cover === 'object' ? show.cover.id : show.cover
            } else {
              data.cover = show.cover // fallback to just ID if it's not populated
            }
          }
        }

        return data
      },

      // Auto-generate slug from title + episode number (standard format)
      ({ data, id, originalDoc, operation, context }) => {
        // Skip slug regeneration if maintenance script requests it
        if (context?.skipSlugRegeneration && operation === 'update') {
          return data
        }

        // Always regenerate slug if title or episodeNumber changes
        const shouldRegenerateSlug =
          data.title || data.episodeNumber || (operation === 'create' && !data.slug)

        if (shouldRegenerateSlug || !data.slug) {
          const parts = []

          // Use provided title or fall back to originalDoc title
          const title = data.title || originalDoc?.title
          const epNumber = data.episodeNumber || originalDoc?.episodeNumber

          if (title) {
            parts.push(title)
          }
          if (epNumber) {
            parts.push(epNumber)
          }

          // If no parts available, use temporary slug for drafts
          if (parts.length === 0) {
            if (id) {
              // Update operation - use existing ID
              parts.push(id)
            } else if (originalDoc?.id) {
              parts.push(originalDoc.id)
            } else if (operation === 'create') {
              // Create operation - use temporary slug
              parts.push(`draft-${Date.now()}`)
            }
          }

          if (parts.length > 0) {
            const raw = parts.join(' ')
            data.slug = slugify(raw, {
              lower: true,
              strict: true,
            })
          }
        }

        return data
      },
    ],
    afterChange: [
      // Email notification when episode is submitted for review
      async ({ doc, req, operation }: any) => {
        // Only notify on create or when publishedStatus changes to 'submitted'
        if (doc.publishedStatus !== 'submitted' || !doc.pendingReview) {
          return
        }

        try {
          // Get show and host information
          let showTitle = 'Unknown Show'
          let hostName = 'Unknown Host'

          if (doc.show) {
            const show = await req.payload.findByID({
              collection: 'shows',
              id: typeof doc.show === 'string' ? doc.show : doc.show.id,
            })
            showTitle = show?.title || showTitle
          }

          if (doc.hosts && doc.hosts.length > 0) {
            const hostId = typeof doc.hosts[0] === 'string' ? doc.hosts[0] : doc.hosts[0].id
            const host = await req.payload.findByID({
              collection: 'hosts',
              id: hostId,
            })
            hostName = host?.name || hostName
          }

          // Send notification
          await sendEpisodeSubmittedNotification(req.payload, {
            hostName,
            showTitle,
            episodeTitle: doc.title,
            episodeURL: `${req.payload.config.serverURL}/admin/collections/episodes/${doc.id}`,
          })
        } catch (error) {
          console.error('[EPISODE_NOTIFICATION] Failed to send notification:', error)
          // Don't throw - we don't want email failures to break episode creation
        }
      },
    ],
  },
}

export const showField: Field = {
  name: 'show',
  type: 'relationship',
  relationTo: 'shows',
  required: true, // optional but recommended
}

export default Episodes
