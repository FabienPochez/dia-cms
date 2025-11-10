'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'

const UploadSuccessView: React.FC = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const [episodeTitle, setEpisodeTitle] = useState<string>('')

  useEffect(() => {
    // Get episode title from URL params
    const title = searchParams.get('title')
    if (title) {
      setEpisodeTitle(decodeURIComponent(title))
    }
  }, [searchParams])

  const handleUploadAnother = () => {
    router.push('/admin/upload-episode')
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/users/logout', {
        method: 'POST',
        credentials: 'include',
      })
      router.push('/admin/login')
    } catch (error) {
      console.error('[LOGOUT] Failed:', error)
    }
  }

  return (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ color: '#10b981', fontSize: '48px', marginBottom: '20px' }}>🎉</h1>
        <h2 style={{ fontSize: '28px', marginBottom: '16px', fontWeight: 'bold' }}>
          Upload Successful!
        </h2>
        {episodeTitle && (
          <p style={{ fontSize: '18px', color: '#666', marginBottom: '8px' }}>
            <strong>{episodeTitle}</strong>
          </p>
        )}
        <p style={{ fontSize: '16px', color: '#666', marginBottom: '24px' }}>
          Your episode has been submitted for review. You'll be notified when it's published.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '40px' }}>
        <button
          onClick={handleUploadAnother}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#fff',
            backgroundColor: '#3b82f6',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
        >
          📤 Upload Another Episode
        </button>

        <button
          onClick={handleLogout}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#666',
            backgroundColor: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e5e7eb')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
        >
          🚪 Log Out
        </button>
      </div>

      {user && (
        <p style={{ fontSize: '14px', color: '#999', marginTop: '40px' }}>
          Logged in as: <strong>{user.email}</strong>
        </p>
      )}
    </div>
  )
}

export default UploadSuccessView



