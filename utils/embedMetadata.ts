import fs from 'fs/promises'
import path from 'path'
import NodeID3 from 'node-id3'
import fetch from 'node-fetch'

export async function embedMetadata({
  filePath,
  title,
  artist,
  genre,
  comment,
  coverUrl,
}: {
  filePath: string
  title: string
  artist: string | string[]
  genre?: string
  comment?: string
  coverUrl?: string
}) {
  let imageBuffer: Buffer | undefined

  if (coverUrl) {
    try {
      if (coverUrl.startsWith('http')) {
        const res = await fetch(coverUrl)
        if (res.ok) {
          imageBuffer = Buffer.from(await res.arrayBuffer())
        } else {
          console.warn(`❗ Failed to fetch cover image from ${coverUrl}`)
        }
      } else {
        const coverPath = path.resolve(coverUrl)
        imageBuffer = await fs.readFile(coverPath)
      }
    } catch (err) {
      console.warn(`❗ Error loading cover image from ${coverUrl}:`, err)
    }
  }

  const artistString = Array.isArray(artist) ? artist.join(' & ') : artist

  const tags = {
    title,
    artist: artistString,
    genre,
    comment: comment ? { text: comment } : undefined,
    image: imageBuffer
      ? {
          mime: 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'Cover',
          imageBuffer,
        }
      : undefined,
  }

  const success = NodeID3.write(tags, filePath)
  if (!success) throw new Error(`Failed to write ID3 tags to ${filePath}`)
}
