# PAYLOAD ROLES & PERMISSIONS AUDIT — Reviewer Pack

**Audit Date**: 2025-10-27  
**Auditor**: AI Assistant (Cursor)  
**Objective**: Identify why recent admin gating for Hosts impacted frontend API reads, and propose minimal separation of Admin access from public/app API access.

---

## 1. EXECUTIVE SUMMARY (10 bullets)

1. **Root Cause**: Payload's `access.read` applies to ALL API requests (admin panel, REST, GraphQL), with no built-in distinction between "admin panel access" vs "public API access".

2. **Timeline of Impact**:
   - **Oct 23**: Host Access Control implemented using `access.read` to restrict hosts to their own content
   - **Oct 25**: Multiple emergency fixes reverted Episodes/Shows to `read: () => true` because frontend app broke

3. **Frontend Breakage**: Admin panel components (Planner, Upload View) query `/api/episodes`, `/api/shows` with `credentials: 'include'`. When authenticated as host or regular user, restrictive `access.read` returned scoped/empty results, breaking the app.

4. **Current Workaround**: Collections use `access.read: () => true` (public) + `admin.hidden: ({ user }) => user?.role === 'host'` to hide UI from hosts. This achieves UI hiding but NOT access control.

5. **Field-Level Confusion**: Oct 25 changelog notes that field-level `access.read: hideFromHosts` was blocking API queries, not just UI visibility. Changed to `access.update: hideFromHosts` + `admin.hidden: ({ user }) => user?.role === 'host'` for scheduling fields.

6. **No `access.admin` Usage**: No collections currently use Payload's `access.admin` property. All admin panel gating is done via `admin.hidden` (visual only, no security).

7. **JWT Config ✅**: The `role` field in Users collection has `saveToJWT: true` (line 174), so access functions can reliably check `req.user.role`.

8. **Roles Enumeration**: 4 roles defined: `admin`, `staff`, `host`, `user`. Found in Users collection (line 171) and referenced in 10+ access control functions.

9. **overrideAccess Usage**: Only used once in `/src/lib/auth/checkScheduleAuth.ts` (line 65) for internal auth checks. No Local API calls with `overrideAccess` that would bypass frontend restrictions.

10. **Design Conflict**: The intended Oct 23 behavior (restrict admin panel for hosts) conflicts with the frontend app's need for public API access. Payload doesn't natively support "admin panel only" restrictions separate from API access.

---

## 2. WHAT CHANGED RECENTLY (Timeline)

### 2025-10-23: Host Access Control Implementation

**Added** (`src/access/hostAccess.ts`):
- `showsHostAccess`: Hosts filtered to shows where they're in `hosts[]` array
- `episodesHostAccess`: Hosts filtered to episodes where they're in `hosts[]` array
- `hostCanCreate`, `adminAndStaff`, `adminOnly`, `readOnlyForHosts`, `hostsReadAccess`
- `hideFromHosts`: Field-level access (originally for `access.read`, later changed to `access.update`)

**Applied to Collections**:
- **Shows**: `access.read: showsHostAccess` (hosts see only their shows)
- **Episodes**: `access.read: episodesHostAccess` (hosts see only their episodes)
- **Hosts**: `access.read: hostsReadAccess` (hosts see only their profile)
- **Users**: `access.read` scoped to own user for non-admin/staff
- **Field-level**: ~80 fields in Episodes, ~10 in Shows with `access.read: hideFromHosts`

**Admin UI Hiding**:
- Episodes, Shows, Hosts, Genres, Media collections: `admin.hidden: ({ user }) => user?.role === 'host'`

**Intent**: Restrict admin panel UI for hosts, so they only see their own content and can't access sensitive collections.

### 2025-10-25: Emergency Fixes (3 separate fixes documented in CHANGELOG)

#### Fix 1: Login Failure
**Issue**: Users couldn't log in (403 Forbidden on `/api/users?where[email][equals]=...`)  
**Root Cause**: `access.read` returned `false` for unauthenticated users, blocking Payload's auth flow  
**Chicken-and-egg**: Auth system needs to read user record to authenticate, but access required already being authenticated  
**Fix**: Changed Users collection line 24: `if (!user) return false` → `if (!user) return true`  
**Result**: ✅ Login restored for admin panel and app

#### Fix 2: Episodes Scheduling Fields Query Error
**Issue**: Host users got QueryError when querying episodes by `scheduledAt` field  
**Error**: `"The following paths cannot be queried: scheduledAt, scheduledAt"`  
**Root Cause**: Field-level `access.read: hideFromHosts` blocked API queries, not just UI visibility  
**Design Conflict**: Admin panel should hide fields from hosts, but frontend app needs to query them  
**Fix**: Changed scheduling fields (lines 277-327):
  - Before: `access: { read: hideFromHosts }` (blocked queries)
  - After: `access: { update: hideFromHosts }` + `admin.hidden: ({ user }) => user?.role === 'host'` (blocks updates, hides UI, allows queries)  
**Result**: ✅ Frontend app can query schedule for all users, ✅ Hosts can't modify scheduling

#### Fix 3: Host Access Control Breaks Frontend App
**Issue**: Host and regular users in frontend app could only see scoped data (or nothing)
  - Hosts: Could only see episodes/shows where they're linked (can't favorite others, browse catalog)
  - Regular users (role='user'): Couldn't see ANY episodes/shows (returned false)  
**Root Cause**: Payload's `access.read` applies to ALL API requests (no distinction admin vs frontend)  
**Original Oct 23 Intent**: Restrict admin panel UI, not the API itself  
**Design Flaw**: `episodesHostAccess` and `showsHostAccess` scoped data by user role at API level  
**Fix**: Reverted Episodes and Shows collections to public API access:
  - `access.read: () => true` (public API for frontend app)
  - `admin.hidden: ({ user }) => user?.role === 'host'` (hide collections from hosts in admin sidebar)
  - Kept field-level `access.update` restrictions (hosts can't modify admin-only fields)  
**Location**: Episodes.ts (lines 20-54), Shows.ts (lines 9-37)  
**Result**: ✅ Frontend app restored for all users, ✅ Admin panel still hides collections from hosts, ✅ Upload form still works, ✅ API write permissions maintained

---

## 3. CURRENT ACCESS CONTROL STATE

### Collection-Level Access Matrix

| Collection | `access.read` | `access.create` | `access.update` | `access.delete` | `admin.hidden` | `access.admin` |
|------------|---------------|-----------------|-----------------|-----------------|----------------|----------------|
| **Episodes** | `() => true` (public) | `hostCanCreate` | Query-scoped (hosts: own episodes) | `adminAndStaff` | `({ user }) => user?.role === 'host'` | ❌ Not used |
| **Shows** | `() => true` (public) | `hostCanCreate` | Query-scoped (hosts: own shows) | `adminAndStaff` | `({ user }) => user?.role === 'host'` | ❌ Not used |
| **Hosts** | `hostsReadAccess` (public + scoped for hosts) | `adminAndStaff` | `adminAndStaff` | `adminAndStaff` | `({ user }) => user?.role === 'host'` | ❌ Not used |
| **Users** | Scoped (public for unauthenticated + own user) | Public + admin/staff when authed | Scoped (own user) | `adminOnly` | `({ user }) => user?.role === 'host'` | ❌ Not used |
| **Genres** | `() => true` (public) | `adminAndStaff` | `adminAndStaff` | `adminAndStaff` | `({ user }) => user?.role === 'host'` | ❌ Not used |
| **Media** | `publicAccess` (all operations public) | `publicAccess` | `publicAccess` | `publicAccess` | `({ user }) => user?.role === 'host'` | ❌ Not used |
| **MediaImages** | (not audited) | (not audited) | (not audited) | (not audited) | (not audited) | ❌ Not used |
| **MediaTracks** | (not audited) | (not audited) | (not audited) | (not audited) | (not audited) | ❌ Not used |

### Field-Level Access Patterns

#### Episodes Collection (~80 fields audited)

**✅ Hosts CAN Edit** (no field-level restrictions):
- `title`, `description`, `tracklistRaw`, `cover`, `hosts`, `energy`, `mood`, `tone`, `genres`

**🔒 Hosts READ-ONLY** (`access.update: readOnlyFieldForHosts`):
- `show`, `roundedDuration`, `publishedStatus`, `pendingReview`, `episodeNumber`, `slug`
- Metrics tab: `plays`, `likes`, `airCount`, `firstAiredAt`, `lastAiredAt`, etc.

**❌ Hosts HIDDEN** (`access.read: hideFromHosts` + `admin.hidden`):
- Editorial: `publishedAt`, `duration`, `visibility`, `diaPick`, `type`, `airState`, `showStatus`
- Scheduling: All fields (but see Fix 2 above - changed to `access.update` to allow queries)
- Audio/Tech: `media`, `libretimeTrackId`, `libretimeFilepathRelative`, `libretimeInstanceId`, `libretimePlayoutId`, `bitrate`, `sampleRate`, `realDuration`, `hasArchiveFile`, `archiveFilePath`
- Admin: `submittedAt`, `reviewedAt`, `reviewedBy`, `rejectionReason`, `adminNotes`

#### Shows Collection (~10 fields audited)

**✅ Hosts CAN Edit**:
- `title`, `description`, `cover`

**❌ Hosts HIDDEN** (`access.read: hideFromHosts`):
- `subtitle`, `hosts` array, `genres`, Relations collapsible, `slug`, `status`, `visibility`, `homepageFeatured`, `airState`, `launchedAt`, `show_type`, `libretimeShowId`, `libretimeInstanceId`

### Access Control Utility Functions (src/access/hostAccess.ts)

| Function | Purpose | Returns |
|----------|---------|---------|
| `showsHostAccess` | Shows read access | Public: `true`, Admin/staff: `true`, Hosts: `{ hosts: { contains: hostId } }`, Others: `false` |
| `episodesHostAccess` | Episodes read access | Public: `true`, Admin/staff: `true`, Hosts: `{ hosts: { contains: hostId } }`, Others: `false` |
| `hostCanCreate` | Create permission | Admin/staff/host: `true`, Others: `false` |
| `adminOnly` | Admin-only access | Admin: `true`, Others: `false` |
| `adminAndStaff` | Admin/staff access | Admin/staff: `true`, Others: `false` |
| `readOnlyForHosts` | Read-only for hosts | Admin/staff: `true`, Hosts: `false` |
| `hostsReadAccess` | Hosts collection read | Public: `true`, Admin/staff: `true`, Hosts: `{ id: { equals: hostId } }`, Others: `true` |
| `hideFromHosts` | Field-level hide | Public: `true`, Hosts: `false`, Others: `true` |
| `readOnlyFieldForHosts` | Field-level read-only | Public: `true`, Hosts: `false`, Others: `true` |

**⚠️ Note**: `hideFromHosts` and `readOnlyFieldForHosts` have identical implementation. The naming suggests different semantics, but both return `false` for hosts (which blocks both read AND update when used in `access.read`).

---

## 4. FRONTEND BREAKPOINTS & API USAGE

### Admin Panel Components Querying Payload API

#### 1. Planner View (`src/admin/hooks/useUnscheduledEpisodes.ts`)

**Endpoint**: `GET /api/episodes?where[publishedStatus][equals]=published&where[libretimeTrackId][exists]=true&limit=2000&depth=2`  
**Auth**: `credentials: 'include'` (sends cookies)  
**Impact**: If `access.read` restricted, authenticated hosts/users would get scoped results, breaking the episode palette.  
**Current State**: ✅ Works (public `access.read`)

#### 2. Scheduled Episodes (`src/admin/hooks/useScheduledEpisodes.ts`)

**Endpoint**: `GET /api/episodes?limit=100&where[publishedStatus][equals]=published&where[scheduledAt][exists]=true&sort=-scheduledAt&depth=1`  
**Auth**: `credentials: 'include'`  
**Impact**: If `access.read` restricted, calendar would show scoped results.  
**Current State**: ✅ Works (public `access.read`)

#### 3. Episode Upload View (`src/admin/components/EpisodeUploadView.tsx`)

**Endpoints**:
- `GET /api/users/me` (check auth)
- `GET /api/hosts/${hostId}?depth=1` (get linked host)
- `GET /api/shows/${id}?depth=1` (for each show linked to host)
- `GET /api/genres?limit=100` (load all genres)

**Auth**: `credentials: 'include'`  
**Impact**: If Hosts collection `access.read` was restricted, couldn't load host data. If Shows restricted, couldn't load shows. If Genres restricted, couldn't load genres.  
**Current State**: ✅ Works (Hosts: `hostsReadAccess` allows public read, Shows/Genres: public `access.read`)

#### 4. Schedule API Endpoints (`src/app/api/schedule/*.ts`)

These are Next.js API routes (server-side), not admin panel components, but they use Payload's Local API:

**Endpoints**: `planOne`, `unplanOne`, `diff-range`, `apply-range`, `create`, `move`, `delete`  
**Payload Calls**: `payload.findByID({ collection: 'episodes', id })`, `payload.find({ collection: 'episodes', where: {...} })`  
**Auth**: Uses `getPayload({ config })` which runs with **server context** (may have different access semantics than browser API calls)  
**overrideAccess**: ❌ NOT used in any schedule endpoints (all respect access control)  
**Impact**: If Episodes `access.read` restricted, these endpoints would fail or return scoped results.  
**Current State**: ✅ Works (public `access.read`)

### overrideAccess Usage Audit

**Search Results**: Only 1 usage found in codebase (excluding node_modules):

**File**: `/srv/payload/src/lib/auth/checkScheduleAuth.ts` (line 65)  
**Context**:
```typescript
const user = await payload.findByID({
  collection: 'users',
  id: userIdFromToken,
  overrideAccess: true,
})
```

**Purpose**: Internal auth validation (decoding JWT, checking role). This is a legitimate use of `overrideAccess` for auth checks.

**Conclusion**: ✅ No unsafe `overrideAccess` usage that would bypass frontend restrictions.

---

## 5. ROLES & JWT CONFIGURATION

### Roles Enumeration

**Defined in**: `src/collections/Users.ts` (line 171)

```typescript
{
  name: 'role',
  type: 'select',
  options: ['admin', 'staff', 'host', 'user'],
  defaultValue: 'user',
  required: true,
  saveToJWT: true, // ✅ LINE 174
  admin: {
    position: 'sidebar',
  },
},
```

**✅ Confirmation**: `saveToJWT: true` is present, so `req.user.role` is reliably available in all access functions.

### Role References in Codebase

**Search Result**: `user?.role` found in 13 matches across 10 files:
- `src/collections/Shows.ts` (1 occurrence)
- `src/collections/Episodes.ts` (4 occurrences)
- `src/collections/Users.ts` (1 occurrence)
- `src/admin/components/CustomNavLinks.tsx` (1 occurrence)
- `src/collections/Hosts.ts` (1 occurrence)
- `src/collections/MediaImages.ts` (1 occurrence)
- `src/collections/MediaTracks.ts` (1 occurrence)
- `src/collections/Media.ts` (1 occurrence)
- `src/collections/Genres.ts` (1 occurrence)
- `src/payload.config-backup.ts` (1 occurrence)

**Usage Pattern**: All references use optional chaining (`user?.role`) to safely handle unauthenticated requests.

### Linked Host Profile

**Field**: `host` relationship field in Users collection (line 180)  
**Purpose**: Links user accounts to host profiles for upload permissions  
**Access Pattern**: Used in access functions like:

```typescript
if (user.role === 'host' && user.host) {
  const hostId = typeof user.host === 'string' ? user.host : user.host.id
  return {
    hosts: {
      contains: hostId,
    },
  }
}
```

**⚠️ Risk**: Access functions assume `user.host` is populated, but don't validate it exists before using. If a user has `role: 'host'` but no linked `host`, the query will fail silently.

---

## 6. DESIGN CONFLICT ANALYSIS

### The Fundamental Problem

**Payload's Access Model**:
- `access.read` applies to **ALL** API requests: Admin UI, REST API (`/api/episodes`), GraphQL, Local API
- No built-in way to distinguish "admin panel access" vs "public API access"

**Attempted Solution (Oct 23)**:
- Used `access.read` to restrict hosts to their own content
- Assumption: This would only affect the admin panel UI

**Why It Failed**:
- Admin panel components use the same `/api/episodes` REST endpoints as external apps
- When authenticated as host/user, the API returned scoped/empty results
- Frontend app broke because it needed to browse the full catalog

**Current Workaround**:
- Set `access.read: () => true` (public API)
- Use `admin.hidden: ({ user }) => user?.role === 'host'` to hide collections from admin sidebar
- Use `access.update`, `access.create`, `access.delete` to restrict write operations

**Limitations of Workaround**:
- ❌ `admin.hidden` is visual only (doesn't prevent direct API access to admin endpoints)
- ❌ No way to gate "who can see the admin panel at all" separately from API access
- ✅ Prevents hosts from modifying data via `access.update`/`create`/`delete`
- ✅ Hides sensitive fields via `admin.hidden` (visual only)

### Where `access.admin` SHOULD Be Used (But Isn't)

**Payload Documentation**: `access.admin` controls who can access the admin panel for a collection.

**Expected Behavior**:
- `access.admin: ({ req }) => req.user?.role !== 'host'` would prevent hosts from accessing Episodes/Shows in the admin panel
- `access.read: () => true` would still allow frontend API to read all episodes

**Current State**: ❌ NO collections use `access.admin` (search result: 0 matches)

**Why Not Used?**: Likely unfamiliarity with the distinction between `access.admin` vs `admin.hidden`:
- `admin.hidden`: Hides collection from sidebar (visual only, still accessible via URL)
- `access.admin`: Prevents access to admin panel routes for the collection (enforced)

---

## 7. FIELD-LEVEL ACCESS ISSUES

### The Oct 25 "Query Error" Incident

**Original Implementation** (Oct 23):
```typescript
{
  name: 'scheduledAt',
  type: 'date',
  access: {
    read: hideFromHosts, // ❌ Blocked API queries
  },
}
```

**Problem**: Frontend app queried episodes with `where[scheduledAt][exists]=true`, but field-level `access.read` blocked the query, returning error:
```
"The following paths cannot be queried: scheduledAt, scheduledAt"
```

**Fix** (Oct 25):
```typescript
{
  name: 'scheduledAt',
  type: 'date',
  admin: {
    hidden: ({ user }) => user?.role === 'host', // Hide UI field
  },
  access: {
    update: hideFromHosts, // Prevent updates only
  },
}
```

**Lesson**: Field-level `access.read` affects **query capability**, not just visibility. To hide fields in admin UI without blocking queries, use `admin.hidden` + `access.update`.

### Payload V3 Function-Based Visibility Caveat

**CHANGELOG Warning** (line 159-165):
> **Fix applied**: Changed collection-level `update: adminAndStaff` to query-scoped access allowing hosts to update shows where they're linked
> 
> - Location: `src/access/hostAccess.ts` (hideFromHosts, readOnlyFieldForHosts functions)
> - Applied in: `src/collections/Episodes.ts` (field.access on ~80 fields), `src/collections/Shows.ts` (field.access + collection update query)

**Implication**: The CHANGELOG mentions that field-level `admin.hidden` with functions is being used. In Payload v3, the config is serialized client-side, so function-based visibility may not work in Admin UI. This means:
- ✅ Function-based visibility might work in Payload v2 (current version inferred from code)
- ⚠️ May break if upgrading to Payload v3 without refactoring

**Recommendation**: Verify Payload version and test that `admin.hidden: ({ user }) => user?.role === 'host'` works as expected. If upgrading to v3, may need to use static role-based visibility or alternative approach.

---

## 8. RISK CHECKS

### Risk 1: Access Functions Using `id` or `data` During Access Operation

**Pattern**: Access functions receive `req` object with `user`, `id` (for update/delete), and `data` (for create/update).

**Risk**: In some operations (e.g., collection-level `read` or `admin`), `id` and `data` may be undefined. Using them without guards causes errors.

**Audit Result**: ✅ All access functions safely handle undefined cases:
- Most only use `req.user`, which is always safe
- Update functions that use `id` (Users.ts line 42) properly guard: `if (!u) return false` before using `u.id`

**Examples**:
```typescript
// ✅ SAFE (Users.ts line 42)
update: ({ req, id }) => {
  const u = req.user as any
  if (!u) return false // Guards before using u.id
  if (u.role === 'admin') return true
  return String(u.id) === String(id)
}

// ✅ SAFE (hostAccess.ts)
export const episodesHostAccess: Access = ({ req: { user } }) => {
  if (!user) return true // Guards before using user.role
  if (user.role === 'admin' || user.role === 'staff') {
    return true
  }
  // ...
}
```

### Risk 2: "Deny by Default" Patterns That Cascade

**Pattern**: Access functions that return `false` as default for unknown cases.

**Risk**: New features or roles might be unintentionally blocked.

**Audit Result**: ⚠️ Several functions have "deny by default":
- `hostCanCreate`: Returns `false` if `!user` or role not in `['admin', 'staff', 'host']`
- `readOnlyForHosts`: Returns `false` for non-admin/staff (including hosts and regular users)
- `episodesHostAccess`, `showsHostAccess`: Return `false` for authenticated users with unknown roles

**Example**:
```typescript
// ⚠️ DENY BY DEFAULT (hostAccess.ts line 38-60)
export const episodesHostAccess: Access = ({ req: { user } }) => {
  if (!user) return true
  if (user.role === 'admin' || user.role === 'staff') return true
  if (user.role === 'host' && user.host) {
    // ... return query
  }
  return false // ⚠️ Regular users (role='user') get denied
}
```

**Impact**: Intended behavior (regular users shouldn't see episodes in admin). But if a new role is added (e.g., `editor`), they'd be denied by default.

**Recommendation**: Document that new roles require updating access functions. Consider explicit role checks instead of implicit fallthrough to `false`.

### Risk 3: Missing `user.host` Validation

**Pattern**: Access functions check `user.role === 'host' && user.host` but don't validate that `user.host` points to a valid host record.

**Risk**: If a user has `role: 'host'` but no linked `host` field (or linked to deleted host), the query will fail silently or return empty results.

**Example**:
```typescript
// ⚠️ ASSUMES user.host EXISTS (hostAccess.ts line 49-55)
if (user.role === 'host' && user.host) {
  const hostId = typeof user.host === 'string' ? user.host : user.host.id
  return {
    hosts: {
      contains: hostId,
    },
  }
}
```

**Audit Result**: No validation that `user.host` points to an existing host record.

**Recommendation**: Add validation in beforeValidate hook or access function to ensure `user.host` is populated for users with `role: 'host'`.

### Risk 4: Field-Level Access Without Collection-Level Context

**Pattern**: Field-level `access` functions receive the same `req` object, but without context about which operation is being performed (read vs update vs create).

**Risk**: Using field-level `access.read` blocks both UI visibility AND query capability. Using `access.update` allows reads but blocks updates.

**Audit Result**: ✅ Current implementation uses correct pattern after Oct 25 fixes:
- Scheduling fields: `access.update: hideFromHosts` (blocks updates, allows reads)
- Sensitive fields: `access.read: hideFromHosts` (blocks reads, admin panel hides them)

**Lesson Learned**: Document that field-level `access.read` affects query capability, not just visibility.

---

## 9. PROPOSED MINIMAL CHANGES (Config-Only)

### Goal
Separate **Admin Panel Access** from **Public/App API Access** with minimal, reversible changes.

### Proposal 1: Use `access.admin` for Admin Panel Gating

**Change**: Add `access.admin` to Episodes, Shows, Hosts, Users, Genres, Media collections.

**Episodes**:
```typescript
access: {
  read: () => true, // Keep public API access
  admin: ({ req }) => {
    const user = req.user as any
    if (!user) return false
    return ['admin', 'staff'].includes(user.role) // Only admin/staff in panel
  },
  // ... rest unchanged
}
```

**Shows**:
```typescript
access: {
  read: () => true, // Keep public API access
  admin: ({ req }) => {
    const user = req.user as any
    if (!user) return false
    return ['admin', 'staff'].includes(user.role)
  },
  // ... rest unchanged
}
```

**Hosts**:
```typescript
access: {
  read: hostsReadAccess, // Keep current (public + scoped for hosts)
  admin: ({ req }) => {
    const user = req.user as any
    if (!user) return false
    return ['admin', 'staff'].includes(user.role)
  },
  // ... rest unchanged
}
```

**Impact**:
- ✅ Hosts can no longer access Episodes/Shows/Hosts in admin panel (even via direct URL)
- ✅ Frontend API (`/api/episodes`, `/api/shows`) remains public
- ✅ Upload form (custom view) still accessible (not gated by collection `access.admin`)
- ⚠️ Need to verify custom views are not blocked by collection-level `access.admin`

### Proposal 2: Create Reusable `isAdmin` / `hasRole` Helpers

**File**: `/src/access/roleHelpers.ts` (new file)

```typescript
import { Access } from 'payload'

/**
 * Admin panel access: only admin/staff
 */
export const adminPanelOnly: Access = ({ req }) => {
  const user = req.user as any
  if (!user) return false
  return ['admin', 'staff'].includes(user.role)
}

/**
 * Check if user has any of the given roles
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
```

**Usage**:
```typescript
import { adminPanelOnly } from '../access/roleHelpers'

const Episodes: CollectionConfig = {
  // ...
  access: {
    read: () => true,
    admin: adminPanelOnly, // ✅ Cleaner than inline function
    // ...
  },
}
```

**Impact**: ✅ Reduces duplication, easier to audit role checks.

### Proposal 3: Validate `user.host` Exists for Host Role

**File**: `/src/collections/Users.ts`

**Add beforeValidate hook**:
```typescript
hooks: {
  beforeValidate: [
    ({ data }) => {
      // Existing favorites validation...
      
      // NEW: Validate host users have linked host
      if (data?.role === 'host' && !data?.host) {
        throw new Error('Users with role "host" must have a linked host profile')
      }
      
      return data
    },
  ],
  // ...
}
```

**Impact**: ✅ Prevents creating host users without linked profile, avoiding silent failures in access functions.

### Proposal 4: Restore Intended `publishedOnly` Read Access (If Applicable)

**Check**: Are there any collections that should restrict `read` access to published documents only?

**Example** (if needed):
```typescript
access: {
  read: ({ req }) => {
    const user = req.user as any
    // Admin/staff can see drafts
    if (user?.role === 'admin' || user?.role === 'staff') return true
    // Public can only see published
    return { publishedStatus: { equals: 'published' } }
  },
}
```

**Current State**: Episodes and Shows have `publishedStatus` field but `read: () => true` returns all documents (including drafts).

**Decision Needed**: Should frontend API only see published episodes? Or is admin-only draft visibility enforced elsewhere?

---

## 10. QUESTIONS & RISKS

1. **Custom Views and `access.admin`**: Do custom admin views (`/admin/upload-episode`, `/admin/planner`) respect collection-level `access.admin`? Or are they independently accessible?
   - **Test**: Add `access.admin` to Episodes and verify upload form is still accessible for hosts.

2. **Payload Version**: Is this Payload v2 or v3? Function-based `admin.hidden` may not work in v3 (config serialization issue).
   - **Check**: `package.json` or `pnpm-lock.yaml` for Payload version.
   - **Risk**: If v3, need to refactor to static visibility or alternative approach.

3. **Published vs Draft Visibility**: Should frontend API only show published episodes, or is current "all episodes" behavior intended?
   - **Clarification**: What's the intended visibility for drafts on the frontend app?

4. **Host Upload Form**: Does the upload form rely on querying Episodes/Shows collections, or does it bypass access control via custom server actions?
   - **Check**: `src/admin/components/EpisodeUploadView.tsx` uses `/api/episodes`, `/api/shows` endpoints. If `access.admin` blocks these, form will break.
   - **Solution**: Custom views should use Local API with `overrideAccess: true` if needed, or keep collections accessible for authenticated users.

5. **GraphQL API**: Are there any GraphQL queries from the frontend that would be affected by `access.admin` or `access.read` changes?
   - **Check**: Search for GraphQL queries in frontend codebase.

6. **Migration Impact**: How many existing host users are there? Will they be locked out of the admin panel after applying `access.admin` changes?
   - **Risk**: High impact if hosts are actively using the admin panel for anything other than the upload form.
   - **Mitigation**: Ensure upload form and any other host-accessible features remain available.

7. **Role Field Consistency**: Are there any users with `role: 'host'` but no `host` field? Would break access functions.
   - **Query**: `db.users.find({ role: 'host', host: { $exists: false } })`

8. **Edge Case**: What happens if a host is deleted but user still has `user.host` pointing to deleted ID?
   - **Risk**: Access functions would query `{ hosts: { contains: <deleted_id> } }`, returning empty results.
   - **Solution**: Add cascade delete or validation to prevent orphaned references.

---

## 11. LOGS (No Failing Requests Provided)

**Note**: No logs or stack traces were provided in the task description. The Oct 25 CHANGELOG documents errors:
- Login: `403 Forbidden on /api/users?where[email][equals]=...`
- Query Error: `"The following paths cannot be queried: scheduledAt, scheduledAt"`
- Frontend: No error codes documented, just "couldn't see ANY episodes/shows"

**Recommendation**: Monitor logs after applying changes to confirm:
- Hosts can no longer access admin panel routes for Episodes/Shows/Hosts
- Frontend API calls still succeed for unauthenticated and authenticated users
- Upload form remains accessible for hosts

---

## 12. IMPLEMENTATION CHECKLIST

**Pre-Implementation**:
- [ ] Verify Payload version (v2 vs v3)
- [ ] Query database for orphaned host users (`role: 'host'` without `host` field)
- [ ] Confirm custom views don't rely on collection `access.admin`
- [ ] Decide on published-only read access for Episodes/Shows

**Implementation**:
- [ ] Create `/src/access/roleHelpers.ts` with reusable helpers
- [ ] Add `access.admin: adminPanelOnly` to Episodes, Shows, Hosts, Users, Genres, Media
- [ ] Add `user.host` validation hook to Users collection
- [ ] Test upload form still works for hosts
- [ ] Test planner still works for admin/staff
- [ ] Test frontend app still works for all user types (unauthenticated, regular, host, staff, admin)
- [ ] Test login flow still works
- [ ] Update documentation with new access control patterns

**Post-Implementation**:
- [ ] Monitor logs for access denied errors
- [ ] Verify hosts can't access admin panel routes directly (e.g., `/admin/collections/episodes`)
- [ ] Verify hosts CAN access custom views (`/admin/upload-episode`)
- [ ] Update CHANGELOG with changes

---

## 13. REFERENCE LINKS

**Payload Docs**:
- Access Control Overview: https://payloadcms.com/docs/access-control/overview
- Collection Access: https://payloadcms.com/docs/access-control/collections
- Admin Panel Gating (`access.admin`): https://payloadcms.com/docs/admin/overview
- Auth & JWT (`saveToJWT`): https://payloadcms.com/docs/authentication/overview
- Field Config & Admin Props: https://payloadcms.com/docs/fields/overview

**Codebase References**:
- `/srv/payload/CHANGELOG.md` (lines 20-59: Oct 25 fixes, lines 129-192: Oct 23 implementation)
- `/srv/payload/src/access/hostAccess.ts` (all access functions)
- `/srv/payload/src/collections/Episodes.ts` (lines 20-54: access config, 277-327: scheduling fields)
- `/srv/payload/src/collections/Shows.ts` (lines 9-37: access config)
- `/srv/payload/src/collections/Users.ts` (lines 22-61: access config, 169-178: role field)
- `/srv/payload/src/admin/hooks/useUnscheduledEpisodes.ts` (line 59: frontend API call)
- `/srv/payload/src/admin/components/EpisodeUploadView.tsx` (lines 70-141: auth and data loading)

---

**END OF REVIEWER PACK**













