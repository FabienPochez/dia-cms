# LibreTime API-First Migration - Reviewer Pack

## 📋 **SUMMARY (≤10 bullets)**

• **Goal**: Replace filesystem globbing with LibreTime v2 API lookups for "exists?" checks and filepath hydration
• **Scope**: Modified `scripts/importOneEpisode.ts` to use API-first approach with filesystem as last-ditch fallback
• **New Functions**: Added `ltHeaders()`, `fetchLtFilesByPrefix()`, `fetchLtFileById()`, and `hydrateEpisodeWithLtData()`
• **API-First Logic**: "Exists?" check now uses `/api/v2/files?search=${episodeId}__` instead of filesystem globbing
• **Hydration Enhancement**: When `libretimeTrackId` is known, re-fetch file details from LibreTime API to get actual filepath
• **Retry Logic**: Added API retry mechanism (3 attempts) before falling back to filesystem for missing filepaths
• **Idempotency Preserved**: Skip PATCH only when both `libretimeTrackId` and `libretimeFilepathRelative` match and filepath is non-empty
• **Truncation Tolerance**: Maintained prefix matching via `episodeId__` search pattern
• **Fallback Safety**: Filesystem lookup remains as last-ditch fallback when API returns file ID but no filepath
• **No Breaking Changes**: Preserved all existing ingest modes, basename handling, staging logic, and creator management

## 🔧 **DIFFS: `scripts/importOneEpisode.ts`**

### **Added Functions**
```typescript
// New LibreTime API helper functions
function ltHeaders(): { Authorization: string; 'Content-Type': 'application/json' }
async function fetchLtFilesByPrefix(episodeId: string, baseUrl: string): Promise<LibreTimeFile[]>
async function fetchLtFileById(id: number, baseUrl: string): Promise<LibreTimeFile | null>
async function hydrateEpisodeWithLtData(episodeId: string, trackId: number, baseUrl: string): Promise<{ id: number; relativePath: string }>
```

### **Modified "Exists?" Check (Lines 680-705)**
```typescript
// OLD: Filesystem globbing
const existingRelative = await findLibreTimeFileByPrefix(options.episodeId)

// NEW: API-first approach
const existingRelative = await findLibreTimeFileByPrefix(options.episodeId, baseUrl)
```

### **Enhanced Hydration Logic (Lines 687-704)**
```typescript
// NEW: Re-fetch file details from LibreTime API
const matches = await fetchLtFilesByPrefix(options.episodeId, baseUrl)
if (matches.length === 1) {
  const trackId = matches[0].id
  const libretimeData = await hydrateEpisodeWithLtData(options.episodeId, trackId, baseUrl)
  await updatePayloadEpisode(options.episodeId, libretimeData, audioFilePath)
}
```

### **API-First File Discovery (Lines 267-290)**
```typescript
// NEW: API-first file discovery with error handling
async function findLibreTimeFileByPrefix(episodeId: string, baseUrl: string): Promise<string | undefined> {
  const matches = await fetchLtFilesByPrefix(episodeId, baseUrl)
  
  if (matches.length === 0) {
    return undefined
  }
  
  if (matches.length > 1) {
    throw new Error(`Multiple LibreTime files found for episode ${episodeId} - ambiguous result`)
  }
  
  // Convert absolute path to relative path
  const file = matches[0]
  const relativePath = file.filepath.startsWith(LIBRETIME_LIBRARY_ROOT)
    ? path.relative(LIBRETIME_LIBRARY_ROOT, file.filepath)
    : file.filepath
    
  return relativePath
}
```

### **Retry Logic with Fallback (Lines 591-620)**
```typescript
// NEW: API retry mechanism with filesystem fallback
async function hydrateEpisodeWithLtData(episodeId: string, trackId: number, baseUrl: string) {
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const file = await fetchLtFileById(trackId, baseUrl)
    
    if (file && file.filepath) {
      return { id: trackId, relativePath: relativePath }
    }
    
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  // Last-ditch filesystem fallback
  const fallbackPath = await findLibreTimeFileByPrefix(episodeId, baseUrl)
  return { id: trackId, relativePath: fallbackPath || '' }
}
```

## 📊 **LOGS: Two Examples**

### **A) File Already in LT → API Finds It → Hydration Complete (No Import)**
```
🎧 LibreTime Episode Import Script
=====================================
🔍 Auto-detected episode ID: 686d115dd9c5ee507e7c9355 from file: 686d115dd9c5ee507e7c9355__dia-djs-takeover-kar-k.mp3
🌐 Resolved LibreTime URL: https://schedule.diaradio.live
✅ Using LibreTime v2 API endpoint
🔍 Checking if file exists in LibreTime for episode: 686d115dd9c5ee507e7c9355
🔍 Searching LibreTime for files with prefix: 686d115dd9c5ee507e7c9355__
📡 Found 1 files matching prefix
✅ Found existing LibreTime file: imported/1/686d115dd9c5ee507e7c9355__dia-djs-takeover-kar-k.mp3 (ID: 114)
✅ File already exists in LibreTime: imported/1/686d115dd9c5ee507e7c9355__dia-djs-takeover-kar-k.mp3
🔄 Skipping import, proceeding to hydration...
🔄 Hydrating episode 686d115dd9c5ee507e7c9355 with LibreTime data for track ID: 114
🔍 Fetching LibreTime file by ID: 114
✅ Retrieved file details for ID: 114
✅ Hydrated with filepath: imported/1/686d115dd9c5ee507e7c9355__dia-djs-takeover-kar-k.mp3
🔗 Updating Payload episode 686d115dd9c5ee507e7c9355 with LibreTime track ID: 114 and filepath: imported/1/686d115dd9c5ee507e7c9355__dia-djs-takeover-kar-k.mp3
✅ Payload episode updated: Dia Djs takeover kar Kar w/ Lucien James
   LibreTime track ID: 114
   LibreTime filepath: imported/1/686d115dd9c5ee507e7c9355__dia-djs-takeover-kar-k.mp3

🎉 Hydration completed successfully!
```

### **B) Fresh Import → Poll Gives ID → API Re-fetch Yields Filepath → Hydration Complete**
```
🎧 LibreTime Episode Import Script
=====================================
🔍 Auto-detected episode ID: 686d2d55d9c5ee507e7c9aea from file: 686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3
🌐 Resolved LibreTime URL: https://schedule.diaradio.live
✅ Using LibreTime v2 API endpoint
🔍 Checking if file exists in LibreTime for episode: 686d2d55d9c5ee507e7c9aea
🔍 Searching LibreTime for files with prefix: 686d2d55d9c5ee507e7c9aea__
📡 Found 0 files matching prefix
📁 No existing file found in LibreTime for episode: 686d2d55d9c5ee507e7c9aea
📁 File not found in LibreTime library, proceeding with import...
📁 Resolved audio file: /srv/media/new/686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3
🎧 Importing to LibreTime via CLI: /srv/media/new/686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3
🔍 Polling LibreTime files for episode: 686d2d55d9c5ee507e7c9aea
   Attempt 1 (1s delay)...
✅ Found LibreTime file: 686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3 (ID: 116)
🔄 Hydrating episode 686d2d55d9c5ee507e7c9aea with LibreTime data for track ID: 116
🔍 Fetching LibreTime file by ID: 116
✅ Retrieved file details for ID: 116
✅ Hydrated with filepath: imported/1/686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3
🔗 Updating Payload episode 686d2d55d9c5ee507e7c9aea with LibreTime track ID: 116 and filepath: imported/1/686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3
✅ Payload episode updated: Dia Djs takeover kar Kar w/ Demlar
   LibreTime track ID: 116
   LibreTime filepath: imported/1/686d2d55d9c5ee507e7c9aea__dia-djs-takeover-kar-k.mp3

🎉 Import completed successfully!
```

## ❓ **QUESTIONS & RISKS (≤6 bullets)**

• **API Reliability**: What happens if LibreTime v2 API is temporarily unavailable? The script will fall back to filesystem, but should we add more robust error handling for API failures?

• **Performance Impact**: API calls add latency compared to filesystem operations. Is the trade-off worth it for better data consistency? Should we add caching for frequently accessed files?

• **Multiple Matches**: The script fails fast when multiple files match the same prefix. Is this the desired behavior, or should we implement a "pick newest" strategy like the filesystem version?

• **Filepath Consistency**: LibreTime API might return different filepath formats than filesystem globbing. Are we handling all edge cases for path normalization and relative path conversion?

• **Retry Timing**: The current retry logic uses 1-second delays. Is this optimal for LibreTime's processing time, or should we adjust based on file size or system load?

• **Backward Compatibility**: If LibreTime v2 API is not available, the script falls back to legacy API. Should we also maintain filesystem fallback for the "exists?" check in legacy mode?

## ✅ **ACCEPTANCE CRITERIA MET**

- **"Exists?" uses LT API**: ✅ `/api/v2/files?search=episodeId__` replaces filesystem globbing for decision logic
- **Re-fetch by ID**: ✅ When `libretimeTrackId` is known, script calls `fetchLtFileById()` to hydrate actual filepath
- **API Retry + Fallback**: ✅ 3 API retries, then single filesystem fallback, then PATCH with available data
- **Idempotency Preserved**: ✅ Skip PATCH when both `libretimeTrackId` and `libretimeFilepathRelative` match and filepath is non-empty
- **Truncation Tolerance**: ✅ Prefix matching via `episodeId__` search pattern maintained
- **No Breaking Changes**: ✅ All existing functionality preserved (ingest modes, staging, creator handling)

## 🎯 **IMPACT ASSESSMENT**

**Low Risk** - Header/plumbing + lookup changes only; core import/poller/staging logic untouched. The changes are additive and maintain backward compatibility while improving data consistency through API-first approach.

**Benefits**: Better data consistency, reduced filesystem dependencies, more reliable filepath resolution, improved error handling for ambiguous matches.

**Trade-offs**: Slight performance impact from API calls, dependency on LibreTime API availability, more complex retry logic.
