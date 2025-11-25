import type { CollectionConfig } from 'payload'
import { publicAccess } from '../access/publicAccess'
import { adminPanelOnly } from '../access/adminPanelOnly'
import { buildCoverFilename } from '../utils/filenameFromEpisode'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'

export const MediaImages: CollectionConfig = {
  slug: 'media-images',
  access: {
    ...publicAccess,
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
  },
  admin: {
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  upload: {
    staticDir: '/srv/media/covers',
    mimeTypes: ['image/*'], // allow all image types
  },
  hooks: {
    beforeChange: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async ({ req, operation, data }: any) => {
        // Custom filename generation with episodeId support (Payload v3 compatible)
        if (operation === 'create' && req.file) {
          try {
            // Try to get episodeId from FormData first, then query params
            let episodeId: string | null = null
            
            // Check FormData (most secure)
            if (req.body && typeof req.body === 'object' && 'episodeId' in req.body) {
              episodeId = req.body.episodeId as string
            }
            
            // Fallback to query params
            if (!episodeId && req.query && 'episodeId' in req.query) {
              episodeId = req.query.episodeId as string
            }
            
            // If episodeId provided, generate canonical filename
            if (episodeId) {
              // Load episode and verify ownership
              const episode = await req.payload.findByID({
                collection: 'episodes',
                id: episodeId,
                depth: 0,
              })
              
              if (episode) {
                // Verify ownership: user must be owner, in hosts array, or staff/admin
                const user = req.user as any
                if (user) {
                  const isOwner = episode.createdBy === user.id
                  const isInHosts = Array.isArray(episode.hosts) && episode.hosts.some((h: any) => {
                    const hostId = typeof h === 'string' ? h : h?.id
                    const userHostId = typeof user.host === 'string' ? user.host : user.host?.id
                    return hostId === userHostId
                  })
                  const isStaffOrAdmin = user.role === 'staff' || user.role === 'admin'
                  
                  if (!isOwner && !isInHosts && !isStaffOrAdmin) {
                    console.error(`[MediaImages] User ${user.email} not authorized for episode ${episodeId}`)
                    throw new Error('Unauthorized: You do not have permission to upload files for this episode')
                  }
                }
                
                // Generate cover filename: {episodeId}__cover.{ext}
                const mimeType = req.file.mimetype || 'image/jpeg'
                let filename = buildCoverFilename(episodeId, mimeType)
                
                console.log(`[MediaImages] Generated filename for episode ${episodeId}: ${filename}`)
                
                // Step 2: Compress image (only for custom form uploads with episodeId)
                try {
                  console.log('[MediaImages] Starting compression...')
                  
                  // Get file buffer
                  const fileBuffer = req.file.data
                  
                  // Check if file is HEIC/HEIF format (common on iPhones/Macs)
                  const mimeType = req.file.mimetype || ''
                  const isHeic = mimeType.includes('heic') || mimeType.includes('heif')
                  
                  // Initialize Sharp instance - for HEIC, convert to JPEG immediately
                  let sharpInstance = isHeic ? sharp(fileBuffer).jpeg() : sharp(fileBuffer)
                  
                  // Get metadata to check dimensions (with error handling for unsupported formats)
                  let metadata
                  try {
                    metadata = await sharpInstance.metadata()
                    if (isHeic) {
                      console.log(`[MediaImages] HEIC/HEIF converted to JPEG - dimensions: ${metadata.width}x${metadata.height}`)
                    } else {
                      console.log(`[MediaImages] Original dimensions: ${metadata.width}x${metadata.height}`)
                    }
                  } catch (metaError: any) {
                    // If metadata extraction fails, check if it's a HEIC codec issue
                    if (metaError.message?.includes('heif') || metaError.message?.includes('codec') || metaError.message?.includes('bad seek')) {
                      console.warn('[MediaImages] HEIC/HEIF codec issue detected - attempting direct JPEG conversion...')
                      try {
                        // Try to convert HEIC directly to JPEG (bypass metadata step)
                        sharpInstance = sharp(fileBuffer).jpeg()
                        // Force conversion by getting buffer (this will trigger the conversion)
                        const testBuffer = await sharpInstance.toBuffer({ resolveWithObject: true })
                        metadata = testBuffer.info
                        console.log(`[MediaImages] Successfully converted HEIC to JPEG: ${metadata.width}x${metadata.height}`)
                        // Reset instance for processing below
                        sharpInstance = sharp(fileBuffer).jpeg()
                      } catch (convertError: any) {
                        // If conversion also fails, reject with helpful error message
                        console.error('[MediaImages] Failed to process HEIC/HEIF image:', convertError.message)
                        throw new Error(
                          'HEIC/HEIF image format is not fully supported by the server. Please convert your image to JPEG or PNG before uploading. ' +
                          'You can do this by opening the image on your device and saving/exporting it as JPEG.'
                        )
                      }
                    } else {
                      throw metaError
                    }
                  }
                  
                  // Check if resize is needed (only if dimension > 1500px)
                  if (metadata.width && metadata.height && (metadata.width > 1500 || metadata.height > 1500)) {
                    console.log('[MediaImages] Resizing image to max 1500px...')
                    sharpInstance = sharpInstance.resize(1500, 1500, {
                      fit: 'inside',
                      withoutEnlargement: true,
                    })
                  } else {
                    console.log('[MediaImages] No resize needed (dimensions <= 1500px)')
                  }
                  
                  // Convert to JPG with 70% quality and 72 DPI
                  sharpInstance = sharpInstance
                    .jpeg({ quality: 70 })
                    .withMetadata({ density: 72 })
                  
                  // Get compressed buffer
                  const compressedBuffer = await sharpInstance.toBuffer()
                  const originalSize = (fileBuffer.length / 1024 / 1024).toFixed(2)
                  const compressedSize = (compressedBuffer.length / 1024 / 1024).toFixed(2)
                  
                  console.log(`[MediaImages] Compression complete: ${originalSize}MB → ${compressedSize}MB`)
                  
                  // Replace file data with compressed buffer (so Payload writes it)
                  req.file.data = compressedBuffer
                  req.file.size = compressedBuffer.length
                  req.file.mimetype = 'image/jpeg'
                  
                  // Store in context as backup for afterChange hook
                  req.context = req.context || {}
                  req.context._compressedImageBuffer = compressedBuffer
                  req.context._compressedImageFilename = buildCoverFilename(episodeId, 'image/jpeg')
                  
                  // Update filename extension to .jpg
                  filename = buildCoverFilename(episodeId, 'image/jpeg')
                  
                } catch (compressionError) {
                  console.error('[MediaImages] Compression failed:', compressionError)
                  // Continue with original file (don't block upload)
                }
                
                data.filename = filename
              } else {
                console.warn(`[MediaImages] Episode ${episodeId} not found, using default filename`)
              }
            }
          } catch (error) {
            console.error('[MediaImages] Error generating filename:', error)
            // On error, continue with default filename (don't block upload)
          }
        }
        return data
      },
    ],
    afterChange: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async ({ req, operation, doc }: any) => {
        // Write compressed image buffer to disk (only for custom form uploads)
        if (operation !== 'create') {
          return doc
        }
        
        const compressedBuffer = req.context?._compressedImageBuffer
        const compressedFilename = req.context?._compressedImageFilename
        
        if (!compressedBuffer || !compressedFilename) {
          // No compression was done (regular admin upload or no episodeId)
          return doc
        }
        
        const staticDir = '/srv/media/covers'
        const filePath = path.join(staticDir, compressedFilename)
        
        try {
          // Write compressed buffer to disk
          await fs.writeFile(filePath, compressedBuffer)
          console.log(`[MediaImages] ✓ Compressed image written to disk: ${filePath}`)
        } catch (error) {
          console.error('[MediaImages] ✗ Failed to write compressed image:', error)
          // File creation will fail when user tries to access it, but document is created
        }
        
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: false,
      admin: {
        description: 'Alt text for accessibility',
      },
    },
  ],
}
