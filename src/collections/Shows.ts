import { CollectionConfig } from 'payload/types'
import { publicAccess } from '../access/publicAccess'
import { showsHostAccess, hostCanCreate, adminAndStaff, hideFromHosts } from '../access/hostAccess'
import { adminPanelOnly } from '../access/adminPanelOnly'
import slugify from 'slugify'
import libretimeInstances from '../../config/libretime-instances.json'

const Shows: CollectionConfig = {
  slug: 'shows',
  access: {
    read: () => true, // Public API access (needed for frontend app)
    admin: adminPanelOnly, // Only admin/staff can access in admin panel
    create: hostCanCreate, // Hosts can create shows (via upload form)
    update: ({ req }) => {
      const user = req.user as any
      if (!user) return false
      // Admin/staff can update all shows
      if (user.role === 'admin' || user.role === 'staff') return true
      // Hosts can update their own shows (where they're linked)
      if (user.role === 'host' && user.host) {
        const hostId = typeof user.host === 'string' ? user.host : user.host.id
        return {
          hosts: {
            contains: hostId,
          },
        }
      }
      return false
    },
    delete: adminAndStaff, // Only admin/staff can delete
  },
  labels: {
    singular: 'Show',
    plural: 'Shows',
  },
  admin: {
    useAsTitle: 'title',
    // Note: access.admin now handles gating (function-based hidden doesn't work in Payload v3)
  },
  fields: [
    // Main content area
    { name: 'title', type: 'text', required: true },
    { name: 'subtitle', type: 'text', access: { update: hideFromHosts } }, // Hosts can read, but cannot modify
    { name: 'description', type: 'textarea' },
    { name: 'cover', label: 'Cover Image', type: 'upload', relationTo: 'media-images' },
    {
      name: 'hosts',
      type: 'relationship',
      relationTo: 'hosts',
      hasMany: true,
      admin: { allowCreate: true },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'genres',
      type: 'relationship',
      relationTo: 'genres',
      hasMany: true,
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    // Relations collapsible group
    {
      type: 'collapsible',
      label: 'Relations',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'episodes',
          type: 'join',
          collection: 'episodes',
          on: 'show',
          admin: { readOnly: true },
          access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
        },
      ],
    },
    // Sidebar quick-ref
    {
      name: 'slug',
      type: 'text',
      unique: true,
      label: 'Handle',
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    // Status fields moved to sidebar
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
      ],
      defaultValue: 'archived',
      required: true,
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'visibility',
      type: 'select',
      label: 'Visibility',
      options: [
        { label: 'Public', value: 'public' },
        { label: 'Unlisted', value: 'unlisted' },
      ],
      required: false,
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'homepageFeatured',
      type: 'checkbox',
      label: 'Homepage Featured',
      defaultValue: false,
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'airState',
      type: 'select',
      label: 'Default Air State',
      options: [
        { label: 'Live', value: 'live' },
        { label: 'Pre-Recorded', value: 'preRecorded' },
      ],
      defaultValue: 'preRecorded',
      required: true,
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'launchedAt',
      type: 'date',
      label: 'Date Posted',
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'show_type',
      type: 'select',
      hasMany: true,
      required: false,
      options: [
        { value: 'Résidents', label: 'Résidents' },
        { value: 'Guests', label: 'Guests' },
        { value: 'Live', label: 'Live' },
        { value: 'Hors Murs', label: 'Hors Murs' },
        { value: 'Podcasts', label: 'Podcasts' },
        { value: 'One off', label: 'One off' },
        { value: 'Compositions Sonores', label: 'Compositions Sonores' },
        { value: 'Retransmissions', label: 'Retransmissions' },
        { value: 'Takeover', label: 'Takeover' },
      ],
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'libretimeShowId',
      type: 'number',
      label: 'LibreTime Show ID',
      admin: {
        position: 'sidebar',
        description: 'ID of the show in LibreTime system',
      },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
    {
      name: 'libretimeInstanceId',
      type: 'select',
      label: 'LibreTime Instance',
      required: true,
      options: libretimeInstances.map((instance) => ({
        label: instance.label,
        value: instance.id,
      })),
      defaultValue: 'main',
      admin: { position: 'sidebar' },
      access: { update: hideFromHosts }, // Hosts can read, but cannot modify,
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data.title && !data.slug) {
          data.slug = slugify(data.title, {
            lower: true,
            strict: true,
          })
        }
        return data
      },
    ],
  },
}

export default Shows
