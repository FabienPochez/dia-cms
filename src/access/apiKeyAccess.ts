export const apiKeyAccess = {
  collections: {
    '*': {
      create: () => true,
      read: () => true,
      update: () => true,
      delete: () => true,
    },
  },
}
