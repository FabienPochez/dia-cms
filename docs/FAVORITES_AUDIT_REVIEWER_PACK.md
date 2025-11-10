# FAVORITES AUDIT REVIEWER PACK
**Date:** 2025-10-13  
**Role:** Strategist & QC  
**Objective:** Audit user favorites modeling for Episodes vs Shows

---

## 1. SUMMARY

### Schema Design
- **Users collection** stores favorites in TWO separate relationship fields:
  - `favorites` → `relationTo: 'episodes'` (hasMany: true)
  - `favoriteShows` → `relationTo: 'shows'` (hasMany: true)
- Both fields are simple ID arrays, no join tables or nested objects
- Migration script exists (`scripts/migrate-favorites-to-relationship.ts`) to convert legacy `{ episode }` format to flat ID arrays

### Query & Population
- **Default depth:** 2 (Payload global default, no custom `auth.depth` set on Users collection)
- **REST `/api/users/me`** uses `collection.config.auth.depth` (defaults to 2) → **populates both favorites & favoriteShows**
- **GraphQL `/api/graphql`** forces `depth: 0` → returns only IDs, no population
- No `where` filters or conditional population — relationships populate unconditionally at depth 2

### Access Control
- Shows collection: `publicAccess` (all operations return `true`)
- Episodes collection: `publicAccess` (all operations return `true`)
- Users read access: `() => true` (public read)
- **No filtering** on `status: archived` or `visibility: unlisted` when populating relationships

### Critical Asymmetry Detected
- **Shows default status:** `archived` (line 55, Shows.ts)
- **Shows visibility:** optional `'public' | 'unlisted'` with no default
- **No access control hooks** to exclude archived/unlisted shows from favorites population
- **Field naming drift:** `favorites` (episodes) vs `favoriteShows` (shows) — inconsistent plural usage

---

## 2. DIFFS
**None** — audit-only, no code modifications performed

---

## 3. LOGS

### Repository Structure
```
/srv/payload/src/collections/
├── Users.ts          # Auth collection with favorites fields
├── Episodes.ts       # 555 lines, public access
├── Shows.ts          # 146 lines, public access, default status: archived
├── Hosts.ts
├── Genres.ts
└── Media*.ts
```

### Key Grep Results (favorites-related)
```bash
# Favorites field definitions
/srv/payload/src/collections/Users.ts:162:      name: 'favorites',
/srv/payload/src/collections/Users.ts:164:      relationTo: 'episodes',
/srv/payload/src/collections/Users.ts:168:      name: 'favoriteShows',
/srv/payload/src/collections/Users.ts:170:      relationTo: 'shows',

# TypeScript types
/srv/payload/src/payload-types.ts:139:  favorites?: (string | Episode)[] | null;
/srv/payload/src/payload-types.ts:140:  favoriteShows?: (string | Show)[] | null;

# Migration logic
/srv/payload/src/collections/Users.ts:42-74:  # beforeValidate hook for episodes favorites
/srv/payload/src/collections/Users.ts:76-108: # beforeValidate hook for show favorites
```

### Access Control Findings
```typescript
// Shows.ts (line 8)
access: publicAccess

// publicAccess.ts
export const publicAccess = {
  read: () => true,   // ← No status/visibility filtering
  create: () => true,
  update: () => true,
  delete: () => true,
}
```

### Payload /me Endpoint Logic
```javascript
// .pnpm-store meOperation source (line 13)
depth: isGraphQL ? 0 : collection.config.auth.depth

// Payload defaults (line 46)
defaultDepth: 2

// Users collection auth config (Users.ts line 5-13)
auth: {
  useAPIKey: true,
  // NO custom depth property → defaults to 2
  cookies: { sameSite: 'None', secure: true, domain: 'content.diaradio.live' }
}
```

### Shows Schema Highlights
```typescript
// Shows.ts lines 49-58
{
  name: 'status',
  type: 'select',
  options: [
    { label: 'Active', value: 'active' },
    { label: 'Archived', value: 'archived' },
  ],
  defaultValue: 'archived',  // ← RED FLAG: defaults to archived!
  required: true,
}
```

### No Depth/Where Overrides Found
```bash
$ grep -RniE "depth.*[0-9]|depth:\s*['"0-9]" /srv/payload/src
# Results: Only schedule-related admin hooks use depth: 1
# NO custom depth in Users collection or /me endpoint handlers
```

---

## 4. QUESTIONS & RISKS

### 🚨 Critical Risks
1. **Archived shows populate by default**  
   - Shows default to `status: 'archived'` but `publicAccess` has no filtering  
   - Frontend app may receive archived shows in `user.favoriteShows[]` at depth 2  
   - Episodes favorites likely work because episodes default to `publishedStatus: 'draft'` (different field)

2. **No visibility filtering**  
   - Shows can be `visibility: 'unlisted'` with no access control to exclude them  
   - Unlisted shows still populate in favorites if user favorited them before visibility change

3. **GraphQL returns IDs only**  
   - GraphQL `/me` query uses `depth: 0` → favorites/favoriteShows are unpopulated  
   - If frontend uses GraphQL instead of REST, shows won't populate at all

### 🔍 Investigative Questions
4. **Frontend consumption pattern?**  
   - Does dia-radio-app.vercel.app use REST `/api/users/me` or GraphQL?  
   - What depth parameter does it pass (if any override)?

5. **Is there a separate afterRead hook?**  
   - Payload allows `afterRead` hooks on relationships to filter populated docs  
   - No such hook found in Users/Shows/Episodes collections — worth confirming

6. **Why the naming asymmetry?**  
   - `favorites` (episodes) vs `favoriteShows` (shows) — different plural patterns  
   - Could cause frontend confusion (e.g., `user.favorites` vs `user.favoriteShows`)

7. **Migration coverage for shows?**  
   - `migrate-favorites-to-relationship.ts` only migrates episode favorites (lines 37-62)  
   - No parallel migration for `favoriteShows` — were show favorites always flat IDs?

8. **Access control on nested depth?**  
   - When favorites populate at depth 2, does Payload run `read` access on each show/episode?  
   - If yes, `publicAccess.read: () => true` allows everything regardless of status

---

## 5. RECOMMENDATION MATRIX

| Issue | Severity | Fix Scope | Owner |
|-------|----------|-----------|-------|
| Shows default to archived | **HIGH** | Change Shows.ts defaultValue to 'active' OR add access control | Backend |
| No visibility filtering | **MEDIUM** | Add afterRead hook or access control for unlisted items | Backend |
| GraphQL depth 0 | **MEDIUM** | Document limitation OR add custom GraphQL resolver | API/Docs |
| Field naming asymmetry | **LOW** | Standardize to `favoriteEpisodes` + `favoriteShows` (breaking change) | Backend |
| No show migration script | **INFO** | Verify show favorites were always flat, document in CHANGELOG | QA |

---

## 6. NEXT STEPS (NOT EXECUTED)
1. **Verify frontend consumption:**  
   ```bash
   # Check dia-radio-app repo for:
   grep -r "/api/users/me" .
   grep -r "depth=" .
   grep -r "favoriteShows" .
   ```

2. **Test archived show behavior:**  
   - Create user with favorited show (status: active)  
   - Change show to `status: archived`  
   - Call `/api/users/me?depth=2`  
   - Confirm if archived show still populates

3. **Consider access control fix:**  
   ```typescript
   // Shows.ts - add read access filter
   access: {
     read: ({ req, doc }) => {
       // Public read for active + public shows only
       if (req.user?.role === 'admin') return true
       return doc.status === 'active' && doc.visibility !== 'unlisted'
     }
   }
   ```

4. **Add depth override for /me endpoint:**  
   ```typescript
   // Users.ts auth config
   auth: {
     depth: 2,  // explicit override (currently defaults to 2)
     useAPIKey: true,
     // ... rest
   }
   ```

---

**END OF REVIEWER PACK**

