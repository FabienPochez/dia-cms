# Payload API Key Access Fix — Reviewer Pack

**Date:** 2025-12-19  
**Objective:** Unblock Inbox Hydration Payload updates (403) by ensuring API key user has appropriate role  
**Approach:** Minimal change — ensure API key user has `staff` role (Option 2)

---

## 1. SUMMARY

1. **Root Cause**: Episodes collection `access.update` requires `req.user.role === 'admin' || 'staff'`, but the API key user doesn't have these roles.
2. **Current State**: API key authentication works (Payload populates `req.user`), but user lacks required role.
3. **Fields Needing Update**: `libretimeTrackId`, `libretimeFilepathRelative`, `airStatus` (hydration fields).
4. **Access Control Architecture**: Payload checks collection-level `access.update` first; field-level restrictions only apply if collection-level passes.
5. **Minimal Fix**: Ensure API key user has `staff` role (already supported by existing access control).
6. **Security Impact**: `staff` role can update all episode fields, but this matches existing behavior for staff users.
7. **Alternative Considered**: Field-level restrictions (Option 1) not feasible because collection-level access blocks first.
8. **Validation**: Re-run inbox hydration script; Payload update should succeed with `staff` role.

---

## 2. DIFFS

### No Code Changes Required

The existing access control already supports `staff` role:

```typescript
// src/collections/Episodes.ts (lines 42-57)
update: ({ req }) => {
  const user = req.user as any
  if (!user) return false
  // Admin/staff can update all episodes (includes API key users with staff role)
  if (user.role === 'admin' || user.role === 'staff') return true
  // Hosts can update episodes where they're linked
  if (user.role === 'host' && user.host) { ... }
  return false
}
```

**Action Required**: Update the API key user's role to `staff` in Payload admin panel or via database.

---

## 3. LOGS

### Current Behavior (403 Error)

```
🔗 Updating Payload episode 6908b190b111697fe64f2d1b with LibreTime track ID: 2072
⚠️  Using API key for authentication. Ensure the API key user has admin or staff role for update operations.
❌ Error hydrating existing episode 6908b190b111697fe64f2d1b: Failed to update Payload episode: Request failed with status code 403
```

### Expected Behavior (After Fix)

```
🔗 Updating Payload episode 6908b190b111697fe64f2d1b with LibreTime track ID: 2072
✅ Payload episode updated: 6908b190b111697fe64f2d1b
   LibreTime track ID: 2072
   LibreTime filepath: imported/1/6908b190b111697fe64f2d1b__gvslm-xx-w-lucien-jame.mp3
   airStatus: queued
```

---

## 4. QUESTIONS & RISKS

1. **Q: Why not use field-level restrictions (Option 1)?**  
   **A:** Payload's access control checks collection-level first. If `access.update` returns false, field-level restrictions aren't evaluated. To restrict fields, we'd need to check request body in collection-level access, which is more complex and error-prone.

2. **Q: Does `staff` role grant too much access?**  
   **A:** `staff` role can update all episode fields, matching existing behavior for staff users. This is acceptable for automation scripts that need to hydrate episodes. Field-level restrictions (`hideFromHosts`) still protect sensitive fields from hosts.

3. **Q: Can we create a new `automation` role?**  
   **A:** Possible but requires:
   - Adding role to Users collection enum
   - Updating all access control functions
   - More invasive change than Option 2
   - Not worth the complexity for a single use case

4. **Q: What if API key user already has a different role?**  
   **A:** Check current role via `/api/users/me` endpoint. If it's `user` or `host`, update to `staff`. If it's already `admin` or `staff`, no change needed.

5. **Q: Will this affect other API key users?**  
   **A:** Only if they also have `staff` role. If multiple API keys exist, each user's role is checked independently. This fix only affects the specific API key used by inbox hydration script.

6. **Q: Is there a way to restrict to only hydration fields?**  
   **A:** Not without modifying collection-level access to inspect request body, which would be a larger refactor. The current approach (staff role) is the minimal safe change.

---

## 5. VALIDATION STEPS

1. **Identify API Key User**:
   ```bash
   # Via Payload admin panel: Users → Find user with API key enabled
   # Or via API (if accessible):
   curl -H "Authorization: users API-Key <key>" \
     http://payload:3000/api/users/me
   ```

2. **Update User Role**:
   - Via Payload admin panel: Users → Edit user → Set role to `staff`
   - Or via database (if needed):
     ```sql
     UPDATE users SET role = 'staff' WHERE api_key_index = '<key_hash>';
     ```

3. **Re-run Inbox Hydration**:
   ```bash
   cd /srv/payload
   docker compose run --rm --no-deps jobs sh -lc 'npx tsx scripts/hydrate-inbox-lt.ts'
   ```

4. **Verify Payload Update**:
   - Check episode in Payload: `libretimeTrackId`, `libretimeFilepathRelative`, `airStatus` should be set
   - No 403 errors in logs

5. **Test Disallowed Fields** (Security Check):
   ```bash
   # Attempt to update a protected field (should still be blocked if field-level access restricts it)
   curl -X PATCH http://payload:3000/api/episodes/<id> \
     -H "Authorization: users API-Key <key>" \
     -H "Content-Type: application/json" \
     -d '{"title": "Hacked Title"}'
   # Should succeed (staff can update title), but sensitive fields like `categorizedBy` should still be protected
   ```

---

## 6. RECOMMENDATION

**Apply Option 2**: Update API key user role to `staff`. This is the minimal change that unblocks inbox hydration while maintaining existing security model.

**Next Steps**:
1. Identify which user the `PAYLOAD_API_KEY` belongs to
2. Update that user's role to `staff` in Payload admin panel
3. Re-run inbox hydration script
4. Verify Payload updates succeed

