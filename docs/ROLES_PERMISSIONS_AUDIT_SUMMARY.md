# PAYLOAD ROLES & PERMISSIONS AUDIT — Executive Summary

**Audit Date**: 2025-10-27  
**Status**: ⚠️ Security Gap Identified  
**Full Report**: `ROLES_PERMISSIONS_AUDIT_REVIEWER_PACK.md`

---

## THE PROBLEM (3 sentences)

Recent attempts (Oct 23) to restrict admin panel access for Hosts broke the frontend API because Payload's `access.read` applies to **ALL** API requests with no distinction between "admin panel" and "public API". Emergency fixes (Oct 25) reverted to public API access (`read: () => true`) and used `admin.hidden` for visual hiding, which is **NOT** real access control. Currently, Hosts are visually hidden from collections but can still access admin panel routes directly.

---

## WHAT BROKE (Timeline)

### Oct 23: Host Access Control Implementation
- ❌ Used `access.read` to restrict hosts to their own content
- ❌ Applied to Episodes, Shows, Hosts collections
- ❌ Added field-level `access.read: hideFromHosts` on ~80 fields

### Oct 25: Three Emergency Fixes

#### Fix 1: Login Failure
**Issue**: 403 Forbidden on login  
**Cause**: `access.read` blocked unauthenticated users from reading their own user record (chicken-and-egg)  
**Fix**: Changed Users `read` to allow unauthenticated

#### Fix 2: Query Error on Scheduling Fields
**Issue**: `"The following paths cannot be queried: scheduledAt"`  
**Cause**: Field-level `access.read: hideFromHosts` blocked API queries, not just UI visibility  
**Fix**: Changed to `access.update: hideFromHosts` + `admin.hidden` (allows queries, blocks updates)

#### Fix 3: Frontend App Broke for All Users
**Issue**: Hosts saw only their own content, regular users saw nothing  
**Cause**: `access.read` restricted API returns, breaking frontend catalog browsing  
**Fix**: Reverted Episodes/Shows to `read: () => true` (public API)

---

## CURRENT STATE (Security Assessment)

### ✅ What's Working
- Frontend API is public and accessible to all users
- Write operations (`create`, `update`, `delete`) are properly restricted
- Field-level updates are blocked for hosts via `access.update`
- Role field has `saveToJWT: true` so `req.user.role` is reliable

### ❌ What's NOT Working (Security Gaps)
1. **NO `access.admin` in use**: Collections use `admin.hidden` for visual hiding, not access control
2. **Hosts can access admin routes directly**: Navigate to `/admin/collections/episodes` → not blocked
3. **No separation of admin vs API access**: Same `access.read` controls both panel and public API
4. **Field hiding is visual only**: `admin.hidden` doesn't prevent API reads of hidden fields

### Current Access Matrix

| Collection | `access.read` | `access.admin` | `admin.hidden` |
|------------|---------------|----------------|----------------|
| Episodes   | `() => true` (public) | ❌ Not used | ✅ Hide from hosts |
| Shows      | `() => true` (public) | ❌ Not used | ✅ Hide from hosts |
| Hosts      | Public + scoped for hosts | ❌ Not used | ✅ Hide from hosts |
| Users      | Scoped (public + own user) | ❌ Not used | ✅ Hide from hosts |
| Genres     | `() => true` (public) | ❌ Not used | ✅ Hide from hosts |
| Media      | `publicAccess` (all ops) | ❌ Not used | ✅ Hide from hosts |

---

## ROOT CAUSE

**Payload Design**: `access.read` applies to **ALL** API requests:
- Admin Panel UI routes (`/admin/collections/episodes`)
- REST API endpoints (`/api/episodes`)
- GraphQL API
- Local API (server-side)

**No Native Support** for:
- "Admin panel only" access control separate from API access
- Different access rules for authenticated admin users vs public API consumers

**The Conflict**:
- **Admin goal**: Restrict hosts to seeing only their own content in admin panel
- **Frontend goal**: Public catalog browsing for all users (including authenticated hosts)
- **Payload limitation**: Can't achieve both with `access.read`

---

## RECOMMENDED SOLUTION

### Use `access.admin` for Admin Panel Gating

**Change**: Add `access.admin` to all collections that should be admin/staff only.

**Example** (Episodes):
```typescript
access: {
  read: () => true, // Keep public API access
  admin: ({ req }) => {
    const user = req.user as any
    if (!user) return false
    return ['admin', 'staff'].includes(user.role)
  },
  create: hostCanCreate,
  update: /* scoped for hosts */,
  delete: adminAndStaff,
}
```

**Impact**:
- ✅ Hosts **cannot** access admin panel routes for Episodes/Shows/Hosts (even via direct URL)
- ✅ Frontend API (`/api/episodes`) remains **public** for all users
- ✅ Upload form (custom view) still **accessible** for hosts (not gated by collection access)
- ✅ **Minimal change**: Only add `access.admin` to 6 collections

**Verification Needed**:
- Test that custom views (`/admin/upload-episode`, `/admin/planner`) aren't blocked by `access.admin`
- Test that hosts still can't directly navigate to `/admin/collections/episodes`

---

## ADDITIONAL RECOMMENDATIONS

### 1. Create Reusable Helpers (`/src/access/roleHelpers.ts`)
```typescript
export const adminPanelOnly: Access = ({ req }) => {
  const user = req.user as any
  if (!user) return false
  return ['admin', 'staff'].includes(user.role)
}
```
**Benefit**: Reduces duplication, easier to audit

### 2. Validate Host Users Have Linked Profile
Add validation hook to Users collection:
```typescript
if (data?.role === 'host' && !data?.host) {
  throw new Error('Host users must have a linked host profile')
}
```
**Benefit**: Prevents silent failures in access functions that assume `user.host` exists

### 3. Document Field-Level Access Patterns
- `access.read`: Blocks queries AND UI visibility
- `access.update`: Blocks updates, allows queries
- `admin.hidden`: Hides UI field only (visual, not security)

**Rule**: Use `admin.hidden` + `access.update` to hide fields while allowing queries

---

## OPEN QUESTIONS

1. **Custom Views**: Do they respect collection-level `access.admin`? (Test needed)
2. **Payload Version**: V2 or V3? (Function-based `admin.hidden` may not work in V3)
3. **Published-Only Read**: Should frontend API only show published episodes? (Currently shows all)
4. **Host Count**: How many host users exist? (Migration impact assessment)
5. **Orphaned Hosts**: Any users with `role: 'host'` but no `host` field? (Database query needed)

---

## IMPLEMENTATION PRIORITY

### 🔴 Critical (Security)
- [ ] Add `access.admin` to Episodes, Shows, Hosts collections
- [ ] Test custom views still work for hosts
- [ ] Test hosts are blocked from direct admin panel access

### 🟡 Important (Data Integrity)
- [ ] Add `user.host` validation hook
- [ ] Query for orphaned host users
- [ ] Document field-level access patterns

### 🟢 Nice to Have (Code Quality)
- [ ] Create `/src/access/roleHelpers.ts`
- [ ] Refactor to use `adminPanelOnly` helper
- [ ] Add published-only read access (if needed)

---

## RISK ASSESSMENT

### High Risk ⚠️
- **Current State**: Hosts can access admin panel routes directly (not just hidden, but accessible)
- **Impact**: Hosts could view/edit data they shouldn't have access to via direct URL navigation
- **Likelihood**: Low (requires knowledge of admin routes), but exploitable

### Medium Risk ⚠️
- **Field-Level Hiding**: Some sensitive fields use `admin.hidden` only (visual hiding, not access control)
- **Impact**: API responses may include hidden fields if not using `access.read`
- **Mitigation**: Use field-level `access.read: hideFromHosts` for truly sensitive data

### Low Risk ✅
- **Write Operations**: Properly restricted via `access.create/update/delete`
- **Frontend API**: Public access is intentional and working as expected
- **JWT Config**: Role field properly saved to JWT

---

## SUCCESS CRITERIA

After implementing `access.admin`:
1. ✅ Host users **cannot** access `/admin/collections/episodes` (redirect or 403)
2. ✅ Host users **CAN** access `/admin/upload-episode` (custom view)
3. ✅ Admin/staff users **CAN** access all admin panel routes
4. ✅ Unauthenticated users **CAN** query `/api/episodes` (public API)
5. ✅ Authenticated hosts **CAN** query `/api/episodes` (frontend catalog browsing)
6. ✅ Frontend app catalog browsing works for all user types
7. ✅ Login flow still works (unauthenticated users can read user records)

---

**Next Steps**: Review full Reviewer Pack (`ROLES_PERMISSIONS_AUDIT_REVIEWER_PACK.md`) for detailed findings, code examples, and implementation guide.













