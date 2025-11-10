# Pre-assigned Episode ID Upload Flow - Implementation Summary

**Date:** November 3, 2025  
**Implemented by:** AI Assistant

## Overview

Implemented a secure pre-assigned episode ID upload flow that creates a minimal draft episode before file uploads, enabling proper filename generation with episode metadata.

## Files Created

### 1. API Route: `/src/app/api/episodes/new-draft/route.ts`
- **Purpose:** Pre-creates minimal draft episodes
- **Auth:** host/staff/admin only
- **Features:**
  - Creates episode with `publishedStatus: 'draft'`
  - Sets `createdBy` for auditable ownership
  - Auto-assigns current user's host to episode
  - Returns episode ID for redirect

### 2. Launcher Component: `/src/admin/components/NewEpisodeLauncher.tsx`
- **Purpose:** Entry point for new episode uploads
- **Features:**
  - "Start Upload" button
  - Calls `/api/episodes/new-draft`
  - Redirects to upload form with `?episodeId=...`
  - Error handling UI

### 3. Filename Utility: `/src/utils/filenameFromEpisode.ts`
- **Purpose:** Generate canonical filenames with episode metadata
- **Pattern:** `{episodeId}__{showSlug}__{titleSlug}__{episodeNumber}.{ext}`
- **Features:**
  - ASCII normalization and diacritics removal
  - Extension derived from MIME type (security)
  - 120-character length cap
  - Slugification rules matching existing scripts
  - Cover filename: `{episodeId}__cover.{ext}`

## Files Modified

### 4. Upload Form: `/src/admin/components/EpisodeUploadView.tsx`
**Changes:**
- Added `useSearchParams()` to read `episodeId` from URL
- Shows `NewEpisodeLauncher` if no `episodeId` present
- Appends `episodeId` to FormData during audio/cover uploads
- Uses `PATCH /api/episodes/{episodeId}` instead of `POST` when updating existing draft
- Backward compatible: still works without episodeId

### 5. Media Tracks Collection: `/src/collections/MediaTracks.ts`
**Changes:**
- Added custom `upload.filename` function
- **Security:** Verifies ownership before allowing upload
  - Checks if user is `createdBy`, in `hosts[]`, or staff/admin
  - Rejects unauthorized uploads
- Reads `episodeId` from FormData (preferred) or query params
- Generates canonical filename using `buildEpisodeFilename()`
- Expands `mimeTypes` to support more audio formats
- Fallback to default behavior if no episodeId

### 6. Media Images Collection: `/src/collections/MediaImages.ts`
**Changes:**
- Added custom `upload.filename` function
- Same security checks as MediaTracks
- Generates cover filename: `{episodeId}__cover.{ext}`
- Reads `episodeId` from FormData or query params
- Fallback to default behavior if no episodeId

### 7. Episodes Collection: `/src/collections/Episodes.ts`
**Changes:**
- Updated `access.read` to allow hosts to read drafts they created
- Updated `access.update` to allow hosts to update drafts they created
- Uses `or` condition: hosts can access episodes where they're in `hosts[]` OR `createdBy` matches
- Staff/admin maintain full access

### 8. Custom Nav Links: `/src/admin/components/CustomNavLinks.tsx`
**Changes:**
- Gated "Upload Episode" link by role
- Only visible to host/staff/admin users
- Prevents regular users from seeing upload option

## Backups Created

All modified files were backed up with timestamp `20251103-092338`:
- `src/admin/components/backups/EpisodeUploadView.tsx.backup-20251103-092338`
- `src/collections/backups/MediaTracks.ts.backup-20251103-092338`
- `src/collections/backups/MediaImages.ts.backup-20251103-092338`
- `src/collections/backups/Episodes.ts.backup-20251103-092338`
- `src/payload.config.ts.backup-20251103-092338`

## Dependencies Added

```json
{
  "mime-types": "^2.1.35",
  "@types/mime-types": "^2.1.4"
}
```

## Security Features Implemented

### 1. Ownership Verification (Mandatory)
- Upload hooks verify episode ownership before accepting files
- Checks: `createdBy` matches OR user in `hosts[]` OR user is staff/admin
- Prevents cross-episode filename spoofing

### 2. Multipart Field Preferred Over Query
- Reads `episodeId` from FormData first (most secure)
- Falls back to query params (less secure, but supported)
- Query params can be manipulated in browser

### 3. Filename Hygiene
- Extension derived from MIME type (not original filename)
- ASCII normalization, diacritics stripped
- Length capped at 120 characters
- Deterministic output (no Payload `-1`, `-2` suffixing)

### 4. Draft Access Control
- Hosts can only read/update their own drafts
- Drafts isolated by `createdBy` field
- Staff/admin have full access
- Public API still works for frontend

### 5. Role-Based UI Gating
- Upload button only visible to host/staff/admin
- Regular users cannot access upload interface

## Filename Nomenclature

### Audio Files
**Pattern:** `{episodeId}__{showSlug}__{titleSlug}__{episodeNumber}.{extension}`

**Example:** `67890abc123def456789abcd__diaspora-island-vibes__special-reggae-mix__42.mp3`

**Components:**
- `episodeId`: 24-char MongoDB ObjectID (hex, lowercase)
- `showSlug`: Slugified show title (ASCII, lowercase, dashes)
- `titleSlug`: Slugified episode title
- `episodeNumber`: Integer episode number
- `extension`: From MIME type (`.mp3`, `.wav`, `.aiff`, `.m4a`)

**Slugification Rules:**
1. Normalize NFD (decompose accents)
2. Remove diacritics (`\u0300-\u036f`)
3. Lowercase
4. Replace non-alphanumeric with dash
5. Trim leading/trailing dashes
6. Fallback to 'untitled' if empty

**Validation Regex:**
```regex
/^([a-f0-9]{24})__([^_]+)__([^_]+)__(\d+)\.(mp3|wav|aiff|m4a)$/i
```

### Cover Images
**Pattern:** `{episodeId}__cover.{extension}`

**Example:** `67890abc123def456789abcd__cover.jpg`

## Upload Flow

### New Flow (with pre-assigned ID):
1. User clicks "Upload Episode" in navigation
2. System creates minimal draft episode via `/api/episodes/new-draft`
3. User redirected to `/admin/upload-episode?episodeId={id}`
4. User fills form and uploads audio/cover
5. Audio upload includes `episodeId` in FormData
6. Server generates canonical filename with episode metadata
7. Server verifies user owns the episode (security check)
8. Form submits with `PATCH /api/episodes/{episodeId}` to update draft
9. Success! Episode has proper filename from the start

### Legacy Flow (backward compatible):
1. User navigates directly to `/admin/upload-episode` (no episodeId)
2. System shows `NewEpisodeLauncher` component
3. User must click "Start Upload" to create draft first
4. Flow continues as new flow above

### Old Flow (still supported in non-upload contexts):
- Direct POST to `/api/episodes` still works
- Files uploaded without episodeId get timestamp-based names
- Backward compatible with existing scripts/tools

## Edge Cases Handled

### 1. Abandoned Drafts
- **Current:** Left in database (no cleanup)
- **Future:** Weekly cleanup job for drafts with no media older than N days

### 2. Upload Without episodeId
- Falls back to default behavior (timestamp-based filenames)
- Doesn't break existing upload workflows
- Logged as warning for debugging

### 3. Episode Not Found
- Returns default filename (timestamp-based)
- Upload proceeds without blocking
- Logged as warning

### 4. Ownership Verification Failure
- Upload rejected with 403 error
- Clear error message to user
- Prevents security breach

### 5. Filename Generation Error
- Falls back to default behavior
- Upload proceeds without blocking
- Error logged for investigation

## Testing Checklist

- [x] API route creates draft episodes with proper auth
- [x] Launcher button visible only to host/staff/admin
- [x] Launcher creates draft and redirects correctly
- [ ] Upload form reads episodeId from URL
- [ ] Upload form shows launcher when no episodeId
- [ ] Audio upload includes episodeId in FormData
- [ ] Server generates canonical filenames
- [ ] Ownership verification blocks unauthorized uploads
- [ ] Form uses PATCH for existing episodes
- [ ] Success page displays correctly
- [ ] Backward compatibility: old flow still works
- [ ] Drafts are isolated by ownership

## Future Enhancements

1. **Cleanup Job:** Weekly cron to delete abandoned drafts (no media, older than 7 days)
2. **Show Selection:** Allow pre-selecting show in launcher
3. **Draft Recovery:** UI to resume abandoned drafts
4. **Bulk Upload:** Support multiple episodes in one session
5. **Progress Persistence:** Save form state to draft periodically

## Notes

- All code follows existing patterns in the codebase
- No breaking changes to existing functionality
- Security-first approach with defense in depth
- Filenames match existing naming convention from `scripts/rename-media-in-place.ts`
- Ready for production deployment (pending testing)

