# LibreTime Webstream / Live Input Instance Audit

**Date**: 2026-01-13  
**Status**: 🔍 Information Gathering - No Code Changes  
**Purpose**: Audit current state and gather information about creating webstream/live input instances in LibreTime for live episodes

---

## Executive Summary

This audit gathers information about:
1. Current LibreTime integration state
2. How to create webstream/live input instances in LibreTime
3. What API endpoints and data structures are available for live episodes
4. Current planner and sync function capabilities
5. Gaps between current implementation and live episode requirements

**Key Finding**: The current implementation only supports **file-based scheduling** (pre-recorded tracks). **Webstream/live input scheduling is not yet implemented** but the API structure supports it.

---

## Current Implementation Status

### ✅ What Currently Works

#### 1. File-Based Scheduling (Pre-Recorded Episodes)
- **Endpoint**: `POST /api/schedule/planOne`
- **Flow**: Episode → Show → Instance → Playout (with file/track)
- **Data Structure**: `LTSchedule` with `file: number | null`
- **Location**: `src/app/api/schedule/planOne/route.ts`, `src/lib/services/scheduleOperations.ts`

#### 2. Planner Integration
- **Status**: ✅ Complete (Step 4D)
- **Features**:
  - Create/ensure LibreTime shows
  - Create/ensure show instances for time windows
  - Create playouts with episode tracks
  - Collision detection
  - Rollback mechanisms
- **Documentation**: `docs/PLANNER_INTEGRATION_STATUS.md`, `docs/STEP_4D_INTEGRATION_GUIDE.md`

#### 3. Sync Function
- **Endpoint**: `POST /api/schedule/apply-range`
- **Function**: `buildEnvelopeSyncPlan()` in `src/lib/schedule/envelopeSync.ts`
- **Purpose**: Syncs Payload episodes with LibreTime schedule
- **Status**: ✅ Functional for file-based episodes

### ❌ What's Missing

#### 1. Webstream/Live Input Scheduling
- **Current**: Only `file` field is used in schedule creation
- **Available**: `LTSchedule` interface has `stream: number | null` field
- **Gap**: No implementation for creating schedules with `stream` instead of `file`

#### 2. Live Episode Detection
- **Data Available**: Episodes have `airState: 'live' | 'preRecorded'` field
- **Shows Have**: `airState: 'live' | 'preRecorded'` field
- **Gap**: Planner doesn't differentiate between live and pre-recorded when scheduling

---

## LibreTime API Structure

### Schedule Interface

From `src/integrations/libretimeClient.ts`:

```typescript
export interface LTSchedule {
  id: number
  starts_at: string
  ends_at: string
  instance: number
  file: number | null      // ← Currently used for tracks
  stream: number | null    // ← Available for webstreams (NOT YET USED)
  created_at: string
  updated_at: string
}
```

**Key Observation**: The schedule can have **either** a `file` (track) **or** a `stream` (webstream), but not both.

### Current Schedule Creation

From `src/integrations/libretimeClient.ts` (lines 847-894):

```typescript
async ensurePlayout(
  instanceId: number,
  trackId: number,        // ← Always requires a track/file
  startsAt: string,
  endsAt: string,
): Promise<LTSchedule | null> {
  // ... creates schedule with file field only
  const playoutData = {
    instance: instanceId,
    file: trackId,        // ← Only file-based
    starts_at: normalizedStart,
    ends_at: normalizedEnd,
    // ... no stream field
  }
}
```

---

## LibreTime API Endpoints

### Currently Used Endpoints

1. **Shows**: `GET/POST /api/v2/shows`
2. **Show Instances**: `GET/POST /api/v2/show-instances`
3. **Schedule**: `GET/POST /api/v2/schedule`
4. **Files**: `GET /api/v2/files`

### Potential Webstream Endpoints (To Investigate)

Based on LibreTime documentation and API patterns, these endpoints likely exist:
- `GET /api/v2/webstreams` - List available webstreams
- `GET /api/v2/webstreams/{id}` - Get specific webstream
- `POST /api/v2/webstreams` - Create webstream (if needed)

**Note**: These endpoints need to be verified by querying the LibreTime API directly.

---

## Episode Data Model

### Episode Fields Related to Live Episodes

From `src/collections/Episodes.ts` and `src/payload-types.ts`:

```typescript
interface Episode {
  airState?: 'live' | 'preRecorded'  // ← Indicates if episode is live
  isLive?: boolean                    // ← Additional live flag
  type?: ('Live' | ...)[]             // ← Episode type can include 'Live'
  scheduledAt?: string | null
  scheduledEnd?: string | null
  libretimePlayoutId?: number | null
  libretimeInstanceId?: number | null
  // ... no libretimeStreamId field yet
}
```

### Show Fields Related to Live Episodes

From `src/payload-types.ts`:

```typescript
interface Show {
  airState: 'live' | 'preRecorded'   // ← Show-level air state
  live_enabled: boolean               // ← LibreTime show field
  libretimeShowId?: number | null
  libretimeInstanceId: 'main'
}
```

**Note**: Shows have `live_enabled` field in LibreTime, which is set when creating shows (see `libretimeClient.ts` line 686).

---

## Current Planner Flow

### For Pre-Recorded Episodes (Current)

1. User schedules episode in Planner
2. System checks `episode.libretimeTrackId` (must exist)
3. System creates/ensures LibreTime show
4. System creates/ensures show instance for time window
5. System creates playout with `file: trackId`
6. System updates episode with `libretimePlayoutId` and `libretimeInstanceId`

### For Live Episodes (Not Yet Implemented)

**Required Flow**:
1. User schedules episode in Planner
2. System detects `episode.airState === 'live'` or `episode.isLive === true`
3. System creates/ensures LibreTime show (with `live_enabled: true`)
4. System creates/ensures show instance for time window
5. System creates playout with `stream: webstreamId` (instead of `file: trackId`)
6. System updates episode with `libretimePlayoutId` and `libretimeInstanceId`

**Gap**: Steps 2, 5, and 6 need implementation.

---

## Sync Function Analysis

### Current Sync Function

**Location**: `src/lib/schedule/envelopeSync.ts`

**Function**: `buildEnvelopeSyncPlan()`

**Current Behavior**:
- Fetches episodes with `scheduledAt` and `scheduledEnd`
- Fetches LibreTime schedules and instances
- Matches episodes to schedules by `file` field
- Creates/updates/deletes schedules based on episode state

**Gap**: Only handles `file`-based schedules. Would need to also handle `stream`-based schedules for live episodes.

---

## LibreTime Configuration

### Current Input Configuration

From `docs/LIBRETIME_PUBLIC_URL_UPDATE.md`:

LibreTime has two source inputs configured:
- **Main Source**: `https://schedule.diaradio.live:8001` (input_main)
- **Show Source**: `https://schedule.diaradio.live:8002` (input_show)

These are physical input sources, not webstream instances.

### Webstream vs Live Input

**Important Distinction**:
- **Webstream**: A scheduled stream source (e.g., external URL stream)
- **Live Input**: Physical input source (e.g., `/8001/`, `/8002/`)

For live episodes, we likely need to create a **webstream instance** that points to one of these live input sources.

---

## Questions to Answer

### 1. API Endpoints
- [ ] Does `/api/v2/webstreams` endpoint exist?
- [ ] What is the structure of a webstream object?
- [ ] How do we create a webstream instance?
- [ ] How do we link a webstream to a schedule entry?

### 2. Data Structure
- [ ] What fields are required to create a webstream schedule entry?
- [ ] Can a schedule have both `file` and `stream`? (Likely no, based on interface)
- [ ] How do we identify which webstream to use for a live episode?

### 3. Integration Points
- [ ] How should the planner detect live episodes?
- [ ] Should we add `libretimeStreamId` field to episodes?
- [ ] How should sync function handle live episodes?
- [ ] What happens when an episode changes from live to pre-recorded?

### 4. Configuration
- [ ] Do we need to pre-configure webstreams in LibreTime?
- [ ] How do webstreams relate to the physical input sources (`/8001/`, `/8002/`)?
- [ ] Can we create webstreams on-the-fly or must they exist first?

---

## Next Steps (Information Gathering)

### 1. Query LibreTime API

Test these endpoints to understand webstream structure:

```bash
# Check if webstreams endpoint exists
GET /api/v2/webstreams

# Check schedule entries that have stream field
GET /api/v2/schedule?limit=100
# Look for entries where stream is not null

# Check show instances for live shows
GET /api/v2/show-instances?show={live_show_id}
```

### 2. Review LibreTime Documentation

- Check LibreTime v2 API documentation for webstream endpoints
- Review LibreTime user manual for webstream configuration
- Check LibreTime source code for webstream data models

### 3. Test Current Schedule Structure

Query existing schedules to see if any have `stream` field populated:

```typescript
// In libretimeClient.ts, add method to check for stream-based schedules
async getSchedulesWithStreams(): Promise<LTSchedule[]> {
  const schedules = await this.getSchedule({ limit: 1000 })
  return schedules.filter(s => s.stream !== null)
}
```

### 4. Identify Live Episode Patterns

- Check if any existing episodes have `airState: 'live'`
- Check if any shows have `airState: 'live'`
- Understand how live episodes are currently handled (if at all)

---

## Code References

### Key Files

1. **LibreTime Client**: `src/integrations/libretimeClient.ts`
   - `LTSchedule` interface (line 70-79)
   - `ensurePlayout()` method (line 847-894)
   - `ensureInstance()` method (line 713-841)
   - `ensureShow()` method (line 655-706)

2. **Schedule Operations**: `src/lib/services/scheduleOperations.ts`
   - `planOne()` function (line 54-265)
   - Handles file-based scheduling only

3. **Planner Route**: `src/app/api/schedule/planOne/route.ts`
   - Main endpoint for scheduling episodes
   - Validates `libretimeTrackId` (line 106-120)
   - Creates playout with file (line 269-274)

4. **Sync Function**: `src/lib/schedule/envelopeSync.ts`
   - `buildEnvelopeSyncPlan()` function (line 200-453)
   - Matches episodes to schedules by file

5. **Episode Schema**: `src/collections/Episodes.ts`
   - `airState` field (line 257-268)
   - `isLive` field (line 364)
   - `type` field includes 'Live' option (line 244)

6. **Show Schema**: `src/collections/Shows.ts`
   - `airState` field
   - `live_enabled` in LibreTime show creation

---

## Documentation References

- **Planner Integration**: `docs/PLANNER_INTEGRATION_STATUS.md`
- **Step 4D Guide**: `docs/STEP_4D_INTEGRATION_GUIDE.md`
- **LibreTime API**: `docs/LIBRETIME_V2_API_REVIEWER_PACK.md`
- **LibreTime Troubleshooting**: `docs/LIBRETIME_API_TROUBLESHOOTING.md`
- **Integration README**: `src/integrations/README.md`

---

## Summary

### Current State
- ✅ File-based scheduling fully implemented
- ✅ Planner integration complete for pre-recorded episodes
- ✅ Sync function working for file-based schedules
- ❌ Webstream/live input scheduling not implemented
- ❌ No differentiation between live and pre-recorded in planner

### Available Infrastructure
- ✅ `LTSchedule.stream` field exists in interface
- ✅ Episodes have `airState` and `isLive` fields
- ✅ Shows have `live_enabled` field in LibreTime
- ✅ API structure supports stream-based schedules

### Required Investigation
1. Query LibreTime API for webstream endpoints
2. Understand webstream data structure
3. Identify how to create webstream schedule entries
4. Determine relationship between webstreams and live input sources
5. Plan integration points in planner and sync functions

---

**Status**: Information gathering complete. Ready for API investigation and implementation planning.
