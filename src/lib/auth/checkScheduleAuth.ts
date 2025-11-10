/**
 * Authorization helper for schedule endpoints
 * Checks if user has admin or staff role
 */

import { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import config from '../../payload.config'

export interface AuthResult {
  authorized: boolean
  user?: {
    id: string
    email: string
    role: string
  }
  error?: string
}

/**
 * Check if user is authorized (admin or staff role)
 * Works with both JWT and API Key authentication
 */
export async function checkScheduleAuth(request: NextRequest): Promise<AuthResult> {
  try {
    const payload = await getPayload({ config })

    // Try to authenticate user via Payload's auth strategies
    let user: any = null
    const authHeader = request.headers.get('Authorization') || ''

    // Check for JWT token (Bearer token)
    if (authHeader.startsWith('Bearer ')) {
      try {
        // Verify JWT and get user
        const verified = await payload.auth({
          headers: request.headers,
        })
        user = verified.user
      } catch (error) {
        console.warn('[AUTH] JWT verification failed:', error)
      }
    }

    // Check for API Key
    if (!user && authHeader.startsWith('users API-Key ')) {
      const apiKey = authHeader.replace('users API-Key ', '')
      try {
        // Find user by API key
        const result = await payload.find({
          collection: 'users',
          where: {
            enableAPIKey: { equals: true },
          },
          limit: 1,
          overrideAccess: true,
        })

        if (result.docs && result.docs.length > 0) {
          user = result.docs[0]
        }
      } catch (error) {
        console.warn('[AUTH] API Key lookup failed:', error)
      }
    }

    // Fallback to session cookie (Payload admin UI)
    if (!user) {
      try {
        const verified = await payload.auth({
          headers: request.headers,
        })
        if (verified?.user) {
          user = verified.user
        }
      } catch (error) {
        console.warn('[AUTH] Session authentication failed:', error)
      }
    }

    if (!user) {
      return {
        authorized: false,
        error: 'Invalid or expired credentials',
      }
    }

    // Check role
    const userRole = user.role || user.roles?.[0] || 'user'
    const allowedRoles = ['admin', 'staff']

    if (!allowedRoles.includes(userRole)) {
      return {
        authorized: false,
        user: {
          id: user.id,
          email: user.email,
          role: userRole,
        },
        error: `Insufficient permissions. Required: ${allowedRoles.join(' or ')}. Current: ${userRole}`,
      }
    }

    return {
      authorized: true,
      user: {
        id: user.id,
        email: user.email,
        role: userRole,
      },
    }
  } catch (error) {
    console.error('[AUTH] checkScheduleAuth failed:', error)
    return {
      authorized: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    }
  }
}
