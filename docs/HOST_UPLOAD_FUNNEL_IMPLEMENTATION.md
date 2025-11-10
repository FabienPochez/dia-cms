# HOST UPLOAD FUNNEL — Implementation Summary

**Date**: 2025-10-27  
**Status**: ✅ **IMPLEMENTED** (Ready for Testing)  
**Objective**: Create streamlined upload workflow for host users

---

## 🎯 THE FUNNEL FLOW

### Before (Broken)
```
1. Visit content.diaradio.live → Generic homepage
2. Click "Go to admin panel" → /admin → See empty dashboard (no collections)
3. Manually navigate to /admin/upload-episode → Upload form
4. Upload success → Redirect to /admin/collections/episodes/:id → ❌ 403 (hosts blocked)
```

### After (Streamlined)
```
1. Visit content.diaradio.live
   ├─ If host user logged in → Auto-redirect to /admin/upload-episode
   └─ If not logged in → See homepage, click "Upload Episode" → Login → Return to upload

2. Visit /admin/upload-episode
   ├─ If not logged in → Redirect to login → Return to upload
   └─ If logged in as host → Show upload form

3. Fill form → Upload → Success
   
4. Visit /admin/upload-success
   ├─ See congrats message with episode title
   ├─ "Upload Another Episode" button → Back to upload form
   └─ "Log Out" button → Logout and redirect to login

5. Visit /admin (dashboard)
   ├─ If host → Auto-redirect to /admin/upload-episode
   └─ If admin/staff → See normal dashboard
```

---

## 📝 FILES CREATED

### 1. Upload Success Page

**File**: `/src/admin/components/UploadSuccessView.tsx` (NEW, 100 lines)

**Features**:
- ✅ Green checkmark emoji + "Upload Successful!" heading
- ✅ Shows episode title from URL param
- ✅ "Your episode has been submitted for review" message
- ✅ Two action buttons:
  - 📤 "Upload Another Episode" (blue, primary) → `/admin/upload-episode`
  - 🚪 "Log Out" (gray, secondary) → Logout + redirect to login
- ✅ Shows logged-in email at bottom
- ✅ Clean, centered layout with inline styles

**URL Pattern**: `/admin/upload-success?title=Episode+Title`

---

### 2. Host Dashboard Redirect

**File**: `/src/admin/components/HostDashboardRedirect.tsx` (NEW, 25 lines)

**Features**:
- ✅ Checks if `user.role === 'host'`
- ✅ Auto-redirects hosts to `/admin/upload-episode`
- ✅ Admin/staff see normal dashboard (no redirect)
- ✅ Mounted via `afterDashboard` component slot
- ✅ Client-side redirect using Next.js router

**Logic**:
```typescript
useEffect(() => {
  if (user?.role === 'host') {
    router.push('/admin/upload-episode')
  }
}, [user, router])
```

---

## 🔧 FILES MODIFIED

### 3. Upload Form Success Handler

**File**: `/src/admin/components/EpisodeUploadView.tsx`  
**Lines**: 278-280  
**Change**:

```diff
  setUploadProgress('Episode uploaded successfully!')

  // Redirect to success page after a short delay
  setTimeout(() => {
-   router.push(`/admin/collections/episodes/${episodeResult.doc.id}`)
+   const episodeTitle = title || episodeResult.doc.title || 'Your episode'
+   router.push(`/admin/upload-success?title=${encodeURIComponent(episodeTitle)}`)
  }, 2000)
```

**Impact**: Upload now redirects to success page instead of episode detail (which hosts can't access).

**Backup**: `EpisodeUploadView.tsx.backup-20251027-101855`

---

### 4. Frontend Homepage Auto-Redirect

**File**: `/src/app/(frontend)/page.tsx`  
**Lines**: 6, 17-20  
**Changes**:

```diff
+ import { redirect } from 'next/navigation'

  export default async function HomePage() {
    const headers = await getHeaders()
    const payloadConfig = await config
    const payload = await getPayload({ config: payloadConfig })
    const { user } = await payload.auth({ headers })

+   // Auto-redirect hosts to upload page
+   if (user?.role === 'host') {
+     redirect('/admin/upload-episode')
+   }

    return (
```

**Impact**: Hosts visiting `content.diaradio.live` are immediately redirected to upload form.

**Backup**: `page.tsx.backup-20251027-101908`

---

### 5. Payload Config Registration

**File**: `/src/payload.config.ts`  
**Lines**: 52-56, 59  
**Changes**:

```diff
  views: {
    planner: { ... },
    uploadEpisode: { ... },
+   uploadSuccess: {
+     Component: './admin/components/UploadSuccessView',
+     path: '/upload-success',
+     exact: true,
+   },
  },
  beforeNavLinks: ['./admin/components/CustomNavLinks'],
+ afterDashboard: ['./admin/components/HostDashboardRedirect'],
```

**Impact**: 
- Success view registered at `/admin/upload-success`
- Dashboard redirect component mounted after dashboard content

**Backup**: `payload.config.ts.backup-20251027-101855`

---

## 🧪 TESTING CHECKLIST

### Scenario 1: Host First Visit (Not Logged In)

**Steps**:
1. Visit `https://content.diaradio.live`
2. Click "Upload Episode" button
3. Redirected to `/admin/login?redirect=/admin/upload-episode`
4. Log in with host credentials
5. Returned to `/admin/upload-episode`

**Expected**: ✅ Lands on upload form after login

---

### Scenario 2: Host Already Logged In (Homepage)

**Steps**:
1. Log in as host
2. Visit `https://content.diaradio.live`

**Expected**: ✅ Immediately redirected to `/admin/upload-episode`

---

### Scenario 3: Host Already Logged In (Dashboard)

**Steps**:
1. Log in as host
2. Visit `/admin`

**Expected**: ✅ Immediately redirected to `/admin/upload-episode`

---

### Scenario 4: Upload Flow (Full Funnel)

**Steps**:
1. Host on `/admin/upload-episode`
2. Fill form: select show, title, audio file, metadata
3. Click "Upload Episode"
4. Wait for upload progress (shows percentage)
5. After success message (2 seconds)

**Expected**: 
- ✅ Redirected to `/admin/upload-success?title=Episode+Title`
- ✅ See congrats message with episode title
- ✅ See "Upload Another Episode" button
- ✅ See "Log Out" button

---

### Scenario 5: Upload Another

**Steps**:
1. On success page
2. Click "Upload Another Episode"

**Expected**: ✅ Redirected to `/admin/upload-episode` with clean form

---

### Scenario 6: Logout

**Steps**:
1. On success page
2. Click "Log Out"

**Expected**: 
- ✅ Session cleared
- ✅ Redirected to `/admin/login`

---

### Scenario 7: Admin/Staff (Not Affected)

**Steps**:
1. Log in as admin or staff
2. Visit `https://content.diaradio.live`

**Expected**: 
- ✅ See normal homepage (NOT redirected to upload)
- ✅ Can access all admin collections
- ✅ Can still use upload form if needed

**Steps** (dashboard):
1. Visit `/admin`

**Expected**: ✅ See normal dashboard (NOT redirected)

---

## 🔄 USER FLOWS

### Host User Journey

```
[First Visit]
content.diaradio.live 
  → Login page (with return URL)
  → /admin/upload-episode
  
[Subsequent Visits]
content.diaradio.live 
  → Auto-redirect to /admin/upload-episode
  
[After Upload]
/admin/upload-episode
  → Fill form
  → Upload
  → /admin/upload-success
  → Choose: Upload Another OR Logout
  
[If Visit Dashboard]
/admin
  → Auto-redirect to /admin/upload-episode
```

### Admin/Staff Journey (Unchanged)

```
content.diaradio.live 
  → Homepage (no redirect)
  
/admin
  → Dashboard (no redirect)
  → Full access to all collections
```

---

## 💾 BACKUPS CREATED

1. `EpisodeUploadView.tsx.backup-20251027-101855`
2. `payload.config.ts.backup-20251027-101855`
3. `page.tsx.backup-20251027-101908`

Plus earlier backups from access control fixes.

---

## 📊 IMPLEMENTATION SUMMARY

**New Files**: 2
- UploadSuccessView.tsx (100 lines)
- HostDashboardRedirect.tsx (25 lines)

**Modified Files**: 3
- EpisodeUploadView.tsx (1 line changed: redirect target)
- payload.config.ts (2 additions: success view + dashboard redirect)
- page.tsx (4 lines added: import + redirect logic)

**Total Code**: ~135 lines added

**Linter**: ✅ 0 errors

---

## 🚀 READY FOR TESTING

```bash
docker compose restart payload
```

**Test as host user**:
1. Visit `https://content.diaradio.live` → Should redirect to upload
2. Upload an episode → Should redirect to success page
3. Click "Upload Another" → Should return to upload form
4. Click "Log Out" → Should logout and redirect to login

**Test as admin/staff** (verify no disruption):
1. Visit `https://content.diaradio.live` → Should see normal homepage
2. Visit `/admin` → Should see normal dashboard
3. Can still access all collections

---

## 🔄 ROLLBACK (If Needed)

```bash
cd /srv/payload

# Restore modified files
cp src/admin/components/EpisodeUploadView.tsx.backup-20251027-101855 \
   src/admin/components/EpisodeUploadView.tsx

cp src/payload.config.ts.backup-20251027-101855 \
   src/payload.config.ts

cp src/app/\(frontend\)/page.tsx.backup-20251027-101908 \
   src/app/\(frontend\)/page.tsx

# Remove new files
rm src/admin/components/UploadSuccessView.tsx
rm src/admin/components/HostDashboardRedirect.tsx

# Restart
docker compose restart payload
```

---

## ✅ BENEFITS

1. **Hosts never see 403 errors** - Funnel keeps them in accessible areas
2. **Clear success feedback** - No confusion about what happened
3. **Quick return to upload** - One click to upload another episode
4. **Clean logout** - Explicit logout button on success screen
5. **Auto-redirect from root** - Hosts go straight to their task
6. **No impact on admin/staff** - They see normal interface

---

**END OF IMPLEMENTATION**




