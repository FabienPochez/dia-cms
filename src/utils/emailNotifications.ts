/**
 * Email notification utilities for episode submissions
 */

interface NotificationData {
  hostName: string
  showTitle: string
  episodeTitle?: string
  episodeURL: string
}

/**
 * Send email notification to admin when episode is submitted
 */
export async function sendEpisodeSubmittedNotification(
  payload: any,
  data: NotificationData,
): Promise<void> {
  try {
    console.log('[EMAIL_NOTIFICATION] Sending episode submission notification')

    // Get all admin users
    const users = await payload.find({
      collection: 'users',
      where: {
        role: {
          in: ['admin'],
        },
      },
      limit: 100,
    })

    if (!users.docs || users.docs.length === 0) {
      console.warn('[EMAIL_NOTIFICATION] No admin users found to notify')
      return
    }

    console.log(`[EMAIL_NOTIFICATION] Found ${users.docs.length} admin users to notify`)

    // Send email to each admin user
    for (const user of users.docs) {
      if (!user.email) continue

      try {
        await payload.sendEmail({
          to: user.email,
          subject: `New episode uploaded by ${data.hostName}`,
          html: `
            <h2>New Episode Submission</h2>
            <p><strong>${data.hostName}</strong> has submitted a new episode for <strong>${data.showTitle}</strong>.</p>
            ${data.episodeTitle ? `<p><strong>Episode Title:</strong> ${data.episodeTitle}</p>` : ''}
            <p><a href="${data.episodeURL}">View episode in Payload</a></p>
            <hr>
            <p style="color: #666; font-size: 12px;">This episode is pending review and approval.</p>
          `,
        })

        console.log(`[EMAIL_NOTIFICATION] ✅ Sent notification to ${user.email}`)
      } catch (emailError) {
        console.error(`[EMAIL_NOTIFICATION] Failed to send to ${user.email}:`, emailError)
      }
    }
  } catch (error) {
    console.error('[EMAIL_NOTIFICATION] Failed to send notifications:', error)
    // Don't throw - we don't want email failures to break episode creation
    if (error instanceof Error && error.message.includes('Email not configured')) {
      console.warn(
        '[EMAIL_NOTIFICATION] Email is not configured. To enable notifications, add email configuration to payload.config.ts',
      )
      console.warn('[EMAIL_NOTIFICATION] See: https://payloadcms.com/docs/email/overview')
    }
  }
}
