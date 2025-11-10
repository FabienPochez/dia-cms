import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { passwordChangeRateLimiter } from '@/lib/rateLimiter'

/**
 * Self-service password change endpoint
 * POST /api/users/change-password
 * 
 * Allows authenticated users to change their own password with current password verification.
 * Implements rate limiting, token rotation, and audit logging.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now()
  
  try {
    const payload = await getPayload({ config })

    // 1. Authenticate user from JWT token
    const { user } = await payload.auth({ headers: req.headers })

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      )
    }

    // 2. Extract user ID from authenticated session (self-service only)
    const userId = user.id
    const userEmail = (user as any).email

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: 'Invalid user session' },
        { status: 401 },
      )
    }

    // 3. Get client IP for rate limiting
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || req.headers.get('x-real-ip') 
      || 'unknown'

    // 4. Check rate limit (5 attempts per minute per IP+user)
    if (passwordChangeRateLimiter.check(ip, userId)) {
      const resetTime = passwordChangeRateLimiter.getResetTime(ip, userId)
      console.warn(`[password-change] Rate limit exceeded for user ${userId} from IP ${ip}`)
      
      return NextResponse.json(
        { 
          error: 'Too many password change attempts',
          retryAfter: resetTime,
        },
        { 
          status: 429,
          headers: {
            'Retry-After': String(resetTime),
          },
        },
      )
    }

    // 5. Parse and validate request body
    let body: { currentPassword?: string; newPassword?: string }
    try {
      body = await req.json()
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      )
    }

    const { currentPassword, newPassword } = body

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 },
      )
    }

    // Validate password type
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return NextResponse.json(
        { error: 'Passwords must be strings' },
        { status: 400 },
      )
    }

    // Validate new password requirements (Payload default is 8 characters minimum)
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 },
      )
    }

    // Prevent setting the same password
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 },
      )
    }

    // 6. Verify current password by attempting login
    let loginResult: any
    try {
      loginResult = await payload.login({
        collection: 'users',
        data: {
          email: userEmail,
          password: currentPassword,
        },
      })
    } catch (error) {
      // Login failed - current password is incorrect
      console.warn(`[password-change] Failed password verification for user ${userId}`)
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 },
      )
    }

    if (!loginResult || !loginResult.user) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 },
      )
    }

    // 7. Update password using Payload Local API (auto-hashes)
    try {
      await payload.update({
        collection: 'users',
        id: userId,
        data: {
          password: newPassword,
        },
      })
    } catch (error) {
      console.error('[password-change] Failed to update password:', error)
      return NextResponse.json(
        { error: 'Failed to update password' },
        { status: 500 },
      )
    }

    // 8. Issue fresh JWT token (token rotation for security)
    let freshToken: string
    let tokenExpiration: number
    try {
      const freshLogin = await payload.login({
        collection: 'users',
        data: {
          email: userEmail,
          password: newPassword,
        },
      })

      freshToken = freshLogin.token!
      tokenExpiration = freshLogin.exp!
    } catch (error) {
      console.error('[password-change] Failed to generate new token:', error)
      // Password was updated but token generation failed
      // User can still log in with new password
      return NextResponse.json(
        { 
          error: 'Password updated but failed to generate new token. Please log in again.',
        },
        { status: 500 },
      )
    }

    // 9. Reset rate limit on success
    passwordChangeRateLimiter.reset(ip, userId)

    // 10. Log audit event (server-side only, no secrets)
    const duration = Date.now() - startTime
    console.log(JSON.stringify({
      action: 'password_change',
      userId,
      userEmail,
      ip,
      timestamp: new Date().toISOString(),
      duration,
      success: true,
    }))

    // 11. Return success with new token
    return NextResponse.json({
      user: {
        id: user.id,
        email: userEmail,
        role: (user as any).role,
      },
      token: freshToken,
      exp: tokenExpiration,
    })

  } catch (error: any) {
    console.error('[password-change] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}




