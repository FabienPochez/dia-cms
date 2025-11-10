import fs from 'fs'
import path from 'path'
import axios from 'axios'
import FormData from 'form-data'

const API_BASE_URL = 'http://172.18.0.4:3000/api' 
  // adjust if needed
const API_KEY = 'Z7kR3pV9tXyLqF2sMbN8aC1eJhGdUwYo'            // set your API key here
const TMP_DIR = '/srv/media/tmp'

async function uploadFile(filePath, fileName) {
  const form = new FormData()
  form.append('file', fs.createReadStream(filePath))
  form.append('alt', `Show cover image ${fileName}`)

  const headers = {
    ...form.getHeaders(),
    Authorization: `Bearer ${API_KEY}`,
  }

  const response = await axios.post(`${API_BASE_URL}/media-images`, form, { headers })
  return response.data.doc.id
}

async function patchShow(showId, mediaId) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  }

  await axios.patch(
    `${API_BASE_URL}/shows/${showId}`,
    { cover: mediaId },
    { headers }
  )
}

async function main() {
  const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith('show-'))
  for (const filename of files) {
    try {
      const match = filename.match(/^show-([a-f0-9]+)\.(.+)$/)
      if (!match) {
        console.log(`Skipping unrecognized file: ${filename}`)
        continue
      }
      const showId = match[1]
      const filePath = path.join(TMP_DIR, filename)
      console.log(`Uploading ${filename} for show ${showId}...`)

      const mediaId = await uploadFile(filePath, filename)
      console.log(`Uploaded media ID: ${mediaId}`)

      await patchShow(showId, mediaId)
      console.log(`Linked media to show ${showId}`)

    } catch (error) {
      console.error(`Error processing ${filename}:`, error.message)
    }
  }
}

main()
  .then(() => console.log('All done!'))
  .catch(err => console.error(err))
