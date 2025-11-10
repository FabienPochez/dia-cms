import { CollectionConfig } from 'payload/types'

const UploadErrorLogs: CollectionConfig = {
  slug: 'upload-error-logs',
  labels: {
    singular: { en: 'Upload Error Log' },
    plural: { en: 'Upload Error Logs' },
  },
  admin: {
    useAsTitle: 'errorType',
    defaultColumns: ['errorType', 'user', 'collection', 'createdAt', 'errorCode'],
    group: 'System',
    description: 'Logs of all upload errors for episodes and media',
  },
  access: {
    // Only admin and staff can view error logs
    read: ({ req: { user } }) => {
      if (!user) return false
      return user.role === 'admin' || user.role === 'staff'
    },
    // System can create logs, but users cannot
    create: () => true,
    update: () => false, // Read-only logs
    delete: ({ req: { user } }) => {
      if (!user) return false
      return user.role === 'admin'
    },
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'User who encountered the error',
      },
    },
    {
      name: 'userEmail',
      type: 'text',
      required: false,
      admin: {
        description: 'Email of the user (cached for convenience)',
      },
    },
    {
      name: 'userRole',
      type: 'text',
      required: false,
      admin: {
        description: 'Role of the user at time of error',
      },
    },
    {
      name: 'collection',
      type: 'select',
      required: true,
      options: [
        { label: 'Episodes', value: 'episodes' },
        { label: 'Media Tracks', value: 'media-tracks' },
        { label: 'Media Images', value: 'media-images' },
        { label: 'Shows', value: 'shows' },
      ],
      admin: {
        description: 'Collection where the error occurred',
      },
    },
    {
      name: 'operation',
      type: 'select',
      required: true,
      options: [
        { label: 'Create', value: 'create' },
        { label: 'Update', value: 'update' },
        { label: 'Upload', value: 'upload' },
      ],
      admin: {
        description: 'Operation being attempted',
      },
    },
    {
      name: 'errorType',
      type: 'select',
      required: true,
      options: [
        { label: 'Validation Error', value: 'validation' },
        { label: 'Audio Quality Error', value: 'audio_quality' },
        { label: 'File Upload Error', value: 'file_upload' },
        { label: 'Permission Error', value: 'permission' },
        { label: 'Server Error', value: 'server' },
        { label: 'Other', value: 'other' },
      ],
      admin: {
        description: 'Type/category of error',
      },
    },
    {
      name: 'errorCode',
      type: 'text',
      required: false,
      admin: {
        description: 'Specific error code (e.g., BITRATE_TOO_LOW, DURATION_MISMATCH)',
      },
    },
    {
      name: 'errorMessage',
      type: 'textarea',
      required: true,
      admin: {
        description: 'Full error message shown to user',
      },
    },
    {
      name: 'stackTrace',
      type: 'textarea',
      required: false,
      admin: {
        description: 'Stack trace for debugging',
        readOnly: true,
      },
    },
    {
      name: 'context',
      type: 'json',
      required: false,
      admin: {
        description: 'Additional context (file info, validation details, etc.)',
      },
    },
    {
      name: 'httpStatus',
      type: 'number',
      required: false,
      admin: {
        description: 'HTTP status code returned',
      },
    },
    {
      name: 'targetDocumentId',
      type: 'text',
      required: false,
      admin: {
        description: 'ID of document being created/updated (if available)',
      },
    },
    {
      name: 'ipAddress',
      type: 'text',
      required: false,
      admin: {
        description: 'IP address of the request',
      },
    },
    {
      name: 'userAgent',
      type: 'text',
      required: false,
      admin: {
        description: 'Browser user agent',
      },
    },
  ],
  timestamps: true,
}

export default UploadErrorLogs








