// src/collections/Hosts.ts
import { CollectionConfig } from 'payload/types'
import { adminAndStaff, hostsReadAccess } from '../access/hostAccess'
import slugify from 'slugify'

const Hosts: CollectionConfig = {
  slug: 'hosts',
  labels: {
    singular: 'Host',
    plural: 'Hosts',
  },
  access: {
    read: hostsReadAccess, // Public read + hosts can read their own profile
    create: adminAndStaff,
    update: adminAndStaff,
    delete: adminAndStaff,
  },
  admin: {
    useAsTitle: 'name', // 👈 this tells Payload to show the name field in selects
    hidden: ({ user }) => user?.role === 'host', // Hide from host users
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'bio',
      type: 'textarea',
    },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'socials',
      type: 'array',
      label: 'Social Links',
      fields: [
        {
          name: 'url',
          type: 'text',
          required: true,
        },
        {
          name: 'label',
          type: 'text',
          required: false,
        },
      ],
    },

    {
      name: 'type',
      type: 'select',
      label: 'Host Type',
      required: false,
      defaultValue: 'resident',
      options: [
        { value: 'resident', label: 'Resident' },
        { value: 'guest', label: 'Guest' },
      ],
      admin: {
        position: 'sidebar',
      },
    },

    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      label: 'Linked User Account',
      admin: {
        position: 'sidebar',
        description: 'User account associated with this host (for upload permissions)',
      },
    },

    // Relations collapsible group
    {
      type: 'collapsible',
      label: 'Relations',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'shows',
          type: 'join',
          collection: 'shows',
          on: 'hosts',
          admin: { readOnly: true },
        },
        {
          name: 'episodes',
          type: 'join',
          collection: 'episodes',
          on: 'hosts',
          admin: { readOnly: true },
        },
      ],
    },

    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      admin: {
        position: 'sidebar',
      },
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
    },
    {
      name: 'slug',
      type: 'text',
      required: false,
      unique: true,
      admin: {
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data.name && !data.slug) {
          data.slug = slugify(data.name, {
            lower: true,
            strict: true,
          })
        }
        return data
      },
    ],
  },
}

export default Hosts
