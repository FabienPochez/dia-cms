# PAYLOAD ROLES & PERMISSIONS — Proposed Config Diffs

**Status**: 🚫 **DO NOT APPLY** (Audit Only)  
**Purpose**: Show minimal config changes to separate Admin access from public API access

---

## DIFF 1: Create Reusable Role Helpers

**File**: `/srv/payload/src/access/roleHelpers.ts` (NEW FILE)

```typescript
import { Access } from 'payload'

/**
 * Admin panel access: only admin/staff can access collection in admin panel
 * Separate from API access (use access.read for that)
 */
export const adminPanelOnly: Access = ({ req }) => {
  const user = req.user as any
  if (!user) return false
  return ['admin', 'staff'].includes(user.role)
}

/**
 * Check if user has any of the given roles
 * Usage: hasRole('admin', 'staff', 'host')
 */
export const hasRole = (...roles: string[]): Access => ({ req }) => {
  const user = req.user as any
  if (!user) return false
  return roles.includes(user.role)
}

/**
 * Check if user is admin
 */
export const isAdmin: Access = hasRole('admin')

/**
 * Check if user is admin or staff
 */
export const isAdminOrStaff: Access = hasRole('admin', 'staff')

/**
 * Allow authenticated users only
 */
export const authenticated: Access = ({ req }) => {
  return !!req.user
}
```

---

## DIFF 2: Episodes Collection — Add `access.admin`

**File**: `/srv/payload/src/collections/Episodes.ts`

```diff
 import { CollectionConfig } from 'payload/types'
 import { publicAccess } from '../access/publicAccess'
 import {
   episodesHostAccess,
   hostCanCreate,
   adminAndStaff,
   hideFromHosts,
   readOnlyFieldForHosts,
 } from '../access/hostAccess'
+import { adminPanelOnly } from '../access/roleHelpers'
 import type { Field } from 'payload'
 import slugify from 'slugify'
 import { sendEpisodeSubmittedNotification } from '../utils/emailNotifications'

 const Episodes: CollectionConfig = {
   slug: 'episodes',
   labels: {
     singular: { en: 'Episode' },
     plural: { en: 'Episodes' },
   },
   admin: {
     useAsTitle: 'title',
     defaultColumns: [
       'title',
       'episodeNumber',
       'publishedAt',
       'show',
       'energy',
       'airStatus',
       'scheduledAt',
       'scheduledEnd',
     ],
     sort: 'episodeNumber',
     hidden: ({ user }) => user?.role === 'host', // Hide Episodes collection from hosts in admin
   },
   access: {
     read: () => true, // Public API access (needed for frontend app)
+    admin: adminPanelOnly, // Only admin/staff can access in admin panel
     create: hostCanCreate, // Hosts can create episodes (via upload form)
     update: ({ req }) => {
       const user = req.user as any
       if (!user) return false
       // Admin/staff can update all episodes
       if (user.role === 'admin' || user.role === 'staff') return true
       // Hosts can update their own episodes (via upload form)
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
   // ... rest unchanged
```

**Impact**:
- ✅ Hosts **cannot** access `/admin/collections/episodes` (even via direct URL)
- ✅ Frontend API (`/api/episodes`) remains **public** for all users
- ✅ Upload form (custom view) still **accessible** for hosts (not gated by collection access)

---

## DIFF 3: Shows Collection — Add `access.admin`

**File**: `/srv/payload/src/collections/Shows.ts`

```diff
 import { CollectionConfig } from 'payload/types'
 import { publicAccess } from '../access/publicAccess'
 import { showsHostAccess, hostCanCreate, adminAndStaff, hideFromHosts } from '../access/hostAccess'
+import { adminPanelOnly } from '../access/roleHelpers'
 import slugify from 'slugify'
 import libretimeInstances from '../../config/libretime-instances.json'

 const Shows: CollectionConfig = {
   slug: 'shows',
   access: {
     read: () => true, // Public API access (needed for frontend app)
+    admin: adminPanelOnly, // Only admin/staff can access in admin panel
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
   // ... rest unchanged
```

---

## DIFF 4: Hosts Collection — Add `access.admin`

**File**: `/srv/payload/src/collections/Hosts.ts`

```diff
 import { CollectionConfig } from 'payload/types'
 import { adminAndStaff, hostsReadAccess } from '../access/hostAccess'
+import { adminPanelOnly } from '../access/roleHelpers'
 import slugify from 'slugify'

 const Hosts: CollectionConfig = {
   slug: 'hosts',
   labels: {
     singular: 'Host',
     plural: 'Hosts',
   },
   access: {
     read: hostsReadAccess, // Public read + hosts can read their own profile
+    admin: adminPanelOnly, // Only admin/staff can access in admin panel
     create: adminAndStaff,
     update: adminAndStaff,
     delete: adminAndStaff,
   },
   // ... rest unchanged
```

---

## DIFF 5: Users Collection — Add `access.admin` + Validation

**File**: `/srv/payload/src/collections/Users.ts`

```diff
 import type { CollectionConfig } from 'payload'
+import { adminPanelOnly } from '../access/roleHelpers'

 export const Users: CollectionConfig = {
   slug: 'users',
   auth: {
     useAPIKey: true,
     tokenExpiration: 5184000, // 60 days
     cookies: {
       sameSite: 'None',
       secure: true,
       domain: 'content.diaradio.live',
     },
   },
   admin: {
     useAsTitle: 'email',
     hidden: ({ user }) => user?.role === 'host',
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
+    admin: adminPanelOnly, // Only admin/staff can access in admin panel
     create: ({ req }) => {
       const user = req.user as any
       if (!user) return true // Allow public registration
       return user.role === 'admin' || user.role === 'staff'
     },
     update: ({ req, id }) => {
       const u = req.user as any
       console.log('[Users.update access]', {
         authed: !!u,
         userId: u?.id,
         targetId: id,
         role: u?.role,
       })
       if (!u) return false
       if (u.role === 'admin') return true
       return String(u.id) === String(id)
     },
     delete: ({ req }) => {
       const user = req.user as any
       if (!user) return false
       return user.role === 'admin'
     },
   },
   hooks: {
     beforeValidate: [
       ({ data }) => {
         if (!data) return data

+        // NEW: Validate host users have linked host profile
+        if (data.role === 'host' && !data.host) {
+          throw new Error('Users with role "host" must have a linked host profile')
+        }

         // --- episodes favorites ---
         if (data.favorites != null) {
           let favs: unknown = data.favorites
           // ... existing validation
         }

         // --- show favorites ---
         if (data.favoriteShows != null) {
           let favShows: unknown = data.favoriteShows
           // ... existing validation
         }

         return data
       },
     ],
     // ... rest unchanged
   },
   // ... rest unchanged
```

**Impact**:
- ✅ Only admin/staff can access Users collection in admin panel
- ✅ Prevents creating host users without linked profile (data integrity)
- ✅ Login flow still works (unauthenticated users can read user records)

---

## DIFF 6: Genres Collection — Add `access.admin`

**File**: `/srv/payload/src/collections/Genres.ts`

```diff
 import { CollectionConfig } from 'payload/types'
 import { publicAccess } from '../access/publicAccess'
 import { adminAndStaff } from '../access/hostAccess'
+import { adminPanelOnly } from '../access/roleHelpers'

 const Genres: CollectionConfig = {
   slug: 'genres',
   labels: {
     singular: { en: 'Genre' },
     plural: { en: 'Genres' },
   },
   admin: {
     useAsTitle: 'name',
     hidden: ({ user }) => user?.role === 'host',
   },
   access: {
     ...publicAccess, // Keep public read for frontend
     read: () => true, // Hosts can read genres (needed for upload form)
+    admin: adminPanelOnly, // Only admin/staff can access in admin panel
     create: adminAndStaff,
     update: adminAndStaff,
     delete: adminAndStaff,
   },
   // ... rest unchanged
```

---

## DIFF 7: Media Collections — Add `access.admin`

**File**: `/srv/payload/src/collections/Media.ts`

```diff
 import { publicAccess } from '../access/publicAccess'
+import { adminPanelOnly } from '../access/roleHelpers'
 import type { CollectionConfig } from 'payload'

 export const Media: CollectionConfig = {
   slug: 'media',
   access: publicAccess,
+  access: {
+    ...publicAccess,
+    admin: adminPanelOnly, // Only admin/staff can access in admin panel
+  },
   admin: {
     hidden: ({ user }) => user?.role === 'host',
   },
   // ... rest unchanged
```

**Note**: Similar changes for `MediaImages.ts` and `MediaTracks.ts`.

---

## VERIFICATION STEPS

### 1. Test Admin Panel Access (Hosts)

**Scenario**: Host user logs in and tries to access Episodes collection

**Steps**:
1. Log in as host user (`role: 'host'`)
2. Navigate to `/admin/collections/episodes`

**Expected Result**:
- ❌ Redirected to dashboard or 403 error page
- ✅ Episodes not visible in sidebar (existing `admin.hidden` behavior)

### 2. Test Custom View Access (Hosts)

**Scenario**: Host user accesses upload form

**Steps**:
1. Log in as host user
2. Navigate to `/admin/upload-episode`

**Expected Result**:
- ✅ Upload form loads successfully
- ✅ Can query `/api/shows`, `/api/genres`, `/api/hosts` (needed for form)

**⚠️ Potential Issue**: If custom views are blocked by collection `access.admin`, upload form will break.

**Mitigation**: Custom views should use Local API with different context, or keep collections accessible for authenticated users.

### 3. Test Frontend API Access (All Users)

**Scenario**: Frontend app queries episodes catalog

**Steps**:
1. Unauthenticated: Query `/api/episodes?limit=50`
2. Regular user: Log in, query `/api/episodes?limit=50`
3. Host user: Log in, query `/api/episodes?limit=50`
4. Admin user: Log in, query `/api/episodes?limit=50`

**Expected Result**:
- ✅ All queries return full episode list (public API access)
- ✅ No scoping by user role (because `access.read: () => true`)

### 4. Test Login Flow

**Scenario**: User logs in

**Steps**:
1. Visit `/admin/login`
2. Enter email and password
3. Submit form

**Expected Result**:
- ✅ Login succeeds
- ✅ No 403 errors on `/api/users?where[email][equals]=...`

**⚠️ Risk**: If Users `access.admin` blocks unauthenticated reads, login will break.

**Mitigation**: `access.read` allows unauthenticated (unchanged), only `access.admin` is added.

---

## ROLLBACK PLAN

If changes cause issues:

### Immediate Rollback (Git)
```bash
git revert <commit-hash>
git push
```

### Surgical Rollback (Remove `access.admin` Only)
Remove `admin: adminPanelOnly` from affected collections:
- Episodes.ts
- Shows.ts
- Hosts.ts
- Users.ts
- Genres.ts
- Media.ts
- MediaImages.ts
- MediaTracks.ts

System reverts to previous state (visual hiding only, no access control).

---

## MIGRATION CONSIDERATIONS

### Database Queries to Run BEFORE Changes

**1. Check for orphaned host users**:
```javascript
db.users.find({ role: 'host', host: { $exists: false } }).count()
```

**Expected**: 0 (if not, fix data before applying validation hook)

**2. Count host users (impact assessment)**:
```javascript
db.users.find({ role: 'host' }).count()
```

**Expected**: ~10-50 (depends on your system)

**Impact**: These users will no longer access admin panel routes (only custom views).

### Testing on Staging First

If possible, apply changes to staging environment first:
1. Test all verification steps
2. Monitor logs for access denied errors
3. Verify custom views still work
4. Test with actual host user accounts

### Monitoring After Deployment

Watch for these errors in production logs:
- `403 Forbidden` on admin panel routes (expected for hosts)
- `403 Forbidden` on custom views (NOT expected, indicates issue)
- `403 Forbidden` on API endpoints (NOT expected, indicates issue)

---

## ALTERNATIVE APPROACH (If Custom Views Break)

If adding `access.admin` breaks custom views, consider this alternative:

**Option A**: Use middleware to block admin routes
```typescript
// src/middleware.ts or custom admin middleware
export function middleware(req) {
  const user = req.user
  const path = req.nextUrl.pathname
  
  // Block host users from accessing collection admin routes
  if (user?.role === 'host' && path.startsWith('/admin/collections/')) {
    return NextResponse.redirect(new URL('/admin', req.url))
  }
  
  return NextResponse.next()
}
```

**Option B**: Keep collections accessible, add field-level `access.admin`
- Use field-level `access` to restrict sensitive fields instead of entire collections
- More granular but more complex to maintain

**Option C**: Create separate "host" role with custom admin panel
- Use Payload's custom admin views to build a separate interface for hosts
- Completely separate from the main admin panel
- More work but cleaner separation

---

**END OF PROPOSED DIFFS**













