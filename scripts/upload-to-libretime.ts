import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import FormData from 'form-data'
import * as fssync from 'fs'

const MEDIA_NEW = '/srv/media/new'
const MEDIA_SCHEDULED = '/srv/media/scheduled'
const LIBRETIME_URL = process.env.LIBRETIME_URL!
const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY!
const PAYLOAD_URL = process.env.PAYLOAD_URL!
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY!

async function run() {
  const files = await fs.readdir(MEDIA_NEW)
  const mp3Files = files.filter(f => f.endsWith('.mp3'))
  if (!mp3Files.length) return console.log('No tracks to import.')

  const file = mp3Files[0]
  const fullPath = path.join(MEDIA_NEW, file)
  const episodeId = file.split('__')[0]
  if (!episodeId || episodeId.length < 8) {
    console.error(`Invalid filename for episode ID: ${file}`)
    return
  }

  console.log(`🎧 Uploading: ${file}`)

  try {
    // 1) Upload to LibreTime
    const form = new FormData()
    form.append('file', fssync.createReadStream(fullPath))

    const uploadRes = await axios.post(
      `${LIBRETIME_URL}/rest/media`,
      form,
      {
        auth: { username: LIBRETIME_API_KEY, password: '' },
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
      }
    )
    const libretimeTrackId = uploadRes.data?.id
    if (!libretimeTrackId) throw new Error('No ID from LibreTime')
    console.log(`✅ LibreTime ID: ${libretimeTrackId}`)

    // 2) Fetch existing episode so we can re-submit its status
    const getEp = await axios.get(
      `${PAYLOAD_URL}/api/episodes/${episodeId}`,
      { headers: { Authorization: `Bearer ${PAYLOAD_API_KEY}` } }
    )
    const currentStatus = getEp.data.status
    if (!currentStatus) throw new Error('Could not read episode.status')

    // 3) Update Payload with both libretime_track_id AND status
    const patchRes = await axios.patch(
      `${PAYLOAD_URL}/api/episodes/${episodeId}`,
      { libretime_track_id: libretimeTrackId, status: currentStatus },
      { headers: { Authorization: `Bearer ${PAYLOAD_API_KEY}` } }
    )
    console.log(`🔗 Payload updated: ${patchRes.data.slug || episodeId}`)

    // 4) Move the file
    const dest = path.join(MEDIA_SCHEDULED, file)
    await fs.rename(fullPath, dest)
    console.log(`📁 Moved to scheduled: ${dest}`)

  } catch (err: any) {
    console.error('❌ Error during upload:', err.response?.data || err.message)
  }
}

run()
