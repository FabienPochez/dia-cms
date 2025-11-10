import { headers as getHeaders } from 'next/headers.js'
import Image from 'next/image'
import { getPayload } from 'payload'
import React from 'react'
import { fileURLToPath } from 'url'
import { redirect } from 'next/navigation'

import config from '@/payload.config'
import './styles.css'

export default async function HomePage() {
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  // Auto-redirect hosts to upload page
  if (user?.role === 'host') {
    redirect('/admin/upload-episode')
  }

  const fileURL = `vscode://file/${fileURLToPath(import.meta.url)}`

  return (
    <div className="home">
      <div className="content">
        <img
          alt="DIA Radio Logo"
          src="/Logo-Dia-New.png"
          style={{ maxWidth: '150px', width: '100%', height: 'auto' }}
        />
        {!user && <h1>Welcome to DIA! Radio CMS</h1>}
        {user && <h1>Welcome back, {user.email}</h1>}
        <div className="links">
          <a
            className="admin"
            href={payloadConfig.routes.admin}
            rel="noopener noreferrer"
            target="_blank"
          >
            Go to admin panel
          </a>
          <a
            className="docs"
            href="/admin/upload-episode"
            rel="noopener noreferrer"
            target="_blank"
          >
            Upload Episode
          </a>
        </div>
      </div>
      {/* <div className="footer">
        <p>Update this page by editing</p>
        <a className="codeLink" href={fileURL}>
          <code>app/(frontend)/page.tsx</code>
        </a>
      </div> */}
    </div>
  )
}
