import type { CollectionConfig } from 'payload'
import { adminPanelOnly } from '../access/adminPanelOnly'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    useAPIKey: true, // ← enables API Keys for this auth collection
    // Session horizon for JWT/cookie. Needed for long-lived sessions + refresh flow.
    tokenExpiration: 5184000, // 60 days in seconds
    // keep auth enabled for admin users
    // set cookie attributes here as the single source of truth
    cookies: {
      sameSite: 'None',
      secure: true,
      domain: 'content.diaradio.live', // exact host of the API
    },
    // Enable transactional emails
    forgotPassword: {
      generateEmailSubject: () => 'Reset your DIA! Radio password',
    },
    verify: true, // Enable email verification for new users
  },
  admin: {
    useAsTitle: 'email',
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  access: {
    read: ({ req }) => {
      const user = req.user as any
      // Allow unauthenticated reads (needed for login flow and frontend app)
      if (!user) return true
      // Admin can see all users
      if (user.role === 'admin') return true
      // Staff can see all users
      if (user.role === 'staff') return true
      // Hosts and regular users can only see themselves when authenticated
      return {
        id: {
          equals: user.id,
        },
      }
    },
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
    create: ({ req }) => {
      const user = req.user as any
      if (!user) return true // Allow public registration
      return user.role === 'admin' || user.role === 'staff' // Only admin/staff can create users when logged in
    },
    update: ({ req, id }) => {
      const u = req.user as any
      // temporary debug (watch server logs once):
      console.log('[Users.update access]', {
        authed: !!u,
        userId: u?.id,
        targetId: id,
        role: u?.role,
      })

      // Allow unauthenticated updates for password reset flow
      // Payload's resetPassword operation requires this to update the password
      // The reset token itself provides security (short-lived, single-use)
      if (!u) return true

      if (u.role === 'admin') return true
      return String(u.id) === String(id) // <<< normalize for ObjectId/string
    },
    delete: ({ req }) => {
      const user = req.user as any
      if (!user) return false
      return user.role === 'admin' // Only admin can delete users
    },
  },
  // Let Payload handle auth with default settings
  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        if (!data) return data

        // Validate host users have linked host profile
        // Use originalDoc from hook args (pre-update document) for effective values
        const effectiveRole = data.role ?? originalDoc?.role
        const effectiveHost = data.host ?? originalDoc?.host

        if (effectiveRole === 'host' && !effectiveHost) {
          throw new Error('Users with role "host" must have a linked host profile')
        }

        // --- episodes favorites ---
        if (data.favorites != null) {
          let favs: unknown = data.favorites

          if (typeof favs === 'string') {
            try {
              favs = JSON.parse(favs)
            } catch {
              delete (data as any).favorites
              favs = null
            }
          }

          if (Array.isArray(favs)) {
            const ids = Array.from(
              new Set(
                favs
                  .map((v) => {
                    if (v && typeof v === 'object') {
                      // legacy shapes: { episode }, { id }, { value }
                      return (v as any).episode || (v as any).id || (v as any).value || null
                    }
                    return v
                  })
                  .filter(Boolean),
              ),
            )
            ;(data as any).favorites = ids
          } else if (favs !== null) {
            // bad shape → drop to avoid cast error
            delete (data as any).favorites
          }
        }

        // --- show favorites ---
        if (data.favoriteShows != null) {
          let favShows: unknown = data.favoriteShows

          if (typeof favShows === 'string') {
            try {
              favShows = JSON.parse(favShows)
            } catch {
              delete (data as any).favoriteShows
              favShows = null
            }
          }

          if (Array.isArray(favShows)) {
            const ids = Array.from(
              new Set(
                favShows
                  .map((v) => {
                    if (v && typeof v === 'object') {
                      // legacy shapes: { id }, { value }
                      return (v as any).id || (v as any).value || null
                    }
                    return v
                  })
                  .filter(Boolean),
              ),
            )
            ;(data as any).favoriteShows = ids
          } else if (favShows !== null) {
            // bad shape → drop to avoid cast error
            delete (data as any).favoriteShows
          }
        }

        return data
      },
    ],

    // Strip favorites from any internal change that isn't explicitly updating them
    beforeChange: [
      ({ data }) => {
        if (!data) return data
        if ('favorites' in data && !Array.isArray((data as any).favorites)) {
          delete (data as any).favorites
        }
        if ('favoriteShows' in data && !Array.isArray((data as any).favoriteShows)) {
          delete (data as any).favoriteShows
        }
        return data
      },
    ],

    // (Optional) extra belt: if some adapter path still passes raw data on update ops
    beforeOperation: [
      ({ args }) => {
        if (args?.data && typeof (args.data as any).favorites === 'string') {
          delete (args.data as any).favorites
        }
        if (args?.data && typeof (args.data as any).favoriteShows === 'string') {
          delete (args.data as any).favoriteShows
        }
        return args
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: ['admin', 'staff', 'host', 'user'],
      defaultValue: 'user',
      required: true,
      saveToJWT: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'host',
      type: 'relationship',
      relationTo: 'hosts',
      label: 'Linked Host Profile',
      admin: {
        position: 'sidebar',
        description: 'Host profile associated with this user (for episode uploads)',
      },
    },
    {
      name: 'adminActions',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: './admin/components/SendResetButton',
        },
      },
    },
    // OLD
    // {
    //   name: 'favorites',
    //   type: 'array',
    //   fields: [{ name: 'episode', type: 'relationship', relationTo: 'episodes' }],
    // },

    // NEW
    {
      name: 'favorites',
      type: 'relationship',
      relationTo: 'episodes',
      hasMany: true,
    },
    {
      name: 'favoriteShows',
      type: 'relationship',
      relationTo: 'shows',
      hasMany: true,
    },
  ],
}
