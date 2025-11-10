import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * Admin/Staff-only endpoint to trigger password reset email for a specific user
 * RESTful pattern: POST /api/admin/users/:id/send-reset
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getPayload({ config })

    // Get authenticated user from Payload
    const { user } = await payload.auth({ headers: req.headers })

    // Access Control: Admin/Staff only
    if (!user || !['admin', 'staff'].includes((user as any).role)) {
      return NextResponse.json(
        { error: 'Forbidden: Admin or Staff access required' },
        { status: 403 },
      )
    }

    // Get target user ID from URL params (await for Next.js 15)
    const { id } = await context.params

    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    // Look up target user
    const targetUser = await payload.findByID({
      collection: 'users',
      id,
    })

    if (!targetUser || !targetUser.email) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Trigger forgot password email via Payload Local API
    await payload.forgotPassword({
      collection: 'users',
      data: {
        email: targetUser.email,
      },
      disableEmail: false,
    })

    console.log(`[send-reset] Password reset email sent to ${targetUser.email} by ${user.email}`)

    return NextResponse.json({
      success: true,
      message: `Password reset email sent to ${targetUser.email}`,
    })
  } catch (error: any) {
    console.error('[send-reset] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send reset email' },
      { status: 500 },
    )
  }
}
