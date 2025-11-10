# BACKEND ACCESS RULES AUDIT — App Read Access

**Audit Date**: 2025-10-27  
**Status**: 🚨 **FIELD-LEVEL ACCESS BLOCKING APP READS**  
**Objective**: Confirm public/app reads remain fully accessible, identify field-level restrictions

---

## 1. SUMMARY (10 bullets)

1. 🚨 **CRITICAL**: `episodes.track_id` has `access: { read: hideFromHosts }` → blocks ALL authenticated hosts from reading this field (Episodes.ts line 411)

2. 🚨 **CRITICAL**: `episodes.libretimeTrackId` has `access: { read: hideFromHosts }` → blocks ALL authenticated hosts from reading this field (Episodes.ts line 343)

3. 🚨 **ISSUE**: `hideFromHosts` function (hostAccess.ts lines 129-133) returns `false` for hosts, which blocks **API reads**, not just UI visibility

4. ✅ **Collection-level OK**: Episodes `access.read: () => true` (public) - collection is readable by all

5. ✅ **Users.favorites OK**: NO field-level access restrictions (lines 209-213) - readable by owner via collection-level scoping

6. ✅ **Users.favoriteShows OK**: NO field-level access restrictions (lines 215-219) - readable by owner via collection-level scoping

7. ⚠️ **Users.access.read SCOPED**: Authenticated users (hosts/regular) can only read their own user record (lines 23-37) - this is OK for self-reads but blocks browsing other users

8. 🔴 **APP BREAKAGE**: If app queries episodes as authenticated host, `track_id` and `libretimeTrackId` are omitted from response → playback will fail

9. ✅ **Unauthenticated OK**: If app queries as unauthenticated, `hideFromHosts` returns `true` (line 130) → fields ARE present

10. 📋 **Root Cause**: Field-level `access.read` was used for UI hiding (Oct 23), but it affects API responses for all authenticated requests (same issue as Oct 25 scheduledAt fix)

---

## 2. RECAP: What Changed (5 lines)

**Oct 23** (`src/access/hostAccess.ts` created): Added `hideFromHosts` function for field-level access → applied to ~80 fields including `track_id`, `libretimeTrackId`, `mp3_url`, `media`, `bitrate`, etc.  
**Oct 25** (Emergency fix): Discovered `access.read: hideFromHosts` on scheduling fields blocks API queries → changed to `access.update: hideFromHosts` + `admin.hidden` for scheduledAt/scheduledEnd/airStatus (Episodes.ts lines 277-330).  
**Oct 27** (Today's changes): Removed function-based `admin.hidden` due to Payload v3 serialization errors → **DID NOT** change field-level `access.read: hideFromHosts` on track_id/libretimeTrackId.  
**Files modified**: `src/access/hostAccess.ts` (Oct 23), `src/collections/Episodes.ts` (Oct 23, 25, 27), `src/collections/Users.ts` (Oct 27).  
**Current state**: ~77 fields in Episodes still have `access: { read: hideFromHosts }` which blocks authenticated hosts from reading them.

---

## 3. COLLECTION-LEVEL ACCESS (Current State)

### Episodes Collection (`src/collections/Episodes.ts` lines 36-57)

```typescript
access: {
  read: () => true, // Public API access (needed for frontend app)
  admin: adminPanelOnly, // Only admin/staff can access in admin panel
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
```

**Effective Read Policy by Role**:
| Role | Collection Read | Where Constraints | Result |
|------|----------------|-------------------|--------|
| Unauthenticated | ✅ `true` | None | All episodes returned |
| Host | ✅ `true` | None | All episodes returned |
| Admin/Staff | ✅ `true` | None | All episodes returned |
| Regular user | ✅ `true` | None | All episodes returned |

**✅ Conclusion**: Collection-level read is public for ALL roles (no scoping by role or data).

**⚠️ BUT**: Field-level access rules filter which fields are returned (see section 4 below).

---

### Shows Collection (`src/collections/Shows.ts` lines 10-29)

```typescript
access: {
  read: () => true, // Public API access (needed for frontend app)
  admin: adminPanelOnly, // Only admin/staff can access in admin panel
  create: hostCanCreate, // Hosts can create shows (via upload form)
  update: ({ req }) => { /* scoped for hosts */ },
  delete: adminAndStaff,
}
```

**Effective Read Policy**: ✅ Public for all roles (same as Episodes)

---

### Users Collection (`src/collections/Users.ts` lines 22-63)

```typescript
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
  admin: adminPanelOnly,
  // ...
}
```

**Effective Read Policy by Role**:
| Role | Collection Read | Where Constraints | Result |
|------|----------------|-------------------|--------|
| Unauthenticated | ✅ `true` | None | All users returned (login flow) |
| Host | ✅ Query | `{ id: { equals: user.id } }` | Only own user record |
| Admin/Staff | ✅ `true` | None | All users returned |
| Regular user | ✅ Query | `{ id: { equals: user.id } }` | Only own user record |

**✅ Conclusion**: Users are scoped to self for authenticated non-admin/staff. This is OK for app reads (users query their own profile to get favorites).

---

## 4. FIELD-LEVEL ACCESS (Critical App Fields)

### A. `episodes.track_id` (Line 411)

**Definition**:
```typescript
{ 
  name: 'track_id', 
  type: 'number', 
  access: { read: hideFromHosts } 
}
```

**Location**: `src/collections/Episodes.ts` line 411 (in Audio/Tech tab)

**Access Function** (`hideFromHosts` from `src/access/hostAccess.ts` lines 129-133):
```typescript
export const hideFromHosts: Access = ({ req: { user } }) => {
  if (!user) return true // Public can see (for frontend)
  if (user.role === 'host') return false // Hide from hosts
  return true // Admin/staff/regular users can see
}
```

**Effective Read by Role**:
| Role | Can Read? | Returned in API? |
|------|-----------|------------------|
| Unauthenticated | ✅ Yes (`true`) | ✅ Present |
| Host | ❌ **NO** (`false`) | 🚨 **OMITTED** |
| Admin/Staff | ✅ Yes (`true`) | ✅ Present |
| Regular user | ✅ Yes (`true`) | ✅ Present |

🚨 **CRITICAL ISSUE**: If app queries episodes as authenticated host, `track_id` is omitted → playback breaks.

---

### B. `episodes.libretimeTrackId` (Line 343)

**Definition**:
```typescript
{
  name: 'libretimeTrackId',
  type: 'text',
  label: 'LibreTime Track ID',
  admin: {
    description: 'ID from LibreTime system for this track',
  },
  access: { read: hideFromHosts },
}
```

**Location**: `src/collections/Episodes.ts` line 343 (in Audio/Tech tab)

**Access Function**: Same `hideFromHosts` as above

**Effective Read by Role**: Same as `track_id` - hosts CANNOT read this field.

🚨 **CRITICAL ISSUE**: If app uses `libretimeTrackId` for playback/scheduling, authenticated hosts will not receive this field.

---

### C. `users.favorites` (Lines 209-213)

**Definition**:
```typescript
{
  name: 'favorites',
  type: 'relationship',
  relationTo: 'episodes',
  hasMany: true,
}
```

**Location**: `src/collections/Users.ts` lines 209-213

**Field-Level Access**: ❌ **NONE** (no `access` property on field)

**Collection-Level Access**: Scoped to own user (`id: { equals: user.id }`)

**Effective Read by Role**:
| Role | Can Read Own Favorites? | Can Read Others' Favorites? |
|------|------------------------|----------------------------|
| Unauthenticated | ✅ Yes (login flow) | ✅ Yes (all users) |
| Host | ✅ Yes (own user) | ❌ No (scoped) |
| Admin/Staff | ✅ Yes | ✅ Yes (all users) |
| Regular user | ✅ Yes (own user) | ❌ No (scoped) |

✅ **Conclusion**: Field is readable. App can query own user's favorites via `/api/users/:id` with auth.

---

### D. `users.favoriteShows` (Lines 215-219)

**Definition**:
```typescript
{
  name: 'favoriteShows',
  type: 'relationship',
  relationTo: 'shows',
  hasMany: true,
}
```

**Location**: `src/collections/Users.ts` lines 215-219

**Field-Level Access**: ❌ **NONE** (no `access` property on field)

**Collection-Level Access**: Same as favorites (scoped to own user)

✅ **Conclusion**: Field is readable. App can query own user's favoriteShows via `/api/users/:id` with auth.

---

## 5. AUTH/JWT WIRING

### `saveToJWT` Verification

**Users.role field** (`src/collections/Users.ts` lines 169-178):
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

✅ **Confirmed**: `saveToJWT: true` is present → `req.user.role` is reliable in all access functions.

### `overrideAccess` Usage

**Search result** (from earlier audit): Only 1 usage in codebase:

**File**: `/src/lib/auth/checkScheduleAuth.ts` (line 65)
```typescript
const user = await payload.findByID({
  collection: 'users',
  id: userIdFromToken,
  overrideAccess: true, // ✅ Legitimate use for auth validation
})
```

✅ **Conclusion**: No unsafe `overrideAccess` that would bypass field-level restrictions for app requests.

---

## 6. SUSPECT LOCATIONS

### 🚨 Suspect #1: `episodes.track_id` Field-Level Access

**File**: `src/collections/Episodes.ts`  
**Line**: 411  
**Current**:
```typescript
{ name: 'track_id', type: 'number', access: { read: hideFromHosts } }
```

**Problem**: `hideFromHosts` returns `false` for authenticated hosts → field omitted from API response

**Expected**: `access: { read: () => true }` or NO access property (inherits collection-level public read)

**Impact**: If app player uses `track_id` for playback and queries as authenticated host, playback will fail.

---

### 🚨 Suspect #2: `episodes.libretimeTrackId` Field-Level Access

**File**: `src/collections/Episodes.ts`  
**Line**: 343  
**Current**:
```typescript
{
  name: 'libretimeTrackId',
  type: 'text',
  label: 'LibreTime Track ID',
  admin: {
    description: 'ID from LibreTime system for this track',
  },
  access: { read: hideFromHosts },
}
```

**Problem**: Same as track_id - blocks authenticated hosts

**Expected**: `access: { read: () => true }` or remove `access` property

**Impact**: If app uses `libretimeTrackId` for scheduling/playback, authenticated hosts can't see it.

---

### 🚨 Suspect #3: Related Playback Fields Also Blocked

**File**: `src/collections/Episodes.ts`  
**Lines**: 336-420 (Audio/Tech tab)  
**Fields with `access: { read: hideFromHosts }`**:
- Line 338: `media` (upload relationship)
- Line 343: `libretimeTrackId`
- Line 348: `libretimeFilepathRelative`
- Line 355: `libretimeInstanceId`
- Line 362: `libretimePlayoutId`
- Line 408: `scPermalink`
- Line 410: `scSlug`
- Line 411: `track_id`
- Line 414: `mp3_url`
- Line 419: `bitrate`
- Line 420: `sampleRate`
- Line 421: `realDuration`
- Line 434: `hasArchiveFile`
- Line 441: `archiveFilePath`

**Total**: ~14 fields in Audio/Tech section blocked from authenticated hosts

**App Impact**: If app needs ANY of these for playback (mp3_url, bitrate, duration, etc.), authenticated hosts can't access them.

---

## 7. DIFF WINDOW (Changes Since Oct 23)

### Oct 23: Initial Field-Level Access Applied

**File**: `src/collections/Episodes.ts`  
**Backup**: `Episodes.ts.backup` (Oct 23 11:47)  
**Change**: Added `access: { read: hideFromHosts }` to ~80 fields

**Before** (Aug 20):
```typescript
{ name: 'track_id', type: 'number' } // No access restriction
```

**After** (Oct 23):
```typescript
{ name: 'track_id', type: 'number', access: { read: hideFromHosts } }
```

---

### Oct 25: Partial Fix (Scheduling Fields Only)

**File**: `src/collections/Episodes.ts`  
**Lines**: 277-330 (scheduledAt, scheduledEnd, airStatus)

**Changed**:
```diff
- access: { read: hideFromHosts }, // ❌ Blocked queries
+ access: { update: hideFromHosts }, // ✅ Allows queries, blocks updates
+ admin: { hidden: ({ user }) => user?.role === 'host' } // UI hiding
```

**Oct 25 CHANGELOG** (lines 38-43):
> Root cause: Field-level `access.read: hideFromHosts` blocked API queries, not just UI visibility  
> Design conflict: Admin panel should hide fields from hosts, but frontend app needs to query them  
> Fix: Changed scheduling fields from `access.read` to `access.update` + `admin.hidden`

**⚠️ But**: Only fixed 3 scheduling fields, left ~77 other fields with `access.read: hideFromHosts`

---

### Oct 27: Removed admin.hidden Functions

**File**: `src/collections/Episodes.ts`  
**Changes**: Removed function-based `admin.hidden` from 3 scheduling fields (lines 289, 304, 325)

**NOT Changed**: Field-level `access: { read: hideFromHosts }` on track_id, libretimeTrackId, mp3_url, etc.

---

## 8. RESPONSE BEHAVIOR SNAPSHOT

### Test Scenario Setup

**Query**: `GET /api/episodes?limit=1&depth=0`  
**Expected Field**: `track_id`, `libretimeTrackId`, `mp3_url`

### Scenario 1: Unauthenticated Request

**Request**:
```bash
curl http://localhost:3000/api/episodes?limit=1&depth=0
```

**Expected Result** (based on hideFromHosts line 130: `if (!user) return true`):
```json
{
  "docs": [{
    "id": "...",
    "title": "...",
    "track_id": 123456789,           // ✅ PRESENT
    "libretimeTrackId": "456",       // ✅ PRESENT
    "mp3_url": "https://...",        // ✅ PRESENT
    "bitrate": 320,                  // ✅ PRESENT
    // ... other fields
  }]
}
```

**Status**: ✅ Fields accessible for unauthenticated requests

---

### Scenario 2: Authenticated Host Request

**Request**:
```bash
curl http://localhost:3000/api/episodes?limit=1&depth=0 \
  -H "Authorization: Bearer <host-jwt-token>"
```

**Expected Result** (based on hideFromHosts line 131: `if (user.role === 'host') return false`):
```json
{
  "docs": [{
    "id": "...",
    "title": "...",
    // track_id: OMITTED          // 🚨 MISSING
    // libretimeTrackId: OMITTED  // 🚨 MISSING
    // mp3_url: OMITTED           // 🚨 MISSING
    // bitrate: OMITTED           // 🚨 MISSING
    // ... ~14 fields OMITTED
  }]
}
```

**Status**: 🚨 Fields BLOCKED for authenticated host requests

---

### Scenario 3: Authenticated Admin Request

**Request**:
```bash
curl http://localhost:3000/api/episodes?limit=1&depth=0 \
  -H "Authorization: Bearer <admin-jwt-token>"
```

**Expected Result** (based on hideFromHosts line 132: `return true`):
```json
{
  "docs": [{
    "id": "...",
    "title": "...",
    "track_id": 123456789,           // ✅ PRESENT
    "libretimeTrackId": "456",       // ✅ PRESENT
    "mp3_url": "https://...",        // ✅ PRESENT
    // ... all fields
  }]
}
```

**Status**: ✅ All fields accessible for admin

---

### Scenario 4: Authenticated Host Querying Own User

**Request**:
```bash
curl http://localhost:3000/api/users/{host-user-id}?depth=0 \
  -H "Authorization: Bearer <host-jwt-token>"
```

**Expected Result** (Users.access.read allows own user, favorites has no field-level access):
```json
{
  "id": "...",
  "email": "host@example.com",
  "role": "host",
  "host": "...",
  "favorites": ["episode-id-1", "episode-id-2"],      // ✅ PRESENT
  "favoriteShows": ["show-id-1", "show-id-2"],        // ✅ PRESENT
}
```

**Status**: ✅ Favorites fields accessible (no field-level restrictions)

---

## 9. SUSPECT FIELDS ENUMERATION

### Fields with `access: { read: hideFromHosts }` (Blocks Authenticated Hosts)

**File**: `src/collections/Episodes.ts`  
**Tab**: Audio / Tech (lines 333-452)

| Line | Field Name | Type | App Needs? | Current Access | Impact |
|------|-----------|------|------------|----------------|---------|
| 338 | `media` | upload | Maybe | `hideFromHosts` | Blocks hosts |
| 343 | `libretimeTrackId` | text | 🚨 **YES** (scheduling) | `hideFromHosts` | 🔴 Blocks hosts |
| 348 | `libretimeFilepathRelative` | text | Maybe | `hideFromHosts` | Blocks hosts |
| 355 | `libretimeInstanceId` | text | Maybe | `hideFromHosts` | Blocks hosts |
| 362 | `libretimePlayoutId` | text | No | `hideFromHosts` | Blocks hosts |
| 408 | `scPermalink` | text | Maybe | `hideFromHosts` | Blocks hosts |
| 410 | `scSlug` | text | Maybe | `hideFromHosts` | Blocks hosts |
| 411 | `track_id` | number | 🚨 **YES** (playback?) | `hideFromHosts` | 🔴 Blocks hosts |
| 414 | `mp3_url` | text | 🚨 **YES** (playback) | `hideFromHosts` | 🔴 Blocks hosts |
| 419 | `bitrate` | number | Maybe (metadata) | `hideFromHosts` | Blocks hosts |
| 420 | `sampleRate` | number | No | `hideFromHosts` | Blocks hosts |
| 421 | `realDuration` | number | Maybe (player UI) | `hideFromHosts` | Blocks hosts |
| 434 | `hasArchiveFile` | checkbox | No | `hideFromHosts` | Blocks hosts |
| 441 | `archiveFilePath` | text | No | `hideFromHosts` | Blocks hosts |

**Total**: 14 fields blocked from authenticated hosts

**App-Critical Fields** (need public read):
1. `track_id` - Legacy SoundCloud ID (if app uses for playback)
2. `libretimeTrackId` - LibreTime track ID (scheduling/playback)
3. `mp3_url` - Direct MP3 URL (playback)
4. `realDuration` - Actual duration in seconds (player UI)
5. `libretimeFilepathRelative` - File path for rehydration

---

## 10. QUESTIONS & RISKS (8 bullets)

1. **Which field does app use for playback?** `track_id` (legacy SoundCloud), `libretimeTrackId` (LibreTime), or `mp3_url` (direct URL)?
   - If ANY of these: authenticated hosts can't play episodes
   - Need to verify actual app player implementation

2. **Does app query episodes as authenticated or unauthenticated?**
   - If unauthenticated: ✅ Works (fields present)
   - If authenticated host: 🚨 Breaks (fields omitted)
   - If authenticated regular user: ✅ Works (fields present per hideFromHosts logic)

3. **Are favorites read-only for hosts or can they modify?**
   - Current: Hosts can update own user (Users.access.update line 44-56)
   - No field-level restriction on favorites/favoriteShows
   - ✅ Hosts can read AND update their own favorites

4. **Should ALL Audio/Tech fields be public?** Or only playback-critical ones?
   - Minimal fix: Only expose track_id, libretimeTrackId, mp3_url, realDuration
   - Broader fix: Make entire Audio/Tech tab public (14 fields)
   - Security consideration: Does hiding these fields provide real security value?

5. **Why was `hideFromHosts` used on these fields?** (Intent from Oct 23)
   - Likely: Hide technical/backend fields from host users in admin UI
   - Problem: Same as Oct 25 scheduledAt fix - `access.read` blocks queries, not just UI
   - Solution: Use `access.update: hideFromHosts` for write-protection only

6. **Is `track_id` still used?** (vs `libretimeTrackId`)
   - `track_id` appears to be legacy SoundCloud ID
   - `libretimeTrackId` is current LibreTime system ID
   - If app still uses `track_id`, need to keep it public
   - If deprecated, can leave restricted

7. **Side effects of making fields public?**
   - Hosts will see technical fields (bitrate, sampleRate, file paths) in API responses
   - If app doesn't use these, no impact
   - If security concern (hide archive paths?), keep those restricted, expose only playback fields

8. **Does app query episode relationships with depth > 0?**
   - If `depth: 1`, response includes populated `show`, `hosts`, etc.
   - If `show` or `hosts` have field-level restrictions, could cascade issues
   - Need to verify app query patterns (depth parameter)

---

## 11. MINIMAL FIX OPTIONS (No Code Yet)

### Option A: Make Playback Fields Public (Minimal)

**Change**: Remove `access: { read: hideFromHosts }` from playback-critical fields only:
1. `track_id` (line 411) - Remove `access` property
2. `libretimeTrackId` (line 343) - Remove `access.read`, keep field
3. `mp3_url` (line 414) - Remove `access` property
4. `realDuration` (line 421) - Remove `access` property (if app shows duration)

**Impact**: ✅ App can play episodes as authenticated host, ✅ Other technical fields remain hidden

---

### Option B: Make All Audio/Tech Fields Public (Broader)

**Change**: Remove `access: { read: hideFromHosts }` from entire Audio/Tech tab (lines 336-452)

**Fields affected**: ~14 fields including media, libretimeTrackId, bitrate, file paths, etc.

**Impact**: ✅ App has full access to technical fields, ⚠️ Hosts see backend fields in admin UI (cosmetic only, can't edit due to `access.update`)

---

### Option C: Follow Oct 25 Pattern (Change read → update)

**Change**: For fields that hosts should see but not modify:
```typescript
// FROM:
access: { read: hideFromHosts }

// TO:
access: { update: hideFromHosts }
// (Remove admin.hidden since it causes v3 errors)
```

**Fields to change**:
- `track_id` (line 411)
- `libretimeTrackId` (line 343)
- `mp3_url` (line 414)
- Other playback-related fields

**Impact**: ✅ Fields readable by all (including hosts), ❌ Hosts can't modify (security enforced), ✅ Matches Oct 25 scheduling fields pattern

---

### Option D: Targeted Public Read for App-Consumed Fields

**Change**: Create new helper `publicRead` for app-critical fields:

```typescript
// src/access/publicRead.ts
export const publicRead: Access = () => true
```

**Apply to**:
- `track_id`, `libretimeTrackId`, `mp3_url`, `realDuration`, `libretimeFilepathRelative`

**Keep `hideFromHosts` on**:
- `libretimeInstanceId`, `libretimePlayoutId`, `bitrate`, `sampleRate`, `archiveFilePath`, `hasArchiveFile`

**Impact**: ✅ Minimal exposure, ✅ Only app-consumed fields public, ✅ Backend fields remain hidden

---

## 12. OTHER APP-CONSUMED FIELDS (Verify Readable)

### Common Episode Fields (For Catalog Browsing)

| Field | Line | Access | Readable by Hosts? |
|-------|------|--------|-------------------|
| `title` | 73 | None | ✅ Yes |
| `description` | 92 | None | ✅ Yes |
| `cover` | 93 | None | ✅ Yes |
| `show` | 78 | `update: readOnlyFieldForHosts` | ✅ Yes (read OK) |
| `hosts` | 87 | None | ✅ Yes |
| `publishedStatus` | 104 | `update: readOnlyFieldForHosts` | ✅ Yes (read OK) |
| `publishedAt` | 116 | `read: hideFromHosts` | ⚠️ **NO** (hosts blocked) |
| `duration` | 125 | `read: hideFromHosts` | ⚠️ **NO** (hosts blocked) |
| `roundedDuration` | 143 | `update: readOnlyFieldForHosts` | ✅ Yes (read OK) |
| `genres` | 163 | None | ✅ Yes |
| `energy` | 181 | None | ✅ Yes |
| `mood` | 195 | None | ✅ Yes |
| `tone` | 220 | None | ✅ Yes |

**Additional Suspects**:
- `publishedAt` (line 116) - If app shows publish date, blocked for hosts
- `duration` (line 125) - If app shows episode length, blocked for hosts

---

## 13. QUESTIONS & RISKS

### Questions (Require Clarification)

1. **What field does the app player use?** `track_id`, `libretimeTrackId`, or `mp3_url`?
   - Check app codebase for episode playback logic
   - Query: Search for `track_id` or `mp3_url` in app API calls

2. **Does app query as authenticated or unauthenticated?**
   - If authenticated host: Fields are blocked (current issue)
   - If unauthenticated: Fields are visible (would work)
   - Check app's authentication pattern for episode queries

3. **Is `track_id` legacy or still in use?**
   - If legacy SoundCloud ID: Can leave restricted
   - If actively used: Need to make public
   - Verify which ID field app actually consumes

4. **Should hosts see `publishedAt` and `duration`?**
   - Both currently blocked (`access.read: hideFromHosts`)
   - If app shows these in episode cards, hosts can't see them
   - Likely need to make public (or change to `access.update`)

### Risks (Impact Assessment)

5. **High Risk 🚨**: If app plays episodes as authenticated host, playback is currently broken
   - Symptoms: No audio URL, "track not found", or silent failures
   - Likelihood: High (if hosts browse their own shows in app)

6. **Medium Risk ⚠️**: Inconsistent behavior between unauth and auth app users
   - Unauthenticated users see all fields (including playback URLs)
   - Authenticated hosts don't see playback fields
   - Confusing UX: "Why can't I play episodes after logging in?"

7. **Medium Risk ⚠️**: Oct 25 fix was incomplete (only fixed 3 fields)
   - Oct 25 changelog identified the pattern: field-level `access.read` blocks queries
   - Fixed scheduledAt/scheduledEnd/airStatus but left ~77 other fields with same issue
   - Systematic fix needed: Apply same pattern (read → update) to ALL hideFromHosts fields

8. **Low Risk ✅**: Users.favorites and favoriteShows are OK
   - No field-level access restrictions
   - Collection-level scoping allows own user reads
   - App can query `/api/users/:id` to get favorites

---

## 14. RECOMMENDED MINIMAL FIX

### Priority 1: Make Playback Fields Public (Critical)

**Apply Oct 25 pattern** (change `access.read` → `access.update` OR remove entirely):

**Episodes.ts** - Remove `access` property from these fields (inherit public from collection):
- Line 411: `track_id` → Remove `access: { read: hideFromHosts }`
- Line 343: `libretimeTrackId` → Remove `access: { read: hideFromHosts }`  
- Line 414: `mp3_url` → Remove `access: { read: hideFromHosts }`
- Line 421: `realDuration` → Remove `access: { read: hideFromHosts }`
- Line 348: `libretimeFilepathRelative` → Remove `access: { read: hideFromHosts }` (if app uses for rehydration)

**OR** (if you want to block updates):
```typescript
access: { update: hideFromHosts } // Allows reads, blocks updates
```

**Impact**: ✅ App can play episodes as authenticated host, ✅ Minimal change (5 fields)

---

### Priority 2: Make Display Fields Public (Important)

**Episodes.ts** - Fields used in app catalog/cards:
- Line 116: `publishedAt` → Remove or change to `access.update`
- Line 125: `duration` → Remove or change to `access.update`

**Impact**: ✅ App can show publish dates and durations for authenticated hosts

---

### Priority 3: Verify Other App-Consumed Fields

**Check if app uses** (and make public if needed):
- `bitrate` (line 419) - Metadata display
- `libretimeFilepathRelative` (line 348) - File path references
- Any other fields shown in app UI when browsing as authenticated user

---

## 15. LOGS (Response Samples)

**Note**: Container needs to be running to capture actual responses. Based on code analysis:

### Expected Unauthenticated Response (✅ Works)
```json
{
  "docs": [{
    "id": "67...",
    "title": "Episode Title",
    "track_id": 864749443,
    "libretimeTrackId": "123",
    "mp3_url": "https://example.com/track.mp3",
    "realDuration": 3599,
    "publishedAt": "2025-10-15T10:00:00.000Z",
    "duration": 3599
  }],
  "totalDocs": 1,
  "limit": 1
}
```

### Expected Authenticated Host Response (🚨 Broken)
```json
{
  "docs": [{
    "id": "67...",
    "title": "Episode Title",
    // MISSING: track_id
    // MISSING: libretimeTrackId
    // MISSING: mp3_url
    // MISSING: realDuration
    // MISSING: publishedAt
    // MISSING: duration
  }],
  "totalDocs": 1,
  "limit": 1
}
```

### Error Log Pattern (if app tries to use missing field)
```
[APP] Error: Cannot read property 'mp3_url' of undefined
[APP] Episode playback failed: No track URL found
[APP] TypeError: Cannot access track_id on undefined
```

---

## 16. ROLLBACK FOR THIS AUDIT

**No code changes made** - this is audit only.

**Existing backups** from today's changes: `*.ts.backup-20251027-083735`

---

**END OF APP ACCESS AUDIT REVIEWER PACK**




