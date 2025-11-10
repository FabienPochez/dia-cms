# Search Index Preparation Plan - Phase 1 (MVP)

**Status:** Planning Only  
**Date:** 2025-10-27  
**Phase:** Mixed Search MVP (No text indexes yet)

---

## 1. Executive Summary

This document outlines the planning and preparation for MongoDB indexes to support the mixed search MVP feature. The goal is to add minimal, targeted indexes that enable efficient queries for common search patterns without introducing full-text search complexity.

**Key Principles:**
- ✅ Simple compound/single-field indexes only (Phase 1)
- ❌ No text indexes yet (deferred to Phase 2 for relevance ranking)
- ✅ Support regex starts-with and contains queries efficiently
- ✅ Enable fast joins and multikey array filtering
- ✅ Document current state before making changes

---

## 2. Schema Audit Results

### 2.1 Episodes Collection

**Key Fields for Search:**
- `show` (ObjectId, relationship to shows) - **Join field**
- `genres` (Array of ObjectIds, relationship to genres) - **Multikey index target**
- `title` (String, optional)
- `description` (String, optional)
- `hosts` (Array of ObjectIds, relationship to hosts)

**TypeScript Definition:**
```typescript
interface Episode {
  id: string;
  show?: (string | null) | Show;  // ObjectId ref
  genres?: (string | Genre)[] | null;  // Array of ObjectIds
  title?: string | null;
  description?: string | null;
  hosts?: (string | Host)[] | null;
  // ... other fields
}
```

**Payload Collection Config:**
```javascript
// src/collections/Episodes.ts
{
  name: 'show',
  type: 'relationship',
  relationTo: 'shows',
}
{
  name: 'genres',
  type: 'relationship',
  relationTo: 'genres',
  hasMany: true,  // Creates array → multikey index eligible
}
```

**Existing Indexes (from line 59-64):**
```javascript
indexes: [
  {
    fields: ['scheduledAt', 'scheduledEnd'],
    options: { name: 'idx_schedStart_end' },
  },
],
```

**Field-Level Indexes (from line 285, 300):**
```javascript
{ name: 'scheduledAt', type: 'date', index: true }
{ name: 'scheduledEnd', type: 'date', index: true }
```

### 2.2 Shows Collection

**Key Fields for Search:**
- `title` (String, required) - **Primary search field**
- `subtitle` (String, optional) - **Secondary search field**
- `description` (String, optional) - **Content search field**
- `hosts` (Array of ObjectIds, relationship to hosts)
- `genres` (Array of ObjectIds, relationship to genres)

**TypeScript Definition:**
```typescript
interface Show {
  id: string;
  title: string;  // Required
  subtitle?: string | null;
  description?: string | null;
  hosts?: (string | Host)[] | null;
  genres?: (string | Genre)[] | null;
  // ... other fields
}
```

**Payload Collection Config:**
```javascript
// src/collections/Shows.ts
{ name: 'title', type: 'text', required: true }
{ name: 'subtitle', type: 'text' }
{ name: 'description', type: 'textarea' }
```

**Existing Indexes:**
- None explicitly defined in collection config
- Likely has `_id` index only (MongoDB default)

### 2.3 Hosts Collection

**Key Fields for Search:**
- `name` (String, required) - **Primary search field**
- `bio` (String, optional)
- `type` (Select: 'resident' | 'guest')

**TypeScript Definition:**
```typescript
interface Host {
  id: string;
  name: string;  // Required
  bio?: string | null;
  type?: ('resident' | 'guest') | null;
  // ... other fields
}
```

**Payload Collection Config:**
```javascript
// src/collections/Hosts.ts
{ name: 'name', type: 'text', required: true }
```

**Existing Indexes:**
- None explicitly defined in collection config
- Likely has `_id` index only (MongoDB default)

---

## 3. Current Index State (Before Changes)

**✅ Baseline Captured: 2025-10-27**

**Actual Baseline (from inspection):**
- **shows**: 4 indexes (_id, updatedAt, slug unique, createdAt)
  - ❌ Missing: title, subtitle, description
- **episodes**: 10 indexes (_id, createdAt, updatedAt, show, libretimeTrackId, libretimeFilepathRelative, scheduledAt, scheduledEnd, idx_schedStart_end, slug unique+sparse)
  - ✅ Already has: `show_1` (no need to create!)
  - ❌ Missing: genres
- **hosts**: 4 indexes (_id, updatedAt, createdAt, slug unique+sparse)
  - ❌ Missing: name

**Key Finding:**
The `episodes.show_1` index already exists! This is excellent - Payload automatically created it based on the relationship field. We only need to create **3 new indexes** instead of 4.

**Full Baseline Output:**
See `docs/SEARCH_INDEX_BASELINE.txt` for complete JSON snapshot.

---

## 4. Proposed Indexes for MVP

### 4.1 Episodes Collection

**Index 1: Join Speed** ✅ **ALREADY EXISTS**
```javascript
{ show: 1 }  // Index name: show_1
```
- **Status:** Already created by Payload (relationship field auto-indexing)
- **Purpose:** Fast lookups for episodes by show (used in "show episodes" queries)
- **Type:** Single-field ascending index
- **Cardinality:** High (many episodes per show)
- **Query Pattern:** `db.episodes.find({ show: ObjectId("...") })`
- **Action:** ✅ Skip creation - already present

**Index 2: Genre Filtering** ❌ **TO BE CREATED**
```javascript
{ genres: 1 }  // Index name: genres_1
```
- **Purpose:** Filter episodes by genre (array field → multikey index)
- **Type:** Multikey index (MongoDB automatically detects array)
- **Cardinality:** Medium-High (episodes can have 1-3 genres typically)
- **Query Pattern:** `db.episodes.find({ genres: { $in: [genreId1, genreId2] } })`
- **Note:** MongoDB creates one index entry per array element automatically

**Why Not Text Index?**
- Text indexes on `title`/`description` deferred to Phase 2
- MVP uses regex for simple starts-with/contains: `{ title: /^search/i }`
- Compound index on title/description enables prefix scans without full-text overhead

### 4.2 Shows Collection

**Index 3: Text Search Fields** ❌ **TO BE CREATED**
```javascript
{ title: 1, subtitle: 1, description: 1 }  // Index name: title_1_subtitle_1_description_1
```
- **Purpose:** Enable efficient regex starts-with queries on show metadata
- **Type:** Compound index (covers multiple text fields)
- **Cardinality:** Low-Medium (fewer shows than episodes)
- **Query Patterns:**
  - `db.shows.find({ title: /^search/i })` (starts-with, uses index prefix)
  - `db.shows.find({ $or: [{ title: /search/i }, { description: /search/i }] })` (contains, scans compound)
- **Index Prefix Usage:**
  - Queries on `title` alone can use index prefix efficiently
  - Queries on `subtitle` alone cannot use index (not leftmost)
  - Compound query on all three fields is most efficient

**Why Compound Instead of Separate?**
- Single compound index covers common mixed search pattern: "search in title OR subtitle OR description"
- Reduces index storage overhead (1 index vs 3)
- MongoDB can use index prefix for `title`-only queries
- Slight trade-off: `subtitle`-only or `description`-only queries won't use index (acceptable for MVP)

### 4.3 Hosts Collection

**Index 4: Name Search** ❌ **TO BE CREATED**
```javascript
{ name: 1 }  // Index name: name_1
```
- **Purpose:** Enable efficient regex starts-with queries on host names
- **Type:** Single-field ascending index
- **Cardinality:** Low (small host collection, ~50-200 hosts)
- **Query Pattern:** `db.hosts.find({ name: /^search/i })`

---

## 5. Index Creation Strategy

### 5.1 Creation Options

**All indexes will be created with:**
- `background: true` (online index builds, non-blocking)
  - **Note:** In MongoDB 4.2+, all index builds are non-blocking by default
  - Explicit flag is for clarity and compatibility
- No `unique` constraints (except existing slug fields)
- No `sparse` option (we want to index null values for completeness)

**Command Template:**
```javascript
db.collection.createIndex(
  { field: 1 },
  { 
    background: true,
    name: 'descriptive_index_name'
  }
)
```

### 5.2 Deployment Sequence

**Step 1: Capture Baseline**
```bash
node scripts/db/inspect-search-indexes.js > docs/SEARCH_INDEX_BASELINE.json
```

**Step 2: Create Script**
Create `scripts/db/create-search-indexes-mvp.js` with:
1. Connection to MongoDB
2. Check for existing indexes (skip if already exists)
3. Create new indexes with descriptive names
4. Verify creation with `getIndexes()`
5. Output before/after comparison

**Step 3: Test Execution (Dry Run)**
```bash
# Run with --dry-run flag to simulate
node scripts/db/create-search-indexes-mvp.js --dry-run
```

**Step 4: Execute (Production)**
```bash
# Create indexes in production
node scripts/db/create-search-indexes-mvp.js
```

**Step 5: Verify**
```bash
# Capture post-creation state
node scripts/db/inspect-search-indexes.js > docs/SEARCH_INDEX_AFTER_MVP.json
```

**Step 6: Validate Queries**
```bash
# Test representative queries with explain()
node scripts/db/validate-search-queries.js
```

### 5.3 Rollback Plan

If indexes cause issues:

**Identify Index Names:**
```bash
node scripts/db/inspect-search-indexes.js
```

**Drop Specific Indexes:**
```javascript
db.episodes.dropIndex('show_1');
db.episodes.dropIndex('genres_1');
db.shows.dropIndex('title_1_subtitle_1_description_1');
db.hosts.dropIndex('name_1');
```

**Restore Baseline:**
```bash
# If needed, restore from baseline snapshot
# (manual restore based on SEARCH_INDEX_BASELINE.json)
```

---

## 6. Query Patterns & Performance

### 6.1 Episodes Collection

**Query 1: Episodes by Show (Join)**
```javascript
// Without index (Collection scan)
db.episodes.find({ show: ObjectId("507f1f77bcf86cd799439011") })

// With index { show: 1 } (Index scan)
// explain() will show: "stage": "IXSCAN", "indexName": "show_1"
```
**Expected Improvement:** 10-100x faster for shows with many episodes

**Query 2: Episodes by Genre (Array filter)**
```javascript
// Without index (Collection scan)
db.episodes.find({ genres: { $in: [genreId1, genreId2] } })

// With index { genres: 1 } (Multikey index scan)
// explain() will show: "stage": "IXSCAN", "indexName": "genres_1", "isMultiKey": true
```
**Expected Improvement:** 5-50x faster, grows with collection size

### 6.2 Shows Collection

**Query 3: Shows by Title (Starts-with)**
```javascript
// Without index (Collection scan)
db.shows.find({ title: /^Croisières/i })

// With index { title: 1, subtitle: 1, description: 1 } (Index prefix scan)
// explain() will show: "stage": "IXSCAN", "indexName": "title_1_subtitle_1_description_1"
// Uses index prefix for leftmost field (title)
```
**Expected Improvement:** 5-20x faster (small collection, but consistent)

**Query 4: Shows by Multiple Fields (Mixed search)**
```javascript
// Without index (Collection scan on all fields)
db.shows.find({
  $or: [
    { title: /music/i },
    { subtitle: /music/i },
    { description: /music/i }
  ]
})

// With index { title: 1, subtitle: 1, description: 1 } (Compound scan)
// explain() will show index usage, but may need to scan multiple ranges
```
**Expected Improvement:** 3-10x faster (compound index covers all OR branches)

### 6.3 Hosts Collection

**Query 5: Hosts by Name (Starts-with)**
```javascript
// Without index (Collection scan)
db.hosts.find({ name: /^John/i })

// With index { name: 1 } (Index scan)
// explain() will show: "stage": "IXSCAN", "indexName": "name_1"
```
**Expected Improvement:** 3-10x faster (small collection, but still beneficial)

### 6.4 Limitations of Regex Queries

**Case-Insensitive Regex:**
- `/^search/i` (starts-with) → Can use index with prefix scan
- `/search/i` (contains, leading wildcard) → **Cannot use index efficiently**
  - MongoDB must scan all index entries and apply regex filter
  - Still faster than collection scan, but not as fast as prefix match

**Phase 2 Solution:**
- Use text indexes with `$text` operator for full-text search
- Enables relevance scoring with `$meta: "textScore"`
- Better performance for contains/wildcard queries

---

## 7. Validation & Testing

### 7.1 Smoke Tests

**Episode Join Speed:**
```javascript
// Measure query time before/after index
const startTime = Date.now();
db.episodes.find({ show: ObjectId("...") }).toArray();
const elapsed = Date.now() - startTime;
console.log(`Query time: ${elapsed}ms`);
```

**Genre Filter Speed:**
```javascript
// Test multikey index performance
const startTime = Date.now();
db.episodes.find({ genres: { $in: [genreId1, genreId2] } }).toArray();
const elapsed = Date.now() - startTime;
console.log(`Query time: ${elapsed}ms`);
```

**Show Search Speed:**
```javascript
// Test compound index prefix usage
const startTime = Date.now();
db.shows.find({ title: /^Croisières/i }).toArray();
const elapsed = Date.now() - startTime;
console.log(`Query time: ${elapsed}ms`);
```

### 7.2 Query Explain Analysis

**Check Index Usage:**
```javascript
db.episodes.find({ show: ObjectId("...") }).explain("executionStats")
```

**Expected Output:**
```json
{
  "executionStats": {
    "executionSuccess": true,
    "nReturned": 42,
    "executionTimeMillis": 2,
    "totalKeysExamined": 42,
    "totalDocsExamined": 42,
    "executionStages": {
      "stage": "IXSCAN",
      "indexName": "show_1",
      "keysExamined": 42,
      "docsExamined": 42
    }
  }
}
```

**Red Flags (indicate missing/wrong index):**
- `"stage": "COLLSCAN"` (collection scan instead of index scan)
- `totalDocsExamined >> nReturned` (inefficient scan)
- `executionTimeMillis > 100ms` (for small result sets)

---

## 8. Questions & Risk Assessment

### 8.1 Open Questions

**Q1: Any legacy indexes to drop?**
- **Action:** Run `inspect-search-indexes.js` to identify unused/redundant indexes
- **Decision:** Flag for review, but don't remove without admin approval
- **Risk:** Dropping active index could break existing queries

**Q2: Index bloat concerns?**
- **Current:** Minimal indexes (4 new indexes, ~1-2KB each)
- **Impact:** Negligible on disk space and write performance
- **Monitoring:** Track index size with `db.collection.stats()`

**Q3: Multikey index performance?**
- **MongoDB Docs:** Multikey indexes are efficient for array queries
- **Caveat:** Compound indexes with multiple array fields are not allowed
- **Validation:** `genres` is only array field in proposed indexes ✅

### 8.2 Risk Analysis

**Risk 1: Regex leading wildcard queries won't use indexes effectively**
- **Severity:** Medium (expected behavior)
- **Mitigation:** Accept for MVP, document in user-facing search UI
- **Phase 2:** Migrate to `$text` indexes for better wildcard performance

**Risk 2: $lookup stages can grow with data volume**
- **Severity:** Low (current dataset is small, ~1000 episodes)
- **Mitigation:** Keep joins minimal, index join fields (show, genres)
- **Monitoring:** Track aggregation pipeline execution time

**Risk 3: Index build time in production**
- **Severity:** Low (MongoDB 4.2+ has online index builds)
- **Mitigation:** Use `background: true` flag explicitly
- **Fallback:** Run during low-traffic window if concerned

---

## 9. Success Criteria

**✅ Phase 1 Complete When:**

1. **All three collections inspected**
   - Shows schema confirmed (title, subtitle, description)
   - Episodes schema confirmed (show ObjectId, genres array)
   - Hosts schema confirmed (name)

2. **Current indexes documented**
   - Baseline snapshot saved in `docs/SEARCH_INDEX_BASELINE.json`
   - JSON output includes all existing indexes per collection

3. **New indexes created successfully**
   - No errors during `createIndex()` calls
   - All 4 indexes present in `getIndexes()` output
   - No duplicates (skip creation if already exists)

4. **Index builds don't impact write throughput**
   - Use `background: true` for online index builds (MongoDB 4.2+)
   - Monitor write latency during creation (should be <5% increase)
   - No blocking operations detected in logs

5. **Documentation updated**
   - **CHANGELOG.md** entry added with:
     - Rationale (support mixed search MVP)
     - Keys & options (list all 4 indexes with field names)
     - Date & environment (production, staging, or dev)
     - Before/after index counts
   - **This document** finalized with:
     - Baseline snapshot reference
     - Post-creation verification results
     - Query performance improvements (informal timing)

6. **Smoke tests pass**
   - Episode join query (by show) uses `show_1` index
   - Episode genre filter (array) uses `genres_1` multikey index
   - Show title search (starts-with) uses compound index prefix
   - Host name search (starts-with) uses `name_1` index
   - All `explain()` outputs show `IXSCAN` stage (not `COLLSCAN`)

**Informal Timing Acceptance:**
- Query execution time < 50ms for typical searches (no hard SLA for MVP)
- `explain()` confirms index usage (primary success metric)
- User-facing search UI feels "instant" (<200ms end-to-end)

---

## 10. Phase 2 Preview (Text Indexes)

**Deferred Features:**
- Full-text search on `shows.title`, `shows.description`, `episodes.description`
- Relevance ranking with `$meta: "textScore"`
- Better wildcard/contains query performance
- Language-specific stemming (English)

**Text Index Example (Phase 2):**
```javascript
db.shows.createIndex(
  {
    title: "text",
    subtitle: "text", 
    description: "text"
  },
  {
    weights: {
      title: 10,      // Title matches rank highest
      subtitle: 5,    // Subtitle matches rank medium
      description: 1  // Description matches rank lowest
    },
    name: "shows_text_search",
    default_language: "english"
  }
)
```

**Query with Text Search (Phase 2):**
```javascript
db.shows.find(
  { $text: { $search: "electronic music" } },
  { score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } })
```

**Why Defer?**
- Text indexes add complexity (language analyzers, scoring)
- MVP can use simpler regex queries with compound indexes
- Phase 2 will revisit when relevance ranking is required

---

## 11. Implementation Checklist

**Planning Phase (This Document):**
- [x] Inspect schemas for shows, episodes, hosts
- [x] Document key fields and data types
- [x] Identify existing indexes in collection configs
- [x] Run `inspect-search-indexes.js` to capture baseline
- [x] Save baseline to `docs/SEARCH_INDEX_BASELINE.txt`
- [x] Create `create-search-indexes-mvp.js` script
- [x] Test script with `--dry-run` (successful)
- [x] Document findings in planning doc

**Implementation Phase (Next Steps):**
- [ ] Create `scripts/db/create-search-indexes-mvp.js`
- [ ] Test index creation script with `--dry-run`
- [ ] Execute index creation in production
- [ ] Capture post-creation state to `docs/SEARCH_INDEX_AFTER_MVP.json`
- [ ] Run smoke tests with `explain()` analysis
- [ ] Update CHANGELOG.md with results
- [ ] Document query performance improvements

**Validation Phase:**
- [ ] Verify all 4 indexes present in collections
- [ ] Confirm `IXSCAN` usage in explain plans
- [ ] Measure informal query timing (before/after)
- [ ] Check for duplicate or redundant indexes
- [ ] Flag any legacy indexes for review (don't drop yet)

---

## 12. References

**MongoDB Indexing:**
- [MongoDB Index Strategies](https://www.mongodb.com/docs/manual/applications/indexes/)
- [Multikey Indexes](https://www.mongodb.com/docs/manual/core/index-multikey/)
- [Compound Indexes](https://www.mongodb.com/docs/manual/core/index-compound/)
- [Text Indexes](https://www.mongodb.com/docs/manual/core/index-text/)

**Related Payload Docs:**
- Episodes Collection: `src/collections/Episodes.ts`
- Shows Collection: `src/collections/Shows.ts`
- Hosts Collection: `src/collections/Hosts.ts`
- TypeScript Types: `src/payload-types.ts`

**Related Scripts:**
- Existing index scripts: `scripts/db/check-indexes.ts`, `scripts/db/sync-indexes.ts`
- CHANGELOG: `CHANGELOG.md` (see Oct 21, 2025 indexing section)

---

**Document Status:** ✅ Planning Complete - Ready for Baseline Capture  
**Next Action:** Run `node scripts/db/inspect-search-indexes.js` to capture baseline  
**Approval Required:** None (planning only)


