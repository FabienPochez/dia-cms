import { publicAccess } from '../access/publicAccess'
import { adminPanelOnly } from '../access/adminPanelOnly'
import type { CollectionConfig } from 'payload'
import { logUploadError } from '../utils/errorLogger'
import { buildEpisodeFilename } from '../utils/filenameFromEpisode'
import type { FileData, PayloadRequest } from 'payload'
import path from 'path'
import fs from 'fs/promises'

export const MediaTracks: CollectionConfig = {
  slug: 'media-tracks',
  access: {
    ...publicAccess,
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
  },
  admin: {
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  upload: {
    staticDir: '/srv/media/new',
    // Allow large uploads; nginx is set to 1G on upload subdomain
    maxFileSize: 1024 * 1024 * 1024, // 1 GB
    mimeTypes: [
      'audio/mpeg',
      'audio/ogg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/aiff',
      'audio/x-aiff',
      'audio/x-m4a',
      'audio/mp4',
    ],
    imageSizes: [],
    // No thumbnail generation for audio files (causes Sharp errors)
    // Allow large file uploads (up to 500MB)
    filesRequiredOnCreate: false,
  },
  fields: [
    {
      name: 'trackId',
      type: 'text',
      admin: {
        description: 'Unique track ID for LibreTime integration',
      },
    },
    // Add other metadata fields as needed (duration, bitrate, etc.)
  ],
  hooks: {
    beforeChange: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async ({ req, operation, data }: any) => {
        // Validate file upload
        try {
          if (operation === 'create' && !req.file) {
            const error = new Error('No file uploaded')
            await logUploadError({
              payload: req.payload,
              user: req.user,
              collection: 'media-tracks',
              operation: 'upload',
              errorType: 'file_upload',
              errorCode: 'NO_FILE_UPLOADED',
              errorMessage: 'No file was uploaded with the request',
              stackTrace: error.stack,
              httpStatus: 400,
              req,
            })
            throw error
          }

          // Custom filename generation with episodeId support (Payload v3 compatible)
          if (operation === 'create' && req.file) {
            // Store original filename before we change it (for afterChange physical rename)
            const originalFilenameBeforeHook = data.filename

            try {
              // Store original filename for physical rename in afterChange
              const originalFilename = data.filename

              // Try to get episodeId from query params ONLY (custom upload form context)
              let episodeId: string | null = null

              // Check query params (from custom upload form)
              if (req.query && 'episodeId' in req.query) {
                episodeId = req.query.episodeId as string
              }

              // Try parsing from URL if query doesn't work
              if (!episodeId && req.url) {
                const urlMatch = req.url.match(/[?&]episodeId=([^&]+)/)
                if (urlMatch) {
                  episodeId = decodeURIComponent(urlMatch[1])
                }
              }

              // ONLY proceed if episodeId is present (custom form upload)
              // Regular admin uploads will skip this entire block
              if (episodeId) {
                console.log('[MediaTracks] Custom form upload detected - episodeId:', episodeId)
                // Load episode and verify ownership
                const episode = await req.payload.findByID({
                  collection: 'episodes',
                  id: episodeId,
                  depth: 1,
                })

                if (episode) {
                  // LOG: Show what data is available at upload time
                  console.log('[MediaTracks] Episode data at upload time:', {
                    id: episode.id,
                    title: episode.title,
                    show: episode.show,
                    episodeNumber: episode.episodeNumber,
                    hosts: episode.hosts,
                    createdBy: episode.createdBy,
                    publishedStatus: episode.publishedStatus,
                  })

                  // Verify ownership: user must be owner, in hosts array, or staff/admin
                  const user = req.user as any
                  if (user) {
                    const isOwner = episode.createdBy === user.id
                    const isInHosts =
                      Array.isArray(episode.hosts) &&
                      episode.hosts.some((h: any) => {
                        const hostId = typeof h === 'string' ? h : h?.id
                        const userHostId = typeof user.host === 'string' ? user.host : user.host?.id
                        return hostId === userHostId
                      })
                    const isStaffOrAdmin = user.role === 'staff' || user.role === 'admin'

                    if (!isOwner && !isInHosts && !isStaffOrAdmin) {
                      console.error(
                        `[MediaTracks] User ${user.email} not authorized for episode ${episodeId}`,
                      )
                      throw new Error(
                        'Unauthorized: You do not have permission to upload files for this episode',
                      )
                    }
                  }

                  // Generate canonical filename with sanitized original name
                  const mimeType = req.file.mimetype || 'audio/mpeg'
                  const originalFilename = req.file.originalname || data.filename || 'audio'
                  let filename = buildEpisodeFilename(episode, mimeType, originalFilename, 120)

                  console.log(`[MediaTracks] Original filename: ${originalFilename}`)
                  console.log(
                    `[MediaTracks] Generated filename for episode ${episodeId}: ${filename}`,
                  )

                  // Check if a media-track with this filename already exists (from previous failed upload)
                  try {
                    const existingTracks = await req.payload.find({
                      collection: 'media-tracks',
                      where: {
                        filename: {
                          equals: filename,
                        },
                      },
                      limit: 1,
                    })

                    if (existingTracks.docs.length > 0) {
                      const existingTrack = existingTracks.docs[0]
                      console.warn(
                        `[MediaTracks] Found existing media-track with same filename: ${filename} (ID: ${existingTrack.id})`,
                      )
                      
                      // Check if it's linked to the same episode
                      if (episode.media && String(episode.media) === existingTrack.id) {
                        console.log(
                          `[MediaTracks] Existing track is linked to this episode - will be replaced by new upload`,
                        )
                      }
                      
                      // Delete the old media-track to allow the new upload
                      try {
                        await req.payload.delete({
                          collection: 'media-tracks',
                          id: existingTrack.id,
                        })
                        console.log(`[MediaTracks] Deleted old media-track: ${existingTrack.id}`)
                      } catch (deleteError) {
                        console.error(
                          `[MediaTracks] Failed to delete old media-track: ${deleteError}`,
                        )
                        // If deletion fails, add timestamp to filename to make it unique
                        const timestamp = Date.now()
                        const ext = path.extname(filename)
                        const base = filename.replace(ext, '')
                        filename = `${base}-${timestamp}${ext}`
                        console.log(
                          `[MediaTracks] Added timestamp to filename to avoid conflict: ${filename}`,
                        )
                      }
                    }
                  } catch (checkError) {
                    console.warn(
                      `[MediaTracks] Error checking for existing tracks: ${checkError}`,
                    )
                    // Continue with original filename
                  }

                  // Store original filename in req.context for afterChange hook
                  if (!req.context) req.context = {}
                  req.context._originalMediaFilename = originalFilenameBeforeHook
                  req.context._newMediaFilename = filename

                  data.filename = filename
                } else {
                  console.warn(
                    `[MediaTracks] Episode ${episodeId} not found, using default filename`,
                  )
                }
              }
            } catch (error) {
              console.error('[MediaTracks] Error generating filename:', error)
              // On error, continue with default filename (don't block upload)
            }
          }
        } catch (err) {
          // If not already logged, log the error
          const error = err instanceof Error ? err : new Error(String(err))
          if (!error.message?.includes('No file uploaded')) {
            await logUploadError({
              payload: req.payload,
              user: req.user,
              collection: 'media-tracks',
              operation,
              errorType: 'file_upload',
              errorCode: 'UPLOAD_ERROR',
              errorMessage: error.message || 'Unknown upload error',
              stackTrace: error.stack,
              httpStatus: 500,
              req,
            })
          }
          throw error
        }
        return data
      },
    ],
    afterChange: [
      // Physically rename file to match the generated filename (ONLY for custom upload form)
      async ({ doc, req, operation }: any) => {
        try {
          // Only run on create operations
          if (operation !== 'create') {
            return doc
          }

          // Only run if we have context from beforeChange (custom form upload)
          const originalFilename = req.context?._originalMediaFilename
          const newFilename = req.context?._newMediaFilename

          if (!originalFilename || !newFilename) {
            // Regular admin upload - no context set, skip entirely
            return doc
          }

          console.log(`[MediaTracks] afterChange - Physical file rename needed`)
          console.log(`[MediaTracks]   Original: ${originalFilename}`)
          console.log(`[MediaTracks]   New: ${newFilename}`)

          const staticDir = '/srv/media/new'

          const oldPath = path.join(staticDir, originalFilename)
          const newPath = path.join(staticDir, newFilename)

          // Rename the physical file
          await fs.rename(oldPath, newPath)
          console.log(`[MediaTracks] ✓ Physical file renamed: ${oldPath} → ${newPath}`)
        } catch (error) {
          console.error('[MediaTracks] Error in afterChange file rename:', error)
          // Don't throw - file is uploaded, just not renamed
        }

        return doc
      },
    ],
    // Disable image processing for audio files to prevent Sharp errors
    // This prevents Payload from trying to process audio files as images
    disableLocalStorage: false,
  },
}
