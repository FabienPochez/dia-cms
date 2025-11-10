import { CollectionConfig } from 'payload/types'
import { publicAccess } from '../access/publicAccess'
import { adminAndStaff } from '../access/hostAccess'
import { adminPanelOnly } from '../access/adminPanelOnly'

const Genres: CollectionConfig = {
  slug: 'genres',
  labels: {
    singular: { en: 'Genre' },
    plural: { en: 'Genres' },
  },
  admin: {
    useAsTitle: 'name',
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  access: {
    ...publicAccess, // Keep public read for frontend
    read: () => true, // Hosts can read genres (needed for upload form)
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
    create: adminAndStaff,
    update: adminAndStaff,
    delete: adminAndStaff,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
    },
  ],
}

export default Genres
