import { publicAccess } from '../access/publicAccess'
import { adminPanelOnly } from '../access/adminPanelOnly'
import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    ...publicAccess,
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
  },
  admin: {
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: true,
}
