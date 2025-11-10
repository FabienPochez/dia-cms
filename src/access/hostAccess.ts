import { Access } from 'payload'

/**
 * Access control for hosts - they can only see content linked to their host profile
 */

/**
 * Shows: Hosts can only read shows where they are linked
 * Public users can read all shows (for frontend program schedule)
 */
export const showsHostAccess: Access = ({ req: { user } }) => {
  // Public users (unauthenticated) can see all shows for frontend
  if (!user) return true

  // Admin and staff can see all
  if (user.role === 'admin' || user.role === 'staff') {
    return true
  }

  // Hosts can only see shows where they are linked via the hosts array
  if (user.role === 'host' && user.host) {
    const hostId = typeof user.host === 'string' ? user.host : user.host.id
    return {
      hosts: {
        contains: hostId,
      },
    }
  }

  // Regular users cannot see shows in admin
  return false
}

/**
 * Episodes: Hosts can only read/update episodes where they are linked
 * Public users (unauthenticated) can read all episodes (for frontend API)
 */
export const episodesHostAccess: Access = ({ req: { user } }) => {
  // Public users (unauthenticated) can see all episodes
  // This is needed for the frontend to query the program schedule
  if (!user) return true

  // Admin and staff can see all
  if (user.role === 'admin' || user.role === 'staff') {
    return true
  }

  // Hosts can only see episodes where they are linked via the hosts array
  if (user.role === 'host' && user.host) {
    const hostId = typeof user.host === 'string' ? user.host : user.host.id
    return {
      hosts: {
        contains: hostId,
      },
    }
  }

  // Regular authenticated users cannot see episodes in admin
  return false
}

/**
 * Create access: hosts can create episodes/shows
 */
export const hostCanCreate: Access = ({ req: { user } }) => {
  if (!user) return false
  return ['admin', 'staff', 'host'].includes(user.role)
}

/**
 * Admin-only access (for sensitive collections)
 */
export const adminOnly: Access = ({ req: { user } }) => {
  if (!user) return false
  return user.role === 'admin'
}

/**
 * Admin and staff only
 */
export const adminAndStaff: Access = ({ req: { user } }) => {
  if (!user) return false
  return user.role === 'admin' || user.role === 'staff'
}

/**
 * Read-only for hosts, full access for admin/staff
 */
export const readOnlyForHosts: Access = ({ req: { user } }) => {
  if (!user) return false

  if (user.role === 'admin' || user.role === 'staff') {
    return true
  }

  // Hosts and regular users can read but not modify
  return false
}

/**
 * Hosts: Public read for all (host names/bios are public data shown on frontend)
 * Update/delete restricted to admin/staff only
 */
export const hostsReadAccess: Access = ({ req: { user } }) => {
  // Everyone can read hosts (public data for frontend)
  // Host names and bios are displayed publicly on the website
  // Sensitive fields (user, status, etc.) can have field-level restrictions if needed
  return true
}

/**
 * Field-level: Hide from hosts (staff-only fields)
 */
export const hideFromHosts: Access = ({ req: { user } }) => {
  if (!user) return true // Public can see (for frontend)
  if (user.role === 'host') return false // Hide from hosts
  return true // Admin/staff/regular users can see
}

/**
 * Field-level: Read-only for hosts (can see but not edit)
 */
export const readOnlyFieldForHosts: Access = ({ req: { user } }) => {
  if (!user) return true // Public can see
  if (user.role === 'host') return false // Hosts can't update (but can read via access.read)
  return true // Admin/staff can update
}
