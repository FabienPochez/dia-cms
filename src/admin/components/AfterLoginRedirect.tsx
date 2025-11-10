'use client'

import { useAuth } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Redirects users after login based on their role
 * - Hosts → /admin/upload-episode
 * - Others → default (admin home or redirect param)
 */
const AfterLoginRedirect: React.FC = () => {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!user) return

    // Redirect hosts to upload page (ignore any redirect param)
    if (user.role === 'host') {
      router.push('/admin/upload-episode')
    }
    // Admin/staff/others will use default redirect behavior
  }, [user, router])

  return null
}

export default AfterLoginRedirect

