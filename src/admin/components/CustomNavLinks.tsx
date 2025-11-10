'use client'

import React from 'react'
import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'

const CustomNavLinks: React.FC = () => {
  const { user } = useAuth()

  // Only show planner to admin/staff
  const canSeePlanner = user?.role === 'admin' || user?.role === 'staff'
  
  // Only show upload episode to host/staff/admin
  const canUploadEpisode = user?.role === 'host' || user?.role === 'staff' || user?.role === 'admin'

  return (
    <>
      {canUploadEpisode && (
        <Link
          href="/admin/upload-episode"
          style={{
            display: 'block',
            padding: '10px 20px',
            color: '#333',
            textDecoration: 'none',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          📤 Upload Episode
        </Link>
      )}
      {canSeePlanner && (
        <>
          <Link
            href="/admin/planner"
            style={{
              display: 'block',
              padding: '10px 20px',
              color: '#333',
              textDecoration: 'none',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            📅 Planner
          </Link>
          <Link
            href="/admin/error-logs"
            style={{
              display: 'block',
              padding: '10px 20px',
              color: '#333',
              textDecoration: 'none',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            📋 Error Logs
          </Link>
        </>
      )}
    </>
  )
}

export default CustomNavLinks
