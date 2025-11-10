'use client'

import React, { useState } from 'react'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'

/**
 * Admin-only button to send password reset email for the current user being edited
 * Renders in the Users collection sidebar as a UI field
 */
const SendResetButton: React.FC = () => {
  const { user } = useAuth()
  const { id: documentId } = useDocumentInfo()

  const [isLoading, setIsLoading] = useState(false)

  // Only render for admin/staff
  if (!user || !['admin', 'staff'].includes((user as any).role)) {
    return null
  }

  // Only render on edit view (when ID exists)
  if (!documentId) {
    return null
  }

  const handleSendReset = async () => {
    if (!confirm('Send password reset email to this user?')) {
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(`/api/admin/users/${documentId}/send-reset`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (response.ok && data.success) {
        alert(`✅ ${data.message}`)
      } else {
        alert(`❌ Error: ${data.error || 'Failed to send reset email'}`)
      }
    } catch (error: any) {
      console.error('[SendResetButton] Error:', error)
      alert(`❌ Error: ${error.message || 'Network error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <button
        type="button"
        onClick={handleSendReset}
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '0.75rem 1rem',
          backgroundColor: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {isLoading ? 'Sending...' : '📧 Send Reset Email'}
      </button>
    </div>
  )
}

export default SendResetButton
