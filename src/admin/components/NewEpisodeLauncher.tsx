'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * NewEpisodeLauncher Component
 * 
 * Provides a button to pre-create a draft episode and redirect to the upload form.
 * This ensures the episode has a pre-assigned ID before file uploads begin.
 */
const NewEpisodeLauncher: React.FC = () => {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string>('')

  const handleCreateDraft = async () => {
    try {
      setIsCreating(true)
      setError('')

      // Call API to create draft episode
      const response = await fetch('/api/episodes/new-draft', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}), // No showId for now, can be added later
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create draft episode')
      }

      const { id } = await response.json()

      // Redirect to upload form with episodeId
      router.push(`/admin/upload-episode?episodeId=${id}`)
    } catch (err) {
      console.error('[NewEpisodeLauncher] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to create draft')
      setIsCreating(false)
    }
  }

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '20px' }}>Upload New Episode</h1>
      <p style={{ marginBottom: '30px', color: '#666', maxWidth: '600px', margin: '0 auto 30px' }}>
        Click the button below to start uploading a new episode. 
        We'll create a draft episode and take you to the upload form.
      </p>

      <button
        onClick={handleCreateDraft}
        disabled={isCreating}
        style={{
          backgroundColor: isCreating ? '#ccc' : '#0070f3',
          color: 'white',
          padding: '15px 30px',
          fontSize: '16px',
          border: 'none',
          borderRadius: '5px',
          cursor: isCreating ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
        }}
      >
        {isCreating ? 'Creating draft...' : 'Start Upload'}
      </button>

      {error && (
        <div
          style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#fee',
            border: '1px solid #fcc',
            borderRadius: '5px',
            color: '#c00',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

export default NewEpisodeLauncher

