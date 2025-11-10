'use client'

import { useAuth } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Automatically redirects host users from dashboard to upload page
 * Admin/staff see normal dashboard
 */
const HostDashboardRedirect: React.FC = () => {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Redirect hosts to upload page
    if (user?.role === 'host') {
      router.push('/admin/upload-episode')
    }
  }, [user, router])

  // Return null - this component only handles redirect logic
  return null
}

export default HostDashboardRedirect



