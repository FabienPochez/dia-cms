import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { forgotPasswordRateLimiter } from '@/lib/rateLimiter'
import crypto from 'crypto'

/**
 * App forgot password endpoint
 * POST /api/auth/app/forgot-password
 * 
 * Sends password reset email with custom template linking to dia-web.vercel.app
 * Separate from admin forgot password flow which uses content.diaradio.live
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await getPayload({ config })

    // 1. Get client IP for rate limiting
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || req.headers.get('x-real-ip') 
      || 'unknown'

    // 2. Parse and validate request body
    let body: { email?: string }
    try {
      body = await req.json()
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      )
    }

    const { email } = body

    // 3. Validate email format
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 },
      )
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 },
      )
    }

    // 4. Check rate limit (5 attempts per minute per IP+email)
    if (forgotPasswordRateLimiter.check(ip, email)) {
      const resetTime = forgotPasswordRateLimiter.getResetTime(ip, email)
      console.warn(`[app-forgot-password] Rate limit exceeded for email ${email} from IP ${ip}`)
      
      return NextResponse.json(
        { 
          error: 'Too many password reset requests. Please try again later.',
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

    // 5. Look up user by email
    let user
    try {
      const users = await payload.find({
        collection: 'users',
        where: {
          email: {
            equals: email.toLowerCase().trim(),
          },
        },
        limit: 1,
      })

      user = users.docs[0]
    } catch (error) {
      console.error('[app-forgot-password] Error looking up user:', error)
      // Return generic success to prevent user enumeration
      return NextResponse.json(
        { success: true },
        { status: 200 },
      )
    }

    // 6. Return generic success if user not found (security: prevent user enumeration)
    if (!user) {
      return NextResponse.json(
        { success: true },
        { status: 200 },
      )
    }

    // 7. Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenExpiration = new Date(Date.now() + 3600000) // 1 hour from now

    // 8. Save token to user document
    try {
      await payload.update({
        collection: 'users',
        id: user.id,
        data: {
          resetPasswordToken: resetToken,
          resetPasswordExpiration: resetTokenExpiration.toISOString(),
        },
      })
    } catch (error) {
      console.error('[app-forgot-password] Error saving reset token:', error)
      return NextResponse.json(
        { error: 'Failed to process password reset request' },
        { status: 500 },
      )
    }

    // 9. Build reset URL for app/web
    const resetURL = `https://dia-web.vercel.app/reset-password?token=${resetToken}`

    // 10. Send custom email with app-specific template
    try {
      await payload.sendEmail({
        to: email,
        subject: 'Reset your Dia Radio app account password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Your Password</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin: 20px 0;">
              <h1 style="color: #000; margin-top: 0;">Reset Your Dia Radio App Account Password</h1>
              
              <p>You are receiving this email because you (or someone else) has requested to reset the password for your Dia Radio app account.</p>
              
              <p>Click the button below to reset your password:</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetURL}" style="display: inline-block; background-color: #007bff; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; font-weight: bold;">Reset Password</a>
              </div>
              
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #007bff;">${resetURL}</p>
              
              <p style="color: #666; font-size: 14px; margin-top: 30px;">
                <strong>This link will expire in 1 hour.</strong>
              </p>
              
              <p style="color: #666; font-size: 14px;">
                If you did not request a password reset, please ignore this email. Your password will remain unchanged.
              </p>
              
              <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
              
              <p style="color: #999; font-size: 12px; margin-bottom: 0;">
                This is an automated message from Dia Radio. Please do not reply to this email.
              </p>
            </div>
          </body>
          </html>
        `,
      })

      console.log(`[app-forgot-password] Password reset email sent to ${email}`)
    } catch (error) {
      console.error('[app-forgot-password] Error sending email:', error)
      // Don't expose email sending errors to client
      // Token was already saved, so user can still use it if they have it
      return NextResponse.json(
        { error: 'Failed to send password reset email' },
        { status: 500 },
      )
    }

    // 11. Return success (generic response for security)
    return NextResponse.json(
      { success: true },
      { status: 200 },
    )

  } catch (error: any) {
    console.error('[app-forgot-password] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}

