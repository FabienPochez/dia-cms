import type { PayloadRequest } from 'payload'

/**
 * Admin panel access:
 * - Unauthenticated users: ALLOWED (for auth routes like forgot/reset password)
 * - Authenticated admin/staff: ALLOWED (for collection management)
 * - Authenticated hosts/users: BLOCKED (from collection management)
 *
 * Note: Payload's built-in auth routes (login, forgot-password, reset-password, verify)
 * handle their own authorization logic, so allowing unauthenticated access here
 * is safe and necessary for password reset flow.
 */
export const adminPanelOnly = ({ req }: { req: PayloadRequest }): boolean => {
  const user = req.user as any

  // Allow unauthenticated access (needed for password reset, email verification)
  // This is safe because Payload's auth routes handle their own authorization
  if (!user) return true

  // Allow authenticated admin/staff for collection management
  return ['admin', 'staff'].includes(user.role)
}
