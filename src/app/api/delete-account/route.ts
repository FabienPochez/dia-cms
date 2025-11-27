import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * Self-service account deletion endpoint
 * DELETE /api/delete-account
 * 
 * Allows authenticated users to delete their own account.
 * No user ID needed in URL - uses authenticated user's ID from session.
 * Uses flat path structure outside /api/users/ to avoid Payload's catch-all route handler.
 */
export async function DELETE(req: NextRequest) {
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

    const userId = user.id
    const userEmail = (user as any).email

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: 'Invalid user session' },
        { status: 401 },
      )
    }

    // 2. Delete the user's own account
    try {
      await payload.delete({
        collection: 'users',
        id: userId,
        overrideAccess: true, // Bypass access control since we've already verified it's the user's own account
      })

      console.log(`[account-deletion] User ${userId} (${userEmail}) deleted their own account`)

      return NextResponse.json({
        success: true,
        message: 'Account deleted successfully',
      })
    } catch (error: any) {
      console.error('[account-deletion] Error deleting account:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to delete account' },
        { status: 500 },
      )
    }
  } catch (error: any) {
    console.error('[account-deletion] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}

